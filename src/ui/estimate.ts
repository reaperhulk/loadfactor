// The shared what-if estimator. Every preview that claims a passenger number
// replays the engine's own resolution order — share split → fare elasticity →
// spool-up attach → capacity cap (market.ts) — holding every rival on the
// pair fixed. One code path means the dossier, the launch dialog, and the
// resolution can't quietly disagree. Direct traffic only: connecting pax and
// the spill pass ride on top, so estimates read slightly conservative.

import { pairKey } from '../data/cities'
import { FARE_DEMAND_BP } from '../data/constants'
import type { GameState, Route } from '../engine'
import { pairWeeklyDemand, routeShareWeight, routeSpoolBp } from '../engine/market'
import { routeWeeklyCapacity } from '../engine/queries'

export interface PaxEstimate {
  pax: number // weekly, capacity-capped
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
  return {
    pax: Math.min(pax, routeWeeklyCapacity(player, variant)),
    spoolBp,
    sharePct: total > 0 ? Math.floor((weight * 100) / total) : 0,
  }
}
