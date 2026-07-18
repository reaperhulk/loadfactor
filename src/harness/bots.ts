// Strategy bots: pure functions of GameState → the player's planning commands
// for this quarter. No RNG — a bot's whole career is determined by the seed's
// effect on the world. Bots drive golden tests, the balance envelope, and CI
// careers (PLAN.md §5.6).

import { getAircraftType, typesOnSale } from '../data/aircraft'
import { CITIES, distanceKm, pairKey } from '../data/cities'
import { NEG_MIN_SPEND } from '../data/constants'
import { pairWeeklyDemand } from '../engine/market'
import { negotiationDifficulty } from '../engine/negotiation'
import {
  debtCeiling,
  routeWeeklyCapacity,
  slotCities,
  slotsAllocated,
  slotsFree,
  totalDebt,
  yearOf,
} from '../engine/queries'
import type { Command, GameState } from '../engine/types'

export type BotName = 'naive' | 'greedy'

// Shared: assign every idle aircraft to the route most starved for seats.
function assignmentCommands(state: GameState): Command[] {
  const airline = state.airlines[0]!
  const commands: Command[] = []
  // Track pending capacity so two idle aircraft do not pile onto one route.
  const pendingCapacity = new Map<number, number>()
  for (const ac of airline.fleet) {
    if (ac.routeId !== null) continue
    const type = getAircraftType(ac.type)
    let bestRoute: number | null = null
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
        bestRoute = route.id
      }
    }
    if (bestRoute !== null) {
      commands.push({ type: 'assign_aircraft', aircraftId: ac.id, routeId: bestRoute })
      pendingCapacity.set(bestRoute, (pendingCapacity.get(bestRoute) ?? 0) + type.seats * 20)
    }
  }
  return commands
}

function bestUnservedPair(state: GameState): { from: string; to: string; demand: number } | null {
  const airline = state.airlines[0]!
  // Only consider pairs some current or incoming airframe could actually fly.
  let maxRange = 0
  for (const ac of airline.fleet) maxRange = Math.max(maxRange, getAircraftType(ac.type).rangeKm)
  for (const o of airline.orders) maxRange = Math.max(maxRange, getAircraftType(o.type).rangeKm)
  const cities = slotCities(airline)
  const served = new Set(airline.routes.map((r) => pairKey(r.from, r.to)))
  let best: { from: string; to: string; demand: number } | null = null
  for (let i = 0; i < cities.length; i++) {
    for (let j = i + 1; j < cities.length; j++) {
      const a = cities[i]!
      const b = cities[j]!
      if (served.has(pairKey(a, b))) continue
      if (slotsFree(airline, a) < 1 || slotsFree(airline, b) < 1) continue
      if (distanceKm(a, b) > maxRange) continue
      const demand = pairWeeklyDemand(state, a, b)
      if (demand > (best?.demand ?? 0)) best = { from: a, to: b, demand }
    }
  }
  return best
}

// Naive: opens whatever route it can and parks planes on it. Never orders,
// never negotiates, never borrows, never touches fares. The balance envelope
// expects this bot to survive early but lose the scenario.
function naiveCommands(state: GameState): Command[] {
  const commands: Command[] = []
  const pair = bestUnservedPair(state)
  if (pair && state.airlines[0]!.fleet.some((a) => a.routeId === null)) {
    commands.push({ type: 'open_route', from: pair.from, to: pair.to })
  }
  return [...commands, ...assignmentCommands(state)]
}

// Greedy: expand routes, buy the biggest affordable jet, push into the best
// new city, borrow when thin. Mirrors the rival policy minus the coin flips.
function greedyCommands(state: GameState): Command[] {
  const airline = state.airlines[0]!
  const commands: Command[] = []

  if (airline.cash < 3000) {
    const room = debtCeiling(airline) - totalDebt(airline)
    if (room >= 5000) commands.push({ type: 'take_loan', amount: Math.min(room, 8000) })
  }

  const idleOrIncoming =
    airline.fleet.some((a) => a.routeId === null) || airline.orders.length > 0 || airline.routes.length === 0
  const pair = bestUnservedPair(state)
  if (idleOrIncoming && pair && pair.demand > 300) {
    commands.push({ type: 'open_route', from: pair.from, to: pair.to })
  }

  // Capacity discipline: only buy when the network is actually full (or we
  // are still fielding the starter fleet). Expansion follows demand, not cash.
  let lastPax = 0
  let lastCapacity = 0
  for (const route of airline.routes) {
    lastPax += route.lastPax
    lastCapacity += route.lastCapacity
  }
  const networkFull = lastCapacity > 0 && lastPax * 10000 >= lastCapacity * 7500
  const bootstrapping = airline.fleet.length + airline.orders.length < 4
  if (networkFull || bootstrapping) {
    const buffer = 5000
    const affordable = typesOnSale(yearOf(state)).filter((t) => t.price + buffer <= airline.cash)
    if (affordable.length > 0 && airline.orders.length === 0) {
      let pick = affordable[0]!
      for (const t of affordable) if (t.seats > pick.seats) pick = t
      commands.push({ type: 'order_aircraft', aircraftType: pick.id })
    }
  }

  if (airline.negotiations.length === 0 && airline.cash >= 4000) {
    let target: string | null = null
    let bestMass = 0
    for (const c of CITIES) {
      if ((airline.slots[c.id] ?? 0) > 0) continue
      if (slotsAllocated(state, c.id) >= c.slotPool) continue
      const mass = c.pop * 4 + c.biz * 3 + c.tour * 2
      if (mass > bestMass) {
        bestMass = mass
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

  return [...commands, ...assignmentCommands(state)]
}

export function botCommands(state: GameState, bot: BotName): Command[] {
  return bot === 'naive' ? naiveCommands(state) : greedyCommands(state)
}
