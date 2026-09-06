import { weeklyPlan } from './operations'
// Pure derived values over GameState. Shared by command validation, quarter
// resolution, rival policies, and the UI — one definition of every number.

import { getAircraftType } from '../data/aircraft'
import {
  BASE_LOAN_RATE_BP,
  CABIN_SEATS_BP,
  DEBT_BASE_ALLOWANCE,
  DEBT_LTV_BP,
  RESALE_DECAY_BP_PER_QUARTER,
  RESALE_FLOOR_BP,
  LOAN_RATE_ECONOMY_SLOPE,
  MIN_LOAN_RATE_BP,
  RESALE_INITIAL_BP,
  WEEKLY_BLOCK_MINUTES,
  REPUTATION_APPEAL_WEIGHT_BP,
} from '../data/constants'
import { distanceKm, pairKey } from '../data/cities'
import { getScenario } from '../data/scenarios'
import type { ObjectiveKind } from '../data/scenarios'
import type { Airline, GameState, Route, OwnedAircraft } from './types'

// Today's market rate for a new loan: base plus a spread that widens as the
// economy sours. One definition, shared by take_loan and the finance panel.
export function currentLoanRateBp(state: GameState): number {
  return Math.max(
    MIN_LOAN_RATE_BP,
    BASE_LOAN_RATE_BP + Math.floor((10000 - state.world.economyBp) / LOAN_RATE_ECONOMY_SLOPE),
  )
}

export function yearOf(state: GameState): number {
  return getScenario(state.scenario).startYear + Math.floor(state.turn / 4)
}

export function quarterOf(state: GameState): number {
  return (state.turn % 4) + 1
}

// Resale value of one airframe, $k.
export function resaleValue(type: string, ageQuarters: number): number {
  const t = getAircraftType(type)
  const bp = Math.max(RESALE_FLOOR_BP, RESALE_INITIAL_BP - RESALE_DECAY_BP_PER_QUARTER * ageQuarters)
  return Math.floor((t.price * bp) / 10000)
}

export function fleetValue(airline: Airline): number {
  let total = 0
  for (const a of airline.fleet) {
    if (!a.leased) total += resaleValue(a.type, a.ageQuarters)
  }
  return total
}

export function totalDebt(airline: Airline): number {
  let total = 0
  for (const l of airline.loans) total += l.principal
  return total
}

export function netWorth(airline: Airline): number {
  return airline.cash + fleetValue(airline) - totalDebt(airline)
}

export function debtCeiling(airline: Airline): number {
  return Math.floor((fleetValue(airline) * DEBT_LTV_BP) / 10000) + DEBT_BASE_ALLOWANCE
}

export function findRoute(airline: Airline, routeId: number): Route | undefined {
  return airline.routes.find((r) => r.id === routeId)
}

// Slots an airline is currently using at a city (each route consumes one slot
// at each endpoint).
export function slotsUsed(airline: Airline, city: string): number {
  let used = 0
  for (const r of airline.routes) if (r.from === city || r.to === city) used++
  return used
}

export function slotsHeld(airline: Airline, city: string): number {
  return airline.slots[city] ?? 0
}

export function slotsFree(airline: Airline, city: string): number {
  return slotsHeld(airline, city) - slotsUsed(airline, city)
}

// Slots allocated across all airlines at a city (vs the city's slotPool).
export function slotsAllocated(state: GameState, city: string): number {
  let total = 0
  for (const a of state.airlines) total += a.slots[city] ?? 0
  return total
}

// Weekly round trips one airframe can fly on a route of this distance.
export function roundTripsPerWeek(type: string, km: number, reserveBp = 0): number {
  const t = getAircraftType(type)
  const roundTripMin = 2 * (Math.floor((km * 60) / t.speedKmh) + t.turnaroundMin)
  return Math.floor(Math.floor(WEEKLY_BLOCK_MINUTES * (10000 - reserveBp) / 10000) / roundTripMin)
}

// Reserve substitutions are derived globally in stable fleet order so one
// spare cannot cover two grounded aircraft. They consume the spare's hours.
export function operatingFleet(airline: Airline, turn: number): OwnedAircraft[] {
  const out = airline.fleet.filter((a) => !a.reserve && !isGrounded(a, turn))
  if (turn < 0) return out
  const reserves = airline.fleet.filter((a) => a.reserve && a.routeId === null && !isGrounded(a, turn))
  for (const unavailable of airline.fleet) {
    if (!isGrounded(unavailable, turn) || unavailable.routeId === null) continue
    const routes = airline.routes.filter((r) => r.id === unavailable.routeId || r.id === unavailable.secondaryRouteId)
    const at = reserves.findIndex((a) => routes.every((r) => distanceKm(r.from, r.to) <= getAircraftType(a.type).rangeKm))
    if (at < 0) continue
    const reserve = reserves.splice(at, 1)[0]!
    out.push({ ...reserve, routeId: unavailable.routeId, secondaryRouteId: unavailable.secondaryRouteId })
  }
  return out
}
function tripsOnRoute(aircraft: OwnedAircraft, route: Route): number {
  if (aircraft.routeId !== route.id && aircraft.secondaryRouteId !== route.id) return 0
  const share = aircraft.secondaryRouteId === undefined ? 10000 : aircraft.routeId === route.id ? 6000 : 4000
  return Math.floor(roundTripsPerWeek(aircraft.type, distanceKm(route.from, route.to)) * share / 10000)
}
export function maxRouteFrequency(airline: Airline, route: Route, turn = -1): number {
  if (airline.operationsPolicy) return (weeklyPlan(airline, { ...route, frequency: 1000000 }).get(route.id) ?? []).reduce((n, a) => n + a.trips, 0)
  return operatingFleet(airline, turn).reduce((sum, a) => sum + tripsOnRoute(a, route), 0)
}

// An airframe in the hangar for maintenance flies nothing. `turn` of -1 means
// "ignore grounding" — used by planning-time views that ask what the fleet
// could fly, not what it flew this quarter.
export function isGrounded(aircraft: { groundedUntil?: number }, turn: number): boolean {
  return turn >= 0 && aircraft.groundedUntil !== undefined && turn < aircraft.groundedUntil
}

// The schedule actually flown: the requested frequency, capped by the fleet.
export function effectiveFrequency(airline: Airline, route: Route, turn = -1): number {
  return Math.min(route.frequency, maxRouteFrequency(airline, route, turn))
}

// Sellable seats on one airframe after its cabin fit.
export function cabinSeats(type: string, cabin: number): number {
  return Math.floor((getAircraftType(type).seats * CABIN_SEATS_BP[cabin - 1]!) / 10000)
}

export interface TripAllocation {
  aircraftId: number
  type: string
  cabin: number
  seats: number // sellable seats per leg, after the cabin fit
  trips: number // round trips this airframe flies this week
}

// Distribute the effective frequency across the assigned fleet in stable
// fleet order — each airframe flies up to its own weekly maximum.
export function allocateTrips(airline: Airline, route: Route, turn = -1): TripAllocation[] {
  if (airline.operationsPolicy) return weeklyPlan(airline, route).get(route.id) ?? []
  let remaining = effectiveFrequency(airline, route, turn)
  const out: TripAllocation[] = []
  for (const a of operatingFleet(airline, turn)) {
    if (a.routeId !== route.id && a.secondaryRouteId !== route.id) continue
    const trips = Math.min(tripsOnRoute(a, route), remaining)
    remaining -= trips
    out.push({ aircraftId: a.id, type: a.type, cabin: a.cabin, seats: cabinSeats(a.type, a.cabin), trips })
  }
  return out
}

// Weekly seat capacity (both directions summed) an airline fields on a route.
export function routeWeeklyCapacity(airline: Airline, route: Route, turn = -1): number {
  let seats = 0
  for (const alloc of allocateTrips(airline, route, turn)) {
    seats += alloc.seats * alloc.trips * 2
  }
  return seats
}

// Cities in an airline's operating network: the HQ plus every endpoint it
// currently serves. New routes must touch this set — airlines build networks,
// not disconnected cherry-picked pairs (PLAN.md §2.2).
export function networkCities(airline: Airline): Set<string> {
  const network = new Set<string>([airline.hq])
  for (const r of airline.routes) {
    network.add(r.from)
    network.add(r.to)
  }
  return network
}

// Weekly seats all airlines together field on a pair — how contested the
// market already is in hardware, not just in flags on a map.
export function pairWeeklySeats(state: GameState, a: string, b: string): number {
  const key = pairKey(a, b)
  let seats = 0
  for (const airline of state.airlines) {
    for (const r of airline.routes) {
      if (pairKey(r.from, r.to) === key) seats += routeWeeklyCapacity(airline, r)
    }
  }
  return seats
}

// Airlines serving a pair, optionally excluding one (for "my competitors").
export function airlinesOnPair(state: GameState, a: string, b: string, excludeIdx?: number): number {
  const key = pairKey(a, b)
  let n = 0
  for (const airline of state.airlines) {
    if (airline.id === excludeIdx) continue
    if (airline.routes.some((r) => pairKey(r.from, r.to) === key)) n++
  }
  return n
}

// Stable sorted city ids an airline holds slots at (object-key iteration is
// banned in resolution paths — this is the one sanctioned accessor).
export function slotCities(airline: Airline): string[] {
  return Object.keys(airline.slots)
    .filter((c) => (airline.slots[c] ?? 0) > 0)
    .sort()
}

// The era's own measure of a great airline (PLAN.md §2.4). Pure over an
// airline's recorded history plus its balance sheet, so the UI, the engine's
// victory check, and the bots all read the identical number.
//
// loadFactor is reported in basis points (10000 = every seat sold).
export function objectiveScore(airline: Airline, kind: ObjectiveKind): number {
  switch (kind) {
    case 'netWorth':
      return netWorth(airline)
    case 'profit': {
      let total = 0
      for (const h of airline.history) total += h.profit
      return total
    }
    case 'pax': {
      let total = 0
      for (const h of airline.history) total += h.pax
      return total
    }
    case 'transfer': {
      let total = 0
      for (const h of airline.history) total += h.transferPax ?? 0
      return total
    }
    case 'loadFactor': {
      let pax = 0
      let seats = 0
      for (const h of airline.history) {
        pax += h.pax
        seats += h.capacity ?? 0
      }
      // Never flew a seat, never filled one: an airline with no capacity
      // scores zero rather than dividing by nothing.
      if (seats <= 0) return 0
      return Math.floor((pax * 10000) / seats) // basis points
    }
  }
}

// The same score computed over only the first `quarters` recorded quarters —
// lets the engine tell "just crossed a milestone" from "was already past it".
export function objectiveScoreAt(airline: Airline, kind: ObjectiveKind, quarters: number): number {
  // Net worth is a balance-sheet reading, not a sum over history — slicing
  // the history would return today's number and no crossing would ever be
  // detected. Read what the books actually said that quarter.
  if (kind === 'netWorth') return airline.history[quarters - 1]?.netWorth ?? 0
  return objectiveScore({ ...airline, history: airline.history.slice(0, quarters) }, kind)
}

// True when `a` is doing better than `b` on this era's metric.
export function objectiveBeats(a: number, b: number, higherIsBetter: boolean): boolean {
  return higherIsBetter ? a > b : a < b
}

// True when a score clears the era's qualifying bar.
export function objectiveMet(score: number, target: number, higherIsBetter: boolean): boolean {
  return higherIsBetter ? score >= target : score <= target
}

// Reputation as an appeal multiplier (10000 = no effect). A spotless operator
// gets no bonus; a battered one carries a real but survivable penalty.
export function reputationAppealBp(airline: Airline): number {
  const rep = airline.reputationBp ?? 10000
  if (rep >= 10000) return 10000
  return 10000 - Math.floor(((10000 - rep) * REPUTATION_APPEAL_WEIGHT_BP) / 10000)
}

// Scale requirements prevent winning a load-factor race by flying a token
// schedule. Legacy careers retain their original qualification rules.
export function objectiveQualified(state: GameState, airline: Airline): boolean {
  if ((state.rulesVersion ?? 1) < 2) return true
  const scenario = getScenario(state.scenario)
  const obj = scenario.objective
  const minimumPax = obj.minimumPax ?? (obj.kind === 'loadFactor' ? 1500000 : 0)
  const active = airline.routes.filter((r) => r.lastCapacity > 0)
  return objectiveScore(airline, 'pax') >= minimumPax && active.length >= (obj.minimumRoutes ?? (obj.kind === 'loadFactor' ? 3 : 0)) &&
    active.filter((r) => distanceKm(r.from, r.to) >= 4500).length >= (obj.minimumLongHaul ?? 0)
}
