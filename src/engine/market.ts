// Route economics: the heart of the game (PLAN.md §2.2). Pure arithmetic plus
// stateless hash noise — no stream draws, so resolution order can never
// reshuffle another subsystem's randomness. Resolution has two phases:
// direct traffic on every contested pair, then connecting itineraries that
// fill spare seats across each airline's own network.

import { getAircraftType } from '../data/aircraft'
import { distanceKm, getCity, pairKey } from '../data/cities'
import {
  AIRCRAFT_ADMIN_PER_QUARTER,
  CABIN_WEIGHT,
  CREW_SALARY_BP_PER_QUARTER,
  CABIN_YIELD_BP,
  CONNECT_DETOUR_MAX_BP,
  CONNECT_FARE_DISCOUNT_BP,
  CONNECT_WILLING_BP,
  COST_INFLATION_BP_PER_QUARTER,
  CREW_COST_PER_BLOCK_HOUR,
  DEMAND_DIST_BANDS,
  DEMAND_GROWTH_BP_PER_QUARTER,
  DEMAND_GROWTH_LATE_BP_PER_QUARTER,
  DEMAND_GROWTH_TAPER_TURN,
  DEMAND_MASS_FLOOR,
  DEMAND_NOISE_SPREAD_BP,
  FARE_BASE,
  FARE_DEMAND_BP,
  FARE_LEVEL_PRICE_BP,
  FARE_LEVEL_WEIGHT,
  FARE_PER_100KM_FAR,
  FARE_PER_100KM_NEAR,
  FARE_TAPER_KM,
  FUEL_INFLATION_BP_PER_QUARTER,
  LANDING_FEE_BASE,
  LANDING_FEE_PER_SEAT,
  MARKETING_WEIGHT_BP_PER_LEVEL,
  OWNERSHIP_BP_PER_QUARTER,
  ROUTE_HISTORY_QUARTERS,
  ROUTE_MEMORY_QUARTERS,
  ROUTE_SPOOL_BP,
  SERVICE_COST_PER_PAX,
  SERVICE_LEVEL_WEIGHT,
  WEEKS_PER_QUARTER,
} from '../data/constants'
import { hashNoiseBp } from './rng'
import { allocateTrips, roundTripsPerWeek } from './queries'
import { cityDemandModBp, effEconomyBp, effFuelBp } from './worldEvents'
import type { Airline, GameEvent, GameState, Route } from './types'

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

export function fuelInflationBp(turn: number): number {
  return 10000 + FUEL_INFLATION_BP_PER_QUARTER * turn
}

// What one airframe of this type costs per quarter on a route of this length,
// $k, at today's fuel index and inflation — the shop's honest sticker. Mirrors
// resolveMarket's per-flight costs plus the fixed ownership stack from turn.ts.
export function estimateAircraftQuarterCost(state: GameState, typeId: string, km: number): number {
  const t = getAircraftType(typeId)
  if (km > t.rangeKm) return -1
  const rt = roundTripsPerWeek(typeId, km)
  const fuelBp = Math.floor((effFuelBp(state.world) * fuelInflationBp(state.turn)) / 10000)
  const weeklyFuel = Math.floor((rt * 2 * km * t.fuelPerKm * fuelBp) / 10000)
  const weeklyFees = rt * 2 * (LANDING_FEE_BASE + t.seats * LANDING_FEE_PER_SEAT)
  const weeklyCrewMin = rt * 2 * Math.floor((km * 60) / t.speedKmh)
  const weeklyCrew = Math.floor((weeklyCrewMin / 60) * CREW_COST_PER_BLOCK_HOUR)
  const inflated = Math.floor(((weeklyFees + weeklyCrew) * inflationBp(state.turn)) / 10000)
  const routeCost = Math.floor(((weeklyFuel + inflated) * WEEKS_PER_QUARTER) / 1000)
  const fixed =
    Math.floor((t.maintBase * inflationBp(state.turn)) / 10000) +
    Math.floor((t.price * OWNERSHIP_BP_PER_QUARTER) / 10000) +
    Math.floor((Math.floor((t.price * CREW_SALARY_BP_PER_QUARTER) / 10000) * inflationBp(state.turn)) / 10000) +
    Math.floor((AIRCRAFT_ADMIN_PER_QUARTER * inflationBp(state.turn)) / 10000)
  return routeCost + fixed
}

// Seats one airframe adds per week on the route (both directions).
export function estimateWeeklySeats(typeId: string, km: number): number {
  const t = getAircraftType(typeId)
  if (km > t.rangeKm) return 0
  return t.seats * roundTripsPerWeek(typeId, km) * 2
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
  const earlyTurns = Math.min(state.turn, DEMAND_GROWTH_TAPER_TURN)
  const lateTurns = Math.max(0, state.turn - DEMAND_GROWTH_TAPER_TURN)
  const growthBp =
    10000 + DEMAND_GROWTH_BP_PER_QUARTER * earlyTurns + DEMAND_GROWTH_LATE_BP_PER_QUARTER * lateTurns
  demand = Math.floor((demand * growthBp) / 10000)
  demand = Math.floor((demand * cityDemandModBp(state.world, a, getCity(a).region)) / 10000)
  demand = Math.floor((demand * cityDemandModBp(state.world, b, getCity(b).region)) / 10000)
  demand = Math.floor((demand * hashNoiseBp(state.seed, state.turn, pairKey(a, b), DEMAND_NOISE_SPREAD_BP)) / 10000)
  return demand
}

interface Entrant {
  airlineIdx: number
  route: Route
  weeklyRoundTrips: number
  weeklyCapacity: number // sellable seats, both directions, after cabin fits
  yieldBp: number // capacity-weighted cabin yield on revenue per pax
  weight: number // attractiveness for market-share split
}

// The attractiveness weight a route brings to a contested pair: schedule ×
// cabin appeal × fare posture × service. Zero when nothing flies. This is
// the exact number resolution splits share by — exported so the UI can show
// a pair battle honestly.
export function routeShareWeight(airline: Airline, route: Route): number {
  let cabinTripWeight = 0
  let capacity = 0
  for (const alloc of allocateTrips(airline, route)) {
    capacity += alloc.seats * alloc.trips * 2
    cabinTripWeight += alloc.trips * CABIN_WEIGHT[alloc.cabin - 1]!
  }
  if (capacity === 0) return 0
  const base = Math.floor(
    (cabinTripWeight * FARE_LEVEL_WEIGHT[route.fareLevel + 2]! * SERVICE_LEVEL_WEIGHT[route.serviceLevel - 1]!) /
      100,
  )
  // Brand: marketing spend buys pair appeal on every route the airline flies.
  return Math.floor((base * (10000 + airline.marketing * MARKETING_WEIGHT_BP_PER_LEVEL)) / 10000)
}

// How much of its demand share a route actually attaches, by quarters flown.
// Re-entering a recently served pair skips the ramp entirely — the market
// remembers. Exported so the UI can show "ramping" honestly.
export function routeSpoolBp(airline: Airline, route: Route, turn: number): number {
  const flown = route.history.length
  if (flown >= ROUTE_SPOOL_BP.length) return 10000
  const last = airline.servedUntil[pairKey(route.from, route.to)]
  if (last !== undefined && turn - last <= ROUTE_MEMORY_QUARTERS) return 10000
  return ROUTE_SPOOL_BP[flown] ?? 10000
}

// Per-route weekly accumulator, finalized to quarterly numbers at the end.
// Cost components are tracked separately (inflation already applied) so the
// quarterly report can attribute every dollar; weeklyCost is their sum.
interface RouteAcc {
  airlineIdx: number
  route: Route
  km: number
  weeklyPax: number
  weeklyTransfer: number
  weeklyCapacity: number
  yieldBp: number // capacity-weighted cabin yield on revenue per pax
  weeklyRevenue: number // $
  weeklyFuel: number // $
  weeklyFees: number // $
  weeklyFlightPay: number // $
  weeklyService: number // $
}

interface AirlineTotals {
  revenue: number // $k per quarter
  cost: number // $k per quarter (route-level costs only)
  pax: number // per quarter
  fuel: number // $k — route-cost components, summing to cost
  fees: number
  flightPay: number
  service: number
}

// Resolves every contested city pair, then routes connecting traffic over
// each airline's own network, writes each route's last* results, emits
// route_result events, and returns per-airline totals. Mutates state
// (callers clone at the entry point).
export function resolveMarket(state: GameState, events: GameEvent[]): AirlineTotals[] {
  const totals: AirlineTotals[] = state.airlines.map(() => ({
    revenue: 0,
    cost: 0,
    pax: 0,
    fuel: 0,
    fees: 0,
    flightPay: 0,
    service: 0,
  }))
  const marketFuelBp = effFuelBp(state.world)
  const fuelBpFor = (idx: number): number => {
    const hedge = state.airlines[idx]!.fuelHedge
    const base = hedge !== null && hedge.quartersLeft > 0 ? hedge.bp : marketFuelBp
    return Math.floor((base * fuelInflationBp(state.turn)) / 10000)
  }
  const inflBp = inflationBp(state.turn)

  // ---- Phase 1: direct traffic per contested pair ----
  const pairs = new Map<string, Entrant[]>()
  for (const airline of state.airlines) {
    for (const route of airline.routes) {
      let weeklyRoundTrips = 0
      let weeklyCapacity = 0
      let yieldNum = 0 // Σ seats × cabin yield — capacity-weighted revenue/pax
      for (const alloc of allocateTrips(airline, route)) {
        weeklyRoundTrips += alloc.trips
        weeklyCapacity += alloc.seats * alloc.trips * 2
        yieldNum += alloc.seats * alloc.trips * 2 * CABIN_YIELD_BP[alloc.cabin - 1]!
      }
      const weight = routeShareWeight(airline, route)
      const yieldBp = weeklyCapacity === 0 ? 10000 : Math.floor(yieldNum / weeklyCapacity)
      const key = pairKey(route.from, route.to)
      const list = pairs.get(key) ?? []
      list.push({ airlineIdx: airline.id, route, weeklyRoundTrips, weeklyCapacity, yieldBp, weight })
      pairs.set(key, list)
    }
  }

  const accs = new Map<number, RouteAcc>() // route id → accumulator (ids are per-airline but unique enough with airlineIdx check; key on composite)
  const accKey = (airlineIdx: number, routeId: number): number => airlineIdx * 1_000_000 + routeId

  for (const key of [...pairs.keys()].sort()) {
    const entrants = pairs.get(key)!
    const first = entrants[0]!
    const { from, to } = first.route
    const km = distanceKm(from, to)
    const demand = pairWeeklyDemand(state, from, to)

    // Split demand by attractiveness, shaped by fare elasticity (gouging
    // sheds pax even in a monopoly). Cap at capacity, then one spill pass.
    let totalWeight = 0
    for (const e of entrants) totalWeight += e.weight
    const attracted = entrants.map((e) => {
      if (totalWeight === 0) return 0
      let a = Math.floor((demand * e.weight) / totalWeight)
      a = Math.floor((a * FARE_DEMAND_BP[e.route.fareLevel + 2]!) / 10000)
      // Spool-up: young routes attach only part of their share until the
      // market learns them (monopoly or contested alike).
      a = Math.floor((a * routeSpoolBp(state.airlines[e.airlineIdx]!, e.route, state.turn)) / 10000)
      return a
    })
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
      const airline = state.airlines[e.airlineIdx]!
      const fuelBp = fuelBpFor(e.airlineIdx)
      let weeklyFuel = 0
      let weeklyFees = 0
      let weeklyCrewMin = 0
      for (const alloc of allocateTrips(airline, e.route)) {
        const t = getAircraftType(alloc.type)
        weeklyFuel += Math.floor((alloc.trips * 2 * km * t.fuelPerKm * fuelBp) / 10000)
        // Fees bill the physical airframe, not the cabin fit.
        weeklyFees += alloc.trips * 2 * (LANDING_FEE_BASE + t.seats * LANDING_FEE_PER_SEAT)
        weeklyCrewMin += alloc.trips * 2 * Math.floor((km * 60) / t.speedKmh)
      }
      const weeklyCrew = Math.floor((weeklyCrewMin / 60) * CREW_COST_PER_BLOCK_HOUR)
      const weeklyService = weeklyPax * SERVICE_COST_PER_PAX[e.route.serviceLevel - 1]!
      // Each component inflates and floors separately so attribution sums
      // exactly — the breakdown IS the cost, not an approximation of it.
      accs.set(accKey(e.airlineIdx, e.route.id), {
        airlineIdx: e.airlineIdx,
        route: e.route,
        km,
        weeklyPax,
        weeklyTransfer: 0,
        weeklyCapacity: e.weeklyCapacity,
        yieldBp: e.yieldBp,
        weeklyRevenue: Math.floor((weeklyPax * fare * e.yieldBp) / 10000),
        weeklyFuel,
        weeklyFees: Math.floor((weeklyFees * inflBp) / 10000),
        weeklyFlightPay: Math.floor((weeklyCrew * inflBp) / 10000),
        weeklyService: Math.floor((weeklyService * inflBp) / 10000),
      })
    }
  }

  // ---- Phase 2: connecting itineraries over each airline's own network ----
  // A share of unserved O/D demand will take a one-stop over a hub if both
  // legs exist, the detour is tolerable, and spare seats remain. Connecting
  // pax pay each leg's fare at a through discount and ride standby priority:
  // strictly after direct demand.
  for (const airline of state.airlines) {
    // Adjacency over legs that actually flew this quarter.
    const legsAt = new Map<string, RouteAcc[]>()
    const legByPair = new Map<string, RouteAcc>()
    for (const route of airline.routes) {
      const acc = accs.get(accKey(airline.id, route.id))
      if (!acc || acc.weeklyCapacity === 0) continue
      for (const city of [route.from, route.to]) {
        const list = legsAt.get(city) ?? []
        list.push(acc)
        legsAt.set(city, list)
      }
      legByPair.set(pairKey(route.from, route.to), acc)
    }
    const served = [...legsAt.keys()].sort()
    for (let i = 0; i < served.length; i++) {
      for (let j = i + 1; j < served.length; j++) {
        const a = served[i]!
        const c = served[j]!
        if (legByPair.has(pairKey(a, c))) continue // direct service wins
        const direct = distanceKm(a, c)
        // Best hub: both legs exist, minimal total detour within tolerance.
        let best: { leg1: RouteAcc; leg2: RouteAcc; total: number } | null = null
        for (const leg1 of legsAt.get(a)!) {
          const b = leg1.route.from === a ? leg1.route.to : leg1.route.from
          if (b === c) continue
          const leg2 = legByPair.get(pairKey(b, c))
          if (!leg2) continue
          const total = leg1.km + leg2.km
          if (total * 10000 > direct * CONNECT_DETOUR_MAX_BP) continue
          if (best === null || total < best.total) best = { leg1, leg2, total }
        }
        if (best === null) continue
        const spare1 = best.leg1.weeklyCapacity - best.leg1.weeklyPax
        const spare2 = best.leg2.weeklyCapacity - best.leg2.weeklyPax
        if (spare1 <= 0 || spare2 <= 0) continue
        const willing = Math.floor((pairWeeklyDemand(state, a, c) * CONNECT_WILLING_BP) / 10000)
        const take = Math.min(willing, spare1, spare2)
        if (take <= 0) continue
        for (const leg of [best.leg1, best.leg2]) {
          const legFare = Math.floor((fareFor(leg.km, leg.route.fareLevel) * CONNECT_FARE_DISCOUNT_BP) / 10000)
          const legService = Math.floor(
            (take * SERVICE_COST_PER_PAX[leg.route.serviceLevel - 1]! * inflBp) / 10000,
          )
          leg.weeklyPax += take
          leg.weeklyTransfer += take
          leg.weeklyRevenue += Math.floor((take * legFare * leg.yieldBp) / 10000)
          leg.weeklyService += legService
        }
      }
    }
  }

  // ---- Finalize: quarterly numbers, state, events — stable order ----
  for (const airline of state.airlines) {
    for (const route of airline.routes) {
      const acc = accs.get(accKey(airline.id, route.id))
      if (!acc) continue
      const revenue = Math.floor((acc.weeklyRevenue * WEEKS_PER_QUARTER) / 1000)
      const q = (weekly: number) => Math.floor((weekly * WEEKS_PER_QUARTER) / 1000)
      const fuel = q(acc.weeklyFuel)
      const fees = q(acc.weeklyFees)
      const flightPay = q(acc.weeklyFlightPay)
      const service = q(acc.weeklyService)
      const cost = fuel + fees + flightPay + service
      const quarterPax = acc.weeklyPax * WEEKS_PER_QUARTER
      const transferPax = acc.weeklyTransfer * WEEKS_PER_QUARTER
      route.lastPax = quarterPax
      route.lastCapacity = acc.weeklyCapacity * WEEKS_PER_QUARTER
      route.lastLoadFactorBp =
        acc.weeklyCapacity === 0 ? 0 : Math.floor((acc.weeklyPax * 10000) / acc.weeklyCapacity)
      route.lastRevenue = revenue
      route.lastCost = cost
      route.lastTransferPax = transferPax
      route.history.push({
        turn: state.turn,
        pax: quarterPax,
        transferPax,
        capacity: route.lastCapacity,
        loadFactorBp: route.lastLoadFactorBp,
        revenue,
        cost,
      })
      if (route.history.length > ROUTE_HISTORY_QUARTERS) route.history.shift()
      totals[airline.id]!.revenue += revenue
      totals[airline.id]!.cost += cost
      totals[airline.id]!.pax += quarterPax
      totals[airline.id]!.fuel += fuel
      totals[airline.id]!.fees += fees
      totals[airline.id]!.flightPay += flightPay
      totals[airline.id]!.service += service
      events.push({
        type: 'route_result',
        airline: airline.id,
        routeId: route.id,
        pax: quarterPax,
        capacity: route.lastCapacity,
        loadFactorBp: route.lastLoadFactorBp,
        transferPax,
        revenue,
        cost,
      })
    }
  }

  return totals
}
