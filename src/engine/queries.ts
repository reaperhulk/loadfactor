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
} from '../data/constants'
import { distanceKm, pairKey } from '../data/cities'
import { getScenario } from '../data/scenarios'
import type { Airline, GameState, Route } from './types'

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
export function roundTripsPerWeek(type: string, km: number): number {
  const t = getAircraftType(type)
  const roundTripMin = 2 * (Math.floor((km * 60) / t.speedKmh) + t.turnaroundMin)
  return Math.floor(WEEKLY_BLOCK_MINUTES / roundTripMin)
}

// Most round trips per week the assigned fleet could fly on this route.
export function maxRouteFrequency(airline: Airline, route: Route): number {
  const km = distanceKm(route.from, route.to)
  let max = 0
  for (const a of airline.fleet) {
    if (a.routeId === route.id) max += roundTripsPerWeek(a.type, km)
  }
  return max
}

// The schedule actually flown: the requested frequency, capped by the fleet.
export function effectiveFrequency(airline: Airline, route: Route): number {
  return Math.min(route.frequency, maxRouteFrequency(airline, route))
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
export function allocateTrips(airline: Airline, route: Route): TripAllocation[] {
  const km = distanceKm(route.from, route.to)
  let remaining = effectiveFrequency(airline, route)
  const out: TripAllocation[] = []
  for (const a of airline.fleet) {
    if (a.routeId !== route.id) continue
    const trips = Math.min(roundTripsPerWeek(a.type, km), remaining)
    remaining -= trips
    out.push({ aircraftId: a.id, type: a.type, cabin: a.cabin, seats: cabinSeats(a.type, a.cabin), trips })
  }
  return out
}

// Weekly seat capacity (both directions summed) an airline fields on a route.
export function routeWeeklyCapacity(airline: Airline, route: Route): number {
  let seats = 0
  for (const alloc of allocateTrips(airline, route)) {
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
