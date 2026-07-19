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
  netWorth,
  networkCities,
  pairWeeklySeats,
  roundTripsPerWeek,
  routeWeeklyCapacity,
  slotCities,
  slotsAllocated,
  slotsFree,
  totalDebt,
  yearOf,
} from './queries'
import { chanceBp } from './rng'
import { effFuelBp } from './worldEvents'
import type { Airline, Command, GameEvent, GameState } from './types'

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
  // Competitive read on a pair: seats already fielded there count against its
  // expansion score at this rate. Under 10000 means incumbents look beatable
  // (price_war undercuts its way in); over means avoid crowded markets.
  contestDiscountBp: number
  // Negotiation bonus (mass points) for cities where the current net-worth
  // leader is entrenched — raid the winner's fortress, not empty fields.
  raidBonus: number
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
    contestDiscountBp: 10000,
    raidBonus: 8,
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
    contestDiscountBp: 6000,
    raidBonus: 14,
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
    contestDiscountBp: 13000,
    raidBonus: 4,
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
    contestDiscountBp: 11000,
    raidBonus: 0,
  },
}

// Expansion score for an unserved-by-us pair: weekly demand net of the seats
// every airline already flies there, scaled by how the personality reads a
// contest. Pure and exported for tests.
export function expansionScore(demand: number, fieldedSeats: number, contestDiscountBp: number): number {
  return demand - Math.floor((fieldedSeats * contestDiscountBp) / 10000)
}

// One rival's planning turn. Shared skeleton: stay solvent, keep planes
// flying, open the best reachable route, buy jets when full, push into the
// best new city — with the dials set by its personality. Mutates state via
// applyPlanningCommand only.
export function runRivalTurn(state: GameState, idx: number, events: GameEvent[]): void {
  const airline = state.airlines[idx]
  if (!airline || airline.bankrupt) return
  const personality = PERSONALITIES[airline.personality] ?? PERSONALITIES['balanced']!

  // Treasury: keep a cash buffer proportional to the cost base — a airline
  // grossing $100M a quarter dies of illiquidity long before insolvency if it
  // only tops up at $3M. Borrow against the fleet when the buffer thins.
  const lastCosts = airline.history[airline.history.length - 1]?.costs ?? 0
  const cashBuffer = Math.max(3000, Math.floor(lastCosts / 2))
  if (airline.cash < cashBuffer) {
    const room = debtCeiling(airline) - totalDebt(airline)
    const want = Math.min(room, cashBuffer)
    if (want >= 2000) apply(state, idx, { type: 'take_loan', amount: want }, events)
  }

  // Defensive play, same as the competent player bot: prune structurally
  // losing routes — but at most two per quarter. A fuel spike can flip half
  // the network to paper-losers at once; closing everything in one quarter
  // collapses revenue while the freed planes keep drawing salaries.
  const losers = airline.routes
    .filter((r) => r.lastCapacity > 0 && r.lastRevenue * 100 < r.lastCost * 85)
    .sort((a, b) => a.lastRevenue * b.lastCost - b.lastRevenue * a.lastCost)
    .slice(0, 2)
  for (const route of losers) {
    apply(state, idx, { type: 'close_route', routeId: route.id }, events)
  }

  // Lock in cheap fuel when it is cheap — a hedge smooths the oil shocks
  // that otherwise flip whole networks into paper-losers overnight.
  if (airline.fuelHedge === null && airline.fleet.length > 0 && effFuelBp(state.world) <= 10500) {
    apply(state, idx, { type: 'hedge_fuel', quarters: 4 }, events)
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
      if (ac.ageQuarters >= 48 && (oldest === null || ac.ageQuarters > oldest.ageQuarters)) oldest = ac
    }
    if (oldest) apply(state, idx, { type: 'sell_aircraft', aircraftId: oldest.id }, events)
  }

  // Capacity discipline: slack MONOPOLY routes trim the schedule (empty seats
  // burn fuel and nobody takes the share). On contested pairs frequency is
  // competitiveness — trimming there concedes the market and spirals, so
  // slack contested routes are fought with fares (retaliation) instead.
  // Packed routes restore the schedule toward the fleet's maximum.
  for (const route of airline.routes) {
    if (route.lastCapacity === 0) continue
    const max = maxRouteFrequency(airline, route)
    const eff = Math.min(route.frequency, max)
    const contested = airlinesOnPair(state, route.from, route.to, idx) > 0
    if (!contested && route.lastLoadFactorBp < 5500 && eff > 2) {
      apply(state, idx, { type: 'set_frequency', routeId: route.id, frequency: Math.max(2, Math.floor((eff * 3) / 4)) }, events)
    } else if (route.lastLoadFactorBp >= 9000 && route.frequency < max) {
      apply(state, idx, { type: 'set_frequency', routeId: route.id, frequency: max }, events)
    }
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
    const network = networkCities(airline)
    let best: { from: string; to: string; km: number } | null = null
    let bestScore = 0
    for (let i = 0; i < cities.length; i++) {
      for (let j = i + 1; j < cities.length; j++) {
        const a = cities[i]!
        const b = cities[j]!
        if (served.has(pairKey(a, b))) continue
        if (!network.has(a) && !network.has(b)) continue // routes must touch the network
        if (slotsFree(airline, a) < 1 || slotsFree(airline, b) < 1) continue
        const km = distanceKm(a, b)
        if (km > maxRange || km < AI_MIN_ROUTE_KM) continue
        // Read the market, not just the map: demand net of seats everyone
        // already flies there, at the personality's contest appetite.
        const score = expansionScore(
          pairWeeklyDemand(state, a, b),
          pairWeeklySeats(state, a, b),
          personality.contestDiscountBp,
        )
        if (score > bestScore) {
          bestScore = score
          best = { from: a, to: b, km }
        }
      }
    }
    if (best && bestScore > personality.expandMinDemand) {
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

  // Cash-strapped with metal on the ground: surplus idle airframes draw
  // salaries and ownership for nothing — liquidate one a quarter.
  if (airline.cash < cashBuffer && airline.fleet.length > 3) {
    let surplus: (typeof airline.fleet)[number] | null = null
    for (const ac of airline.fleet) {
      if (ac.routeId !== null) continue
      if (surplus === null || ac.ageQuarters > surplus.ageQuarters) surplus = ac
    }
    if (surplus) apply(state, idx, { type: 'sell_aircraft', aircraftId: surplus.id }, events)
  }

  // Distress: negative cash means one more bad quarter is the end. Sell the
  // oldest airframes — assigned or not — to stay alive (the sale-and-shrink
  // every real carrier reaches for before the receivers do).
  if (airline.cash < 0 && airline.fleet.length > 2) {
    const byAge = [...airline.fleet].sort((a, b) => b.ageQuarters - a.ageQuarters || a.id - b.id)
    for (const ac of byAge.slice(0, 2)) {
      apply(state, idx, { type: 'sell_aircraft', aircraftId: ac.id }, events)
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
  // fortress builds out its home region before venturing abroad; aggressive
  // archetypes bias toward cities where the current leader is entrenched.
  if (airline.negotiations.length === 0 && airline.cash >= 4000) {
    const homeRegion = getCity(airline.hq).region
    const stayHome = slotCities(airline).length < personality.homeRegionUntil
    // The net-worth leader among the other airlines — the one worth raiding.
    let leader: Airline | null = null
    for (const other of state.airlines) {
      if (other.id === idx || other.bankrupt) continue
      if (leader === null || netWorth(other) > netWorth(leader)) leader = other
    }
    let target: string | null = null
    let bestMass = 0
    for (const c of CITIES) {
      if ((airline.slots[c.id] ?? 0) > 0) continue
      if (slotsAllocated(state, c.id) >= c.slotPool) continue
      if (stayHome && c.region !== homeRegion) continue
      let mass = c.pop * 4 + c.biz * 3 + c.tour * 2
      if (leader !== null && (leader.slots[c.id] ?? 0) >= 2) mass += personality.raidBonus
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
