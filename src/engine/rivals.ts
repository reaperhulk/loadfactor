// Rival airline AI. Lives in the engine because rivals are part of the sim:
// their decisions must be deterministic and derived only from state + the
// rivals RNG stream. They act through the exact same command validator as the
// player (PLAN.md §3.3 step 1).

import { typesOnSale, getAircraftType } from '../data/aircraft'
import { CITIES, distanceKm, getCity, pairKey } from '../data/cities'
import { AI_MIN_ROUTE_KM, NEG_MIN_SPEND } from '../data/constants'
import { applyPlanningCommand } from './commands'
import { pairWeeklyDemand } from './market'
import { negotiationDifficulty } from './negotiation'
import {
  airlinesOnPair,
  debtCeiling,
  maxRouteFrequency,
  roundTripsPerWeek,
  routeWeeklyCapacity,
  slotCities,
  slotsAllocated,
  slotsFree,
  totalDebt,
  yearOf,
} from './queries'
import { chanceBp } from './rng'
import type { Command, GameEvent, GameState } from './types'

function apply(state: GameState, idx: number, cmd: Command, events: GameEvent[]): void {
  events.push(...applyPlanningCommand(state, idx, cmd).events)
}

// Rival archetypes (PLAN.md M3): the same policy skeleton, different dials.
// price_war floods cheap seats, premium sells service at a markup, fortress
// builds a dense home-region web before venturing out.
interface Personality {
  orderChanceBp: number // per-quarter appetite for a new airframe
  fareLevel: number
  serviceLevel: number
  fareFloor: number // how low retaliation will cut fares
  expandMinDemand: number // weekly-demand floor for opening a route
  negotiateBudgetBp: number // spend as bp of city difficulty
  homeRegionUntil: number // cities held before negotiating outside the HQ region
  cabin: number // preferred cabin fit for the fleet (1 dense / 2 std / 3 prem)
}

const PERSONALITIES: Record<string, Personality> = {
  balanced: {
    orderChanceBp: 7000,
    fareLevel: 0,
    serviceLevel: 2,
    fareFloor: -1,
    expandMinDemand: 300,
    negotiateBudgetBp: 10000,
    homeRegionUntil: 0,
    cabin: 2,
  },
  price_war: {
    orderChanceBp: 8000,
    fareLevel: -1,
    serviceLevel: 1,
    fareFloor: -2,
    expandMinDemand: 200,
    negotiateBudgetBp: 9000,
    homeRegionUntil: 0,
    cabin: 1,
  },
  premium: {
    orderChanceBp: 6000,
    fareLevel: 1,
    serviceLevel: 3,
    fareFloor: 0,
    expandMinDemand: 300,
    negotiateBudgetBp: 11000,
    homeRegionUntil: 0,
    cabin: 3,
  },
  fortress: {
    orderChanceBp: 7000,
    fareLevel: 0,
    serviceLevel: 2,
    fareFloor: -1,
    expandMinDemand: 250,
    negotiateBudgetBp: 12000,
    homeRegionUntil: 6,
    cabin: 2,
  },
}

// One rival's planning turn. Shared skeleton: stay solvent, keep planes
// flying, open the best reachable route, buy jets when full, push into the
// best new city — with the dials set by its personality. Mutates state via
// applyPlanningCommand only.
export function runRivalTurn(state: GameState, idx: number, events: GameEvent[]): void {
  const airline = state.airlines[idx]
  if (!airline || airline.bankrupt) return
  const personality = PERSONALITIES[airline.personality] ?? PERSONALITIES['balanced']!

  // Borrow when the cash buffer is thin and there is real debt room.
  if (airline.cash < 3000) {
    const room = debtCeiling(airline) - totalDebt(airline)
    if (room >= 5000) apply(state, idx, { type: 'take_loan', amount: Math.min(room, 8000) }, events)
  }

  // Defensive play, same as the competent player bot: prune structurally
  // losing routes and retire one geriatric maintenance hog per quarter.
  for (const route of [...airline.routes]) {
    if (route.lastCapacity > 0 && route.lastRevenue * 100 < route.lastCost * 85) {
      apply(state, idx, { type: 'close_route', routeId: route.id }, events)
    }
  }
  // Yield management, same instincts as the competent player bot: packed
  // planes raise fares, slack ones cut toward the personality floor.
  for (const route of airline.routes) {
    if (route.lastCapacity === 0) continue
    if (route.lastLoadFactorBp >= 9700 && route.fareLevel < 2) {
      apply(state, idx, { type: 'set_fare', routeId: route.id, fareLevel: route.fareLevel + 1 }, events)
    } else if (route.lastLoadFactorBp < 5500 && route.fareLevel > personality.fareFloor) {
      apply(state, idx, { type: 'set_fare', routeId: route.id, fareLevel: route.fareLevel - 1 }, events)
    }
  }

  // Retaliation (M3-lite): on a CONTESTED pair, a deep share loss — pax down
  // more than a third with seats now going empty — answers with a fare cut,
  // down to the personality's floor. The contest check keeps rivals from
  // fare-warring themselves over demand noise.
  for (const route of airline.routes) {
    const h = route.history
    if (h.length >= 2 && route.fareLevel > personality.fareFloor) {
      const last = h[h.length - 1]!
      const prev = h[h.length - 2]!
      const contested = airlinesOnPair(state, route.from, route.to, idx) > 0
      if (contested && last.pax * 3 < prev.pax * 2 && last.loadFactorBp < 7000) {
        apply(state, idx, { type: 'set_fare', routeId: route.id, fareLevel: route.fareLevel - 1 }, events)
      }
    }
  }

  if (airline.fleet.length > 2) {
    let oldest: (typeof airline.fleet)[number] | null = null
    for (const ac of airline.fleet) {
      if (ac.ageQuarters >= 60 && (oldest === null || ac.ageQuarters > oldest.ageQuarters)) oldest = ac
    }
    if (oldest) apply(state, idx, { type: 'sell_aircraft', aircraftId: oldest.id }, events)
  }

  // Bring the fleet toward the personality's cabin fit, a couple of refits a
  // quarter when cash allows — price_war packs seats, premium sells space.
  if (airline.cash >= 6000) {
    let refits = 0
    for (const ac of airline.fleet) {
      if (refits >= 2) break
      if (ac.cabin === personality.cabin) continue
      apply(state, idx, { type: 'refit_cabin', aircraftId: ac.id, cabin: personality.cabin }, events)
      refits++
    }
  }

  // Assign idle aircraft to the route that is most starved for seats, and
  // keep the schedule at the fleet's maximum as capacity arrives.
  for (const ac of airline.fleet) {
    if (ac.routeId !== null) continue
    const range = getAircraftType(ac.type).rangeKm
    let bestRoute: number | null = null
    let bestGap = 0
    for (const route of airline.routes) {
      const km = distanceKm(route.from, route.to)
      if (km > range) continue
      const gap = pairWeeklyDemand(state, route.from, route.to) - routeWeeklyCapacity(airline, route)
      if (gap > bestGap) {
        bestGap = gap
        bestRoute = route.id
      }
    }
    if (bestRoute !== null) {
      apply(state, idx, { type: 'assign_aircraft', aircraftId: ac.id, routeId: bestRoute }, events)
      const route = airline.routes.find((r) => r.id === bestRoute)
      if (route) {
        const max = maxRouteFrequency(airline, route)
        if (max > route.frequency) apply(state, idx, { type: 'set_frequency', routeId: route.id, frequency: max }, events)
      }
    }
  }

  // Open the highest-demand unserved pair an IDLE aircraft can actually fly,
  // launching it at that aircraft's full weekly frequency.
  const idle = airline.fleet.filter((a) => a.routeId === null)
  if (idle.length > 0) {
    let maxRange = 0
    for (const ac of idle) maxRange = Math.max(maxRange, getAircraftType(ac.type).rangeKm)
    const cities = slotCities(airline)
    const served = new Set(airline.routes.map((r) => pairKey(r.from, r.to)))
    let best: { from: string; to: string; km: number } | null = null
    let bestDemand = 0
    for (let i = 0; i < cities.length; i++) {
      for (let j = i + 1; j < cities.length; j++) {
        const a = cities[i]!
        const b = cities[j]!
        if (served.has(pairKey(a, b))) continue
        if (slotsFree(airline, a) < 1 || slotsFree(airline, b) < 1) continue
        const km = distanceKm(a, b)
        if (km > maxRange || km < AI_MIN_ROUTE_KM) continue
        const demand = pairWeeklyDemand(state, a, b)
        if (demand > bestDemand) {
          bestDemand = demand
          best = { from: a, to: b, km }
        }
      }
    }
    if (best && bestDemand > personality.expandMinDemand) {
      const launch = idle.find((ac) => getAircraftType(ac.type).rangeKm >= best.km)
      if (launch) {
        apply(
          state,
          idx,
          {
            type: 'open_route',
            from: best.from,
            to: best.to,
            aircraftId: launch.id,
            frequency: roundTripsPerWeek(launch.type, best.km),
            fareLevel: personality.fareLevel,
            serviceLevel: personality.serviceLevel,
          },
          events,
        )
      }
    }
  }

  // Buy at most one aircraft per quarter, and only when the network is full
  // (or the starter fleet is still building out). A seeded coin flip makes
  // rivals pace differently across seeds.
  let lastPax = 0
  let lastCapacity = 0
  for (const route of airline.routes) {
    lastPax += route.lastPax
    lastCapacity += route.lastCapacity
  }
  const networkFull = lastCapacity > 0 && lastPax * 10000 >= lastCapacity * 7500
  const bootstrapping = airline.fleet.length + airline.orders.length < 4
  const flip = chanceBp(state.rng.rivals, personality.orderChanceBp)
  state.rng.rivals = flip.rng
  if (flip.value && (networkFull || bootstrapping) && airline.orders.length === 0) {
    // Expansion credit, same as the player bot: full-but-poor while
    // profitable is exactly when borrowing to grow is right.
    const lastProfit = airline.history[airline.history.length - 1]?.profit ?? 0
    let expectedCash = airline.cash
    if (airline.cash < 12000 && lastProfit > 0) {
      const room = debtCeiling(airline) - totalDebt(airline)
      if (room >= 8000) {
        apply(state, idx, { type: 'take_loan', amount: 10000 }, events)
        expectedCash += 10000
      }
    }
    const buffer = 5000
    const affordable = typesOnSale(yearOf(state)).filter((t) => t.price + buffer <= expectedCash)
    if (affordable.length > 0) {
      let pick = affordable[0]!
      for (const t of affordable) if (t.seats > pick.seats) pick = t
      apply(state, idx, { type: 'order_aircraft', aircraftType: pick.id }, events)
    }
  }

  // Push into the most attractive city we do not hold slots at yet. A
  // fortress builds out its home region before venturing abroad.
  if (airline.negotiations.length === 0 && airline.cash >= 4000) {
    const homeRegion = getCity(airline.hq).region
    const stayHome = slotCities(airline).length < personality.homeRegionUntil
    let target: string | null = null
    let bestMass = 0
    for (const c of CITIES) {
      if ((airline.slots[c.id] ?? 0) > 0) continue
      if (slotsAllocated(state, c.id) >= c.slotPool) continue
      if (stayHome && c.region !== homeRegion) continue
      const mass = c.pop * 4 + c.biz * 3 + c.tour * 2
      if (mass > bestMass) {
        bestMass = mass
        target = c.id
      }
    }
    if (target !== null) {
      const budget = Math.floor((negotiationDifficulty(target) * personality.negotiateBudgetBp) / 10000)
      const spend = Math.max(NEG_MIN_SPEND, Math.min(budget, airline.cash - 3000))
      if (spend >= NEG_MIN_SPEND && spend <= airline.cash) {
        apply(state, idx, { type: 'negotiate_slots', city: target, spend }, events)
      }
    }
  }
}
