// Strategy bots: pure functions of GameState → the player's planning commands
// for this quarter. No RNG — a bot's whole career is determined by the seed's
// effect on the world. Bots drive golden tests, the balance envelope, and CI
// careers (PLAN.md §5.6).

import { getAircraftType, typesOnSale } from '../data/aircraft'
import { CITIES, distanceKm, pairKey } from '../data/cities'
import { AI_MIN_ROUTE_KM, NEG_MIN_SPEND, ROUTE_MEMORY_QUARTERS, ROUTE_SPOOL_BP } from '../data/constants'
import { pairWeeklyDemand, routeSpoolBp } from '../engine/market'
import { negotiationDifficulty } from '../engine/negotiation'
import { effFuelBp } from '../engine/worldEvents'
import {
  airlinesOnPair,
  debtCeiling,
  maxRouteFrequency,
  networkCities,
  roundTripsPerWeek,
  routeWeeklyCapacity,
  slotCities,
  slotsAllocated,
  slotsFree,
  totalDebt,
  yearOf,
} from '../engine/queries'
import type { Command, GameState } from '../engine/types'

export type BotName = 'naive' | 'greedy'

// Shared: assign every idle aircraft to the route most starved for seats,
// bumping each route's schedule to the fleet's new maximum. Commands are
// computed against the pre-apply snapshot, so expected frequencies are
// tracked explicitly. `skip` excludes aircraft consumed by an open_route
// command earlier in the same batch.
export function assignmentCommands(state: GameState, skip?: ReadonlySet<number>): Command[] {
  const airline = state.airlines[0]!
  const commands: Command[] = []
  const pendingCapacity = new Map<number, number>()
  const pendingTrips = new Map<number, number>()
  for (const ac of airline.fleet) {
    if (ac.routeId !== null || skip?.has(ac.id)) continue
    const type = getAircraftType(ac.type)
    let bestRoute: (typeof airline.routes)[number] | null = null
    let bestGap = 0
    for (const route of airline.routes) {
      const km = distanceKm(route.from, route.to)
      if (km > type.rangeKm) continue
      const gap =
        pairWeeklyDemand(state, route.from, route.to) -
        routeWeeklyCapacity(airline, route) -
        (pendingCapacity.get(route.id) ?? 0)
      if (gap > bestGap) {
        bestGap = gap
        bestRoute = route
      }
    }
    if (bestRoute !== null) {
      const km = distanceKm(bestRoute.from, bestRoute.to)
      const trips = roundTripsPerWeek(ac.type, km)
      commands.push({ type: 'assign_aircraft', aircraftId: ac.id, routeId: bestRoute.id })
      const newMax = maxRouteFrequency(airline, bestRoute) + (pendingTrips.get(bestRoute.id) ?? 0) + trips
      commands.push({ type: 'set_frequency', routeId: bestRoute.id, frequency: newMax })
      pendingCapacity.set(bestRoute.id, (pendingCapacity.get(bestRoute.id) ?? 0) + type.seats * 20)
      pendingTrips.set(bestRoute.id, (pendingTrips.get(bestRoute.id) ?? 0) + trips)
    }
  }
  return commands
}

// The launch order for the best unserved pair, if an idle airframe can fly
// it. Returns the commands plus the consumed aircraft id.
export function launchCommands(
  state: GameState,
  minScore: number,
  fareLevel = 0,
  serviceLevel = 2,
): { commands: Command[]; usedAircraft: number | null } {
  const airline = state.airlines[0]!
  const pair = bestUnservedPair(state)
  if (!pair || pair.score <= minScore) return { commands: [], usedAircraft: null }
  const km = distanceKm(pair.from, pair.to)
  const launch = airline.fleet.find(
    (ac) => ac.routeId === null && getAircraftType(ac.type).rangeKm >= km,
  )
  if (!launch) return { commands: [], usedAircraft: null }
  return {
    commands: [
      {
        type: 'open_route',
        from: pair.from,
        to: pair.to,
        aircraftId: launch.id,
        frequency: roundTripsPerWeek(launch.type, km),
        fareLevel,
        serviceLevel,
      },
    ],
    usedAircraft: launch.id,
  }
}

// Demand discounted by incumbent competition: a monopoly pair is worth far
// more than a contested one of equal size.
export function pairScore(state: GameState, a: string, b: string): number {
  const demand = pairWeeklyDemand(state, a, b)
  return Math.floor((demand * 100) / (100 + 150 * airlinesOnPair(state, a, b, 0)))
}

export function bestUnservedPair(state: GameState): { from: string; to: string; score: number } | null {
  const airline = state.airlines[0]!
  // Only consider pairs some current or incoming airframe could actually fly.
  let maxRange = 0
  for (const ac of airline.fleet) maxRange = Math.max(maxRange, getAircraftType(ac.type).rangeKm)
  for (const o of airline.orders) maxRange = Math.max(maxRange, getAircraftType(o.type).rangeKm)
  const cities = slotCities(airline)
  const served = new Set(airline.routes.map((r) => pairKey(r.from, r.to)))
  const network = networkCities(airline)
  let best: { from: string; to: string; score: number } | null = null
  for (let i = 0; i < cities.length; i++) {
    for (let j = i + 1; j < cities.length; j++) {
      const a = cities[i]!
      const b = cities[j]!
      if (served.has(pairKey(a, b))) continue
      if (!network.has(a) && !network.has(b)) continue // routes must touch the network
      if (slotsFree(airline, a) < 1 || slotsFree(airline, b) < 1) continue
      const km = distanceKm(a, b)
      if (km > maxRange || km < AI_MIN_ROUTE_KM) continue
      // Value pairs at their true first-quarter strength: a remembered
      // market flies at 100% while a genuinely new one spools up.
      const mem = airline.servedUntil[pairKey(a, b)]
      const spoolBp =
        mem !== undefined && state.turn - mem <= ROUTE_MEMORY_QUARTERS ? 10000 : ROUTE_SPOOL_BP[0]!
      const score = Math.floor((pairScore(state, a, b) * spoolBp) / 10000)
      if (score > (best?.score ?? 0)) best = { from: a, to: b, score }
    }
  }
  return best
}

// Naive: opens whatever route it can and parks planes on it. Never orders,
// never negotiates, never borrows, never touches fares. The balance envelope
// expects this bot to survive early but lose the scenario.
function naiveCommands(state: GameState): Command[] {
  const launch = launchCommands(state, 0)
  const skip = launch.usedAircraft !== null ? new Set([launch.usedAircraft]) : undefined
  return [...launch.commands, ...assignmentCommands(state, skip)]
}

// Yield management: monopoly-tight routes can bear higher fares; slack routes
// buy back share with cheaper seats.
export function fareCommands(state: GameState): Command[] {
  const commands: Command[] = []
  for (const route of state.airlines[0]!.routes) {
    if (route.lastCapacity === 0) continue
    if (route.lastLoadFactorBp >= 9700 && route.fareLevel < 2) {
      commands.push({ type: 'set_fare', routeId: route.id, fareLevel: route.fareLevel + 1 })
    } else if (route.lastLoadFactorBp < 5500 && route.fareLevel > -1) {
      commands.push({ type: 'set_fare', routeId: route.id, fareLevel: route.fareLevel - 1 })
    }
  }
  return commands
}

// Greedy: expand routes, buy the biggest affordable jet, push into the best
// new city, borrow when thin, prune losers, retire maintenance hogs.
function greedyCommands(state: GameState): Command[] {
  const airline = state.airlines[0]!
  const commands: Command[] = []

  // Treasury: keep a buffer proportional to the cost base — one shock
  // quarter must never be able to blow straight through it.
  const lastCosts = airline.history[airline.history.length - 1]?.costs ?? 0
  const cashBuffer = Math.max(3000, Math.floor(lastCosts / 2))
  if (airline.cash < cashBuffer) {
    const room = debtCeiling(airline) - totalDebt(airline)
    const want = Math.min(room, cashBuffer)
    if (want >= 2000) commands.push({ type: 'take_loan', amount: want })
  }

  // Lock in cheap fuel when it is cheap.
  if (airline.fuelHedge === null && airline.fleet.length > 0 && effFuelBp(state.world) <= 10500) {
    commands.push({ type: 'hedge_fuel', quarters: 4 })
  }

  // Distress: under water, an idle airframe is a liability with a payroll.
  // Sell up to two (oldest first) — the same reflex the rivals have. Cash
  // today breaks an insolvency streak that would otherwise be fatal.
  if (airline.cash < 0) {
    const idle = airline.fleet
      .filter((a) => a.routeId === null && !a.leased)
      .sort((a, b) => b.ageQuarters - a.ageQuarters)
      .slice(0, 2)
    for (const ac of idle) commands.push({ type: 'sell_aircraft', aircraftId: ac.id })
  }

  // Brand: hold a modest marketing level while liquid, go dark when thin —
  // the share edge on contested pairs beats the spend, but never over debt.
  const wantMarketing = airline.cash >= cashBuffer && airline.routes.length >= 3 ? 1 : 0
  if (airline.marketing !== wantMarketing) {
    commands.push({ type: 'set_marketing', level: wantMarketing })
  }

  // Prune routes losing >15% of their costs — deeper than demand noise (±8%)
  // can explain, so it's structural, not a bad quarter. A route spooling in
  // a genuinely NEW market is exempt (its economics aren't steady-state
  // yet); re-entries carry market memory and answer for their numbers
  // immediately, so a teardown-and-rebuild in a fuel spike stays viable.
  for (const route of airline.routes) {
    if (
      routeSpoolBp(airline, route, state.turn) === 10000 &&
      route.lastCapacity > 0 &&
      route.lastRevenue * 100 < route.lastCost * 85
    ) {
      commands.push({ type: 'close_route', routeId: route.id })
    }
  }

  // Fleet renewal: maintenance escalates with age, and inflation compounds
  // it. Retire the two oldest geriatric airframes per quarter.
  const geriatric = airline.fleet
    .filter((a) => a.ageQuarters >= 48)
    .sort((a, b) => b.ageQuarters - a.ageQuarters)
    .slice(0, 2)
  for (const ac of geriatric) commands.push({ type: 'sell_aircraft', aircraftId: ac.id })

  const launch = launchCommands(state, 300)
  commands.push(...launch.commands)

  // Capacity discipline: only buy when the network is actually full (or we
  // are still fielding the starter fleet, or renewal just thinned us out).
  let lastPax = 0
  let lastCapacity = 0
  for (const route of airline.routes) {
    lastPax += route.lastPax
    lastCapacity += route.lastCapacity
  }
  const networkFull = lastCapacity > 0 && lastPax * 10000 >= lastCapacity * 7500
  const bootstrapping = airline.fleet.length + airline.orders.length < 4
  if ((networkFull || bootstrapping || geriatric.length > 0) && airline.orders.length === 0) {
    // Expansion credit: profitable and full but cash-poor is exactly when
    // borrowing to grow is right.
    const lastProfit = airline.history[airline.history.length - 1]?.profit ?? 0
    let expectedCash = airline.cash
    if (airline.cash < 12000 && lastProfit > 0) {
      const room = debtCeiling(airline) - totalDebt(airline)
      if (room >= 8000) {
        commands.push({ type: 'take_loan', amount: 10000 })
        expectedCash += 10000
      }
    }
    // The post-purchase cushion scales with the cost base: in an expensive
    // era (oil crisis) a flat floor lets one order push cash under water.
    const buffer = Math.max(5000, cashBuffer)
    const affordable = typesOnSale(yearOf(state)).filter((t) => t.price + buffer <= expectedCash)
    if (affordable.length > 0) {
      let pick = affordable[0]!
      for (const t of affordable) if (t.seats > pick.seats) pick = t
      commands.push({ type: 'order_aircraft', aircraftType: pick.id })
    }
  }

  if (airline.negotiations.length === 0 && airline.cash >= 4000) {
    // Target the city whose best competition-discounted pair with our
    // existing network is richest — not the biggest city on the map. Reach
    // includes what we could buy today, since slots outlive fleets.
    let reach = 0
    for (const ac of airline.fleet) reach = Math.max(reach, getAircraftType(ac.type).rangeKm)
    for (const t of typesOnSale(yearOf(state))) reach = Math.max(reach, t.rangeKm)
    // A new city only pays if it can pair with the NETWORK (routes must touch
    // it) — score against served cities, not every slot held.
    const anchors = [...networkCities(airline)].sort()
    let target: string | null = null
    let bestScore = 0
    for (const c of CITIES) {
      if ((airline.slots[c.id] ?? 0) > 0) continue
      if (slotsAllocated(state, c.id) >= c.slotPool) continue
      let cityScore = 0
      for (const h of anchors) {
        const km = distanceKm(c.id, h)
        if (km < AI_MIN_ROUTE_KM || km > reach) continue
        cityScore = Math.max(cityScore, pairScore(state, c.id, h))
      }
      if (cityScore > bestScore) {
        bestScore = cityScore
        target = c.id
      }
    }
    if (target !== null) {
      const spend = Math.max(NEG_MIN_SPEND, Math.min(negotiationDifficulty(target), airline.cash - 3000))
      if (spend >= NEG_MIN_SPEND && spend <= airline.cash) {
        commands.push({ type: 'negotiate_slots', city: target, spend })
      }
    }
  }

  const skip = launch.usedAircraft !== null ? new Set([launch.usedAircraft]) : undefined
  return [...commands, ...fareCommands(state), ...assignmentCommands(state, skip)]
}

export function botCommands(state: GameState, bot: BotName): Command[] {
  return bot === 'naive' ? naiveCommands(state) : greedyCommands(state)
}
