// Rival airline AI. Lives in the engine because rivals are part of the sim:
// their decisions must be deterministic and derived only from state + the
// rivals RNG stream. They act through the exact same command validator as the
// player (PLAN.md §3.3 step 1).

import { typesOnSale, getAircraftType } from '../data/aircraft'
import { CITIES, distanceKm, pairKey } from '../data/cities'
import { NEG_MIN_SPEND } from '../data/constants'
import { applyPlanningCommand } from './commands'
import { pairWeeklyDemand } from './market'
import { negotiationDifficulty } from './negotiation'
import {
  debtCeiling,
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

// One rival's planning turn. Greedy policy: stay solvent, keep planes flying,
// open the best reachable route, buy the biggest sensible jet, push into the
// best new city. Mutates state via applyPlanningCommand only.
export function runRivalTurn(state: GameState, idx: number, events: GameEvent[]): void {
  const airline = state.airlines[idx]
  if (!airline || airline.bankrupt) return

  // Borrow when the cash buffer is thin and there is real debt room.
  if (airline.cash < 3000) {
    const room = debtCeiling(airline) - totalDebt(airline)
    if (room >= 5000) apply(state, idx, { type: 'take_loan', amount: Math.min(room, 8000) }, events)
  }

  // Assign idle aircraft to the route that is most starved for seats.
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
    if (bestRoute !== null) apply(state, idx, { type: 'assign_aircraft', aircraftId: ac.id, routeId: bestRoute }, events)
  }

  // Open the highest-demand unserved pair among cities we hold slots at —
  // but only if there is (or soon will be) an aircraft with the range for it.
  const idleOrIncoming =
    airline.fleet.some((a) => a.routeId === null) || airline.orders.length > 0 || airline.routes.length === 0
  if (idleOrIncoming) {
    let maxRange = 0
    for (const ac of airline.fleet) maxRange = Math.max(maxRange, getAircraftType(ac.type).rangeKm)
    for (const o of airline.orders) maxRange = Math.max(maxRange, getAircraftType(o.type).rangeKm)
    const cities = slotCities(airline)
    const served = new Set(airline.routes.map((r) => pairKey(r.from, r.to)))
    let best: { from: string; to: string } | null = null
    let bestDemand = 0
    for (let i = 0; i < cities.length; i++) {
      for (let j = i + 1; j < cities.length; j++) {
        const a = cities[i]!
        const b = cities[j]!
        if (served.has(pairKey(a, b))) continue
        if (slotsFree(airline, a) < 1 || slotsFree(airline, b) < 1) continue
        if (distanceKm(a, b) > maxRange) continue
        const demand = pairWeeklyDemand(state, a, b)
        if (demand > bestDemand) {
          bestDemand = demand
          best = { from: a, to: b }
        }
      }
    }
    if (best && bestDemand > 300) apply(state, idx, { type: 'open_route', ...best }, events)
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
  const flip = chanceBp(state.rng.rivals, 7000)
  state.rng.rivals = flip.rng
  if (flip.value && (networkFull || bootstrapping) && airline.orders.length === 0) {
    const buffer = 5000
    const affordable = typesOnSale(yearOf(state)).filter((t) => t.price + buffer <= airline.cash)
    if (affordable.length > 0) {
      let pick = affordable[0]!
      for (const t of affordable) if (t.seats > pick.seats) pick = t
      apply(state, idx, { type: 'order_aircraft', aircraftType: pick.id }, events)
    }
  }

  // Push into the most attractive city we do not hold slots at yet.
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
        apply(state, idx, { type: 'negotiate_slots', city: target, spend }, events)
      }
    }
  }
}
