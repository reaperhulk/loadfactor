// The shared what-if estimator. Every preview that claims a passenger number
// replays the engine's own resolution order — share split → fare elasticity →
// spool-up attach → capacity cap (market.ts) — holding every rival on the
// pair fixed. One code path means the dossier, the launch dialog, and the
// resolution can't quietly disagree. Direct traffic only: connecting pax and
// the spill pass ride on top, so estimates read slightly conservative.

import { pairKey } from '../data/cities'
import { DEMAND_NOISE_SPREAD_BP, FARE_DEMAND_BP } from '../data/constants'
import type { GameState, Route } from '../engine'
import { pairWeeklyDemand, routeShareWeight, routeSpoolBp } from '../engine/market'
import { routeWeeklyCapacity } from '../engine/queries'

export interface PaxEstimate {
  pax: number // weekly, capacity-capped — the midpoint, not a promise
  low: number // the same estimate at the unlucky end of demand noise
  high: number // and at the lucky end
  spoolBp: number // attach share this quarter (10000 = fully established)
  sharePct: number // my slice of the pair's attractiveness, 0..100
}

// Estimate weekly direct pax for a variant of one of the player's routes
// (same id — the fleet assignment must resolve — with fare/service tweaked).
export function estimateWeeklyPax(state: GameState, variant: Route): PaxEstimate {
  const player = state.airlines[0]!
  const demand = pairWeeklyDemand(state, variant.from, variant.to)
  const key = pairKey(variant.from, variant.to)
  let othersWeight = 0
  for (const airline of state.airlines) {
    if (airline.id === 0 || airline.bankrupt) continue
    const theirs = airline.routes.find((r) => pairKey(r.from, r.to) === key)
    if (theirs) othersWeight += routeShareWeight(airline, theirs)
  }
  const weight = routeShareWeight(player, variant)
  const total = weight + othersWeight
  let pax = total > 0 ? Math.floor((demand * weight) / total) : 0
  pax = Math.floor((pax * FARE_DEMAND_BP[variant.fareLevel + 2]!) / 10000)
  const spoolBp = routeSpoolBp(player, variant, state.turn)
  pax = Math.floor((pax * spoolBp) / 10000)
  // Demand carries per-pair noise the estimate cannot know in advance, so
  // report the BAND rather than a number that will always be slightly wrong.
  // This is also what stops a what-if table from naming a single winner when
  // two postures are within noise of each other.
  const cap = routeWeeklyCapacity(player, variant)
  const band = (bp: number): number =>
    Math.min(cap, Math.floor((pax * (10000 + bp)) / 10000))
  return {
    pax: Math.min(pax, cap),
    low: band(-DEMAND_NOISE_SPREAD_BP),
    high: band(DEMAND_NOISE_SPREAD_BP),
    spoolBp,
    sharePct: total > 0 ? Math.floor((weight * 100) / total) : 0,
  }
}

// Two estimates are too close to call when their noise bands overlap: the
// difference is smaller than the thing the estimate cannot see.
export function tooCloseToCall(a: PaxEstimate, b: PaxEstimate): boolean {
  return a.low <= b.high && b.low <= a.high
}
