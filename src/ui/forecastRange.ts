// The forecast is a point; the quarter is not. This turns the planning
// forecast into a likely range by adding up the things the forecast holds
// fixed and the engine does not: the demand and fuel walks, expiring events
// (which end BEFORE the quarter's market resolves — PLAN §3.3 step 4 precedes
// step 5), contested pairs where a rival can move, and announced campaigns
// aimed at the airline's own markets. Every driver names itself so the review
// can say what could move the number. Presentation only — nothing here enters
// the simulation.

import { getEventDef } from '../data/events'
import { DEMAND_NOISE_SPREAD_BP, ECONOMY_STEP_BP, FUEL_STEP_BP } from '../data/constants'
import { getCity, pairKey } from '../data/cities'
import type { GameState, Route } from '../engine'
import type { forecastQuarter } from '../engine/forecast'

export interface RangeDriver {
  label: string
  low: number // $k, ≤ 0
  high: number // $k, ≥ 0
}

export interface ForecastRange {
  low: number
  high: number
  drivers: RangeDriver[]
}

// Rival appetite on a shared pair: what a fare or schedule move there could
// swing of the route's revenue, either way.
const CONTEST_SWING_BP = 1500
// An announced raid or price campaign aimed at one of our markets: downside
// only, and larger — it is coming for the traffic.
const CAMPAIGN_SWING_BP = 2500

export function forecastRange(state: GameState, seat: number, forecast: ReturnType<typeof forecastQuarter>): ForecastRange {
  const airline = state.airlines[seat]!
  const drivers: RangeDriver[] = []
  const revenueOf = (routes: readonly Route[]): number => {
    // The forecast's route results are this quarter's expected revenue.
    let total = 0
    for (const r of routes) total += r.lastRevenue
    return total
  }
  const revenue = forecast.revenue

  // Demand noise and the economy walk: symmetric, on all revenue.
  const demandSwing = Math.floor((revenue * (DEMAND_NOISE_SPREAD_BP / 2 + ECONOMY_STEP_BP)) / 10000)
  if (demandSwing > 0) drivers.push({ label: 'Demand noise and the economy walk', low: -demandSwing, high: demandSwing })

  // Fuel: one step of the walk on the unhedged fuel bill.
  if (airline.fuelHedge === null && forecast.breakdown.fuel > 0) {
    const fuelSwing = Math.floor((forecast.breakdown.fuel * FUEL_STEP_BP) / 10000)
    if (fuelSwing > 0) drivers.push({ label: 'Fuel price walk (unhedged)', low: -fuelSwing, high: fuelSwing })
  }

  // Events ending this quarter reverse before the market resolves.
  for (const active of state.world.events) {
    if (active.quartersLeft !== 1) continue
    const def = getEventDef(active.id)
    let delta = 0
    if (def.economyModBp !== undefined) delta += Math.floor(revenue * (10000 / def.economyModBp - 1))
    if (def.fuelModBp !== undefined) delta -= Math.floor(forecast.breakdown.fuel * (10000 / def.fuelModBp - 1))
    if (def.demandModBp !== undefined) {
      const touched = forecast.routes.filter((r) => (active.city !== null && (r.from === active.city || r.to === active.city)) || (active.region !== null && (getCity(r.from).region === active.region || getCity(r.to).region === active.region)))
      delta += Math.floor(revenueOf(touched) * (10000 / def.demandModBp - 1))
    }
    if (delta !== 0) {
      const where = active.city ? ` at ${active.city}` : active.region ? ` in ${active.region.toUpperCase()}` : ''
      drivers.push({ label: `${def.name}${where} ends before this quarter flies`, low: Math.min(0, delta), high: Math.max(0, delta) })
    }
  }

  // Contested pairs: a rival can reprice or reschedule inside the same quarter.
  const rivalPairs = new Map<string, string[]>()
  for (const other of state.airlines) {
    if (other.id === seat || other.bankrupt) continue
    for (const r of other.routes) {
      const key = pairKey(r.from, r.to)
      rivalPairs.set(key, [...(rivalPairs.get(key) ?? []), other.name])
    }
  }
  const contested = forecast.routes.filter((r) => rivalPairs.has(pairKey(r.from, r.to)))
  const contestSwing = Math.floor((revenueOf(contested) * CONTEST_SWING_BP) / 10000)
  if (contestSwing > 0) drivers.push({ label: `${contested.length} contested pair${contested.length === 1 ? '' : 's'}: rival fares and schedules`, low: -contestSwing, high: contestSwing })

  // Announced campaigns aimed at our markets: raids name a pair, price wars a city.
  for (const other of state.airlines) {
    const c = other.campaign
    if (!c || other.id === seat || other.bankrupt) continue
    if (state.turn < c.fromTurn || state.turn >= c.untilTurn) continue
    const hit = forecast.routes.filter((r) => (c.kind === 'raid' && c.pair === pairKey(r.from, r.to)) || (c.kind === 'price' && (r.from === c.city || r.to === c.city) && rivalPairs.get(pairKey(r.from, r.to))?.includes(other.name)))
    const swing = Math.floor((revenueOf(hit) * CAMPAIGN_SWING_BP) / 10000)
    if (swing > 0) drivers.push({ label: `${other.name}'s ${c.kind} campaign${c.kind === 'raid' && c.pair ? ` on ${c.pair.replace('-', '–')}` : ` at ${c.city}`}`, low: -swing, high: 0 })
  }

  let low = forecast.profit
  let high = forecast.profit
  for (const d of drivers) {
    low += d.low
    high += d.high
  }
  return { low, high, drivers }
}
