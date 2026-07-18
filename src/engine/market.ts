// Route economics: the heart of the game (PLAN.md §2.2). Pure arithmetic plus
// stateless hash noise — no stream draws, so resolution order can never
// reshuffle another subsystem's randomness.

import { getAircraftType } from '../data/aircraft'
import { distanceKm, getCity, pairKey } from '../data/cities'
import {
  COST_INFLATION_BP_PER_QUARTER,
  CREW_COST_PER_BLOCK_HOUR,
  DEMAND_DIST_BANDS,
  DEMAND_GROWTH_BP_PER_QUARTER,
  DEMAND_MASS_FLOOR,
  DEMAND_NOISE_SPREAD_BP,
  FARE_BASE,
  FARE_LEVEL_PRICE_BP,
  FARE_LEVEL_WEIGHT,
  FARE_PER_100KM_FAR,
  FARE_PER_100KM_NEAR,
  FARE_TAPER_KM,
  LANDING_FEE_BASE,
  LANDING_FEE_PER_SEAT,
  SERVICE_COST_PER_PAX,
  SERVICE_LEVEL_WEIGHT,
  WEEKS_PER_QUARTER,
} from '../data/constants'
import { hashNoiseBp } from './rng'
import { roundTripsPerWeek } from './queries'
import { cityDemandModBp, effEconomyBp, effFuelBp } from './worldEvents'
import type { GameEvent, GameState, Route } from './types'

function cityMass(cityId: string): number {
  const c = getCity(cityId)
  return c.pop * 4 + c.biz * 3 + c.tour * 2
}

function distBandFactor(km: number): number {
  for (const [maxKm, factor] of DEMAND_DIST_BANDS) {
    if (km <= maxKm) return factor
  }
  return DEMAND_DIST_BANDS[DEMAND_DIST_BANDS.length - 1]![1]
}

// Era cost inflation multiplier (bp) at a given turn.
export function inflationBp(turn: number): number {
  return 10000 + COST_INFLATION_BP_PER_QUARTER * turn
}

// One-way base fare in $, concave with distance.
export function baseFare(km: number): number {
  const near = Math.min(km, FARE_TAPER_KM)
  const far = Math.max(0, km - FARE_TAPER_KM)
  return FARE_BASE + Math.floor((near * FARE_PER_100KM_NEAR) / 100) + Math.floor((far * FARE_PER_100KM_FAR) / 100)
}

export function fareFor(km: number, fareLevel: number): number {
  return Math.floor((baseFare(km) * FARE_LEVEL_PRICE_BP[fareLevel + 2]!) / 10000)
}

// Total weekly pax demand on a city pair (both directions summed).
export function pairWeeklyDemand(state: GameState, a: string, b: string): number {
  const raw = cityMass(a) * cityMass(b) - DEMAND_MASS_FLOOR
  if (raw <= 0) return 0
  const km = distanceKm(a, b)
  let demand = Math.floor((raw * 100) / distBandFactor(km))
  demand = Math.floor((demand * effEconomyBp(state.world)) / 10000)
  demand = Math.floor((demand * (10000 + DEMAND_GROWTH_BP_PER_QUARTER * state.turn)) / 10000)
  demand = Math.floor((demand * cityDemandModBp(state.world, a, getCity(a).region)) / 10000)
  demand = Math.floor((demand * cityDemandModBp(state.world, b, getCity(b).region)) / 10000)
  demand = Math.floor((demand * hashNoiseBp(state.seed, state.turn, pairKey(a, b), DEMAND_NOISE_SPREAD_BP)) / 10000)
  return demand
}

interface Entrant {
  airlineIdx: number
  route: Route
  weeklyRoundTrips: number // summed over assigned aircraft
  weeklyCapacity: number // seats, both directions
  weight: number // attractiveness for market-share split
}

interface AirlineTotals {
  revenue: number // $k per quarter
  cost: number // $k per quarter (route-level costs only)
  pax: number // per quarter
}

// Resolves every contested city pair, writes each route's last* results,
// emits route_result events, and returns per-airline totals. Mutates state
// (callers clone at the entry point).
export function resolveMarket(state: GameState, events: GameEvent[]): AirlineTotals[] {
  const totals: AirlineTotals[] = state.airlines.map(() => ({ revenue: 0, cost: 0, pax: 0 }))
  const fuelBp = effFuelBp(state.world)

  // Collect entrants per pair in stable order (airline index, then route id).
  const pairs = new Map<string, Entrant[]>()
  for (const airline of state.airlines) {
    for (const route of airline.routes) {
      const km = distanceKm(route.from, route.to)
      let weeklyRoundTrips = 0
      let weeklyCapacity = 0
      for (const ac of airline.fleet) {
        if (ac.routeId !== route.id) continue
        const t = getAircraftType(ac.type)
        const rt = roundTripsPerWeek(ac.type, km)
        weeklyRoundTrips += rt
        weeklyCapacity += t.seats * rt * 2
      }
      const weight =
        weeklyCapacity === 0
          ? 0
          : weeklyRoundTrips *
            FARE_LEVEL_WEIGHT[route.fareLevel + 2]! *
            SERVICE_LEVEL_WEIGHT[route.serviceLevel - 1]!
      const key = pairKey(route.from, route.to)
      const list = pairs.get(key) ?? []
      list.push({ airlineIdx: airline.id, route, weeklyRoundTrips, weeklyCapacity, weight })
      pairs.set(key, list)
    }
  }

  for (const key of [...pairs.keys()].sort()) {
    const entrants = pairs.get(key)!
    const first = entrants[0]!
    const { from, to } = first.route
    const km = distanceKm(from, to)
    const demand = pairWeeklyDemand(state, from, to)

    // Split demand by attractiveness, cap at capacity, then one spill pass:
    // unmet demand flows to entrants with spare seats, pro rata.
    let totalWeight = 0
    for (const e of entrants) totalWeight += e.weight
    const attracted = entrants.map((e) =>
      totalWeight === 0 ? 0 : Math.floor((demand * e.weight) / totalWeight),
    )
    const pax = entrants.map((e, i) => Math.min(attracted[i]!, e.weeklyCapacity))
    let unmet = 0
    let spare = 0
    for (let i = 0; i < entrants.length; i++) {
      unmet += attracted[i]! - pax[i]!
      spare += entrants[i]!.weeklyCapacity - pax[i]!
    }
    if (unmet > 0 && spare > 0) {
      const spill = Math.min(unmet, spare)
      for (let i = 0; i < entrants.length; i++) {
        pax[i] = pax[i]! + Math.floor((spill * (entrants[i]!.weeklyCapacity - pax[i]!)) / spare)
      }
    }

    for (let i = 0; i < entrants.length; i++) {
      const e = entrants[i]!
      const weeklyPax = pax[i]!
      const fare = fareFor(km, e.route.fareLevel)

      // Weekly costs in $, converted to $k per quarter at the end.
      let weeklyFuel = 0
      let weeklyFees = 0
      let weeklyCrewMin = 0
      const airline = state.airlines[e.airlineIdx]!
      for (const ac of airline.fleet) {
        if (ac.routeId !== e.route.id) continue
        const t = getAircraftType(ac.type)
        const rt = roundTripsPerWeek(ac.type, km)
        weeklyFuel += Math.floor((rt * 2 * km * t.fuelPerKm * fuelBp) / 10000)
        weeklyFees += rt * 2 * (LANDING_FEE_BASE + t.seats * LANDING_FEE_PER_SEAT)
        weeklyCrewMin += rt * 2 * Math.floor((km * 60) / t.speedKmh)
      }
      const weeklyCrew = Math.floor((weeklyCrewMin / 60) * CREW_COST_PER_BLOCK_HOUR)
      const weeklyService = weeklyPax * SERVICE_COST_PER_PAX[e.route.serviceLevel - 1]!
      const weeklyRevenue = weeklyPax * fare

      // Crew, fees, and service inflate with the era; fuel rides its own index.
      const inflated = Math.floor(
        ((weeklyFees + weeklyCrew + weeklyService) * inflationBp(state.turn)) / 10000,
      )
      const revenue = Math.floor((weeklyRevenue * WEEKS_PER_QUARTER) / 1000)
      const cost = Math.floor(((weeklyFuel + inflated) * WEEKS_PER_QUARTER) / 1000)
      const quarterPax = weeklyPax * WEEKS_PER_QUARTER

      e.route.lastPax = quarterPax
      e.route.lastCapacity = e.weeklyCapacity * WEEKS_PER_QUARTER
      e.route.lastLoadFactorBp =
        e.weeklyCapacity === 0 ? 0 : Math.floor((weeklyPax * 10000) / e.weeklyCapacity)
      e.route.lastRevenue = revenue
      e.route.lastCost = cost

      totals[e.airlineIdx]!.revenue += revenue
      totals[e.airlineIdx]!.cost += cost
      totals[e.airlineIdx]!.pax += quarterPax

      events.push({
        type: 'route_result',
        airline: e.airlineIdx,
        routeId: e.route.id,
        pax: quarterPax,
        capacity: e.route.lastCapacity,
        loadFactorBp: e.route.lastLoadFactorBp,
        revenue,
        cost,
      })
    }
  }

  return totals
}
