// Slot negotiation resolution (PLAN.md §2.3). Spend was already deducted at
// command time; each pending attempt resolves with one seeded roll whose odds
// scale with spend relative to the city's difficulty.

import {
  NEG_BASE_CHANCE_BP,
  NEG_OUTBID_MALUS_BP,
  NEG_DIFFICULTY_PER_POINT,
  NEG_MAX_CHANCE_BP,
  NEG_SPEND_CHANCE_BP,
  SLOTS_PER_GRANT,
} from '../data/constants'
import { getCity } from '../data/cities'
import { slotsAllocated } from './queries'
import { chanceBp } from './rng'
import type { GameEvent, GameState } from './types'

export function negotiationDifficulty(cityId: string): number {
  const c = getCity(cityId)
  return NEG_DIFFICULTY_PER_POINT * (c.pop + c.biz)
}

export function negotiationChanceBp(cityId: string, spend: number): number {
  const difficulty = negotiationDifficulty(cityId)
  return Math.min(NEG_MAX_CHANCE_BP, NEG_BASE_CHANCE_BP + Math.floor((spend * NEG_SPEND_CHANCE_BP) / difficulty))
}

// Scarcity pressure: as the pool fills, odds fall — the last slots at a
// packed airport are twice as hard as the first.
export function scarcityChanceBp(state: GameState, cityId: string, spend: number): number {
  const city = getCity(cityId)
  const remaining = Math.max(0, city.slotPool - slotsAllocated(state, cityId))
  const scarcity = 5000 + Math.floor((5000 * remaining) / city.slotPool)
  return Math.floor((negotiationChanceBp(cityId, spend) * scarcity) / 10000)
}

// Mutates state (callers clone at the entry point). Attempts group by city:
// when two or more airlines court the same authority in the same quarter it
// becomes a BIDDING WAR — the biggest spender rolls first while slots
// remain, and every outbid attempt keeps only part of its odds (the
// authority is entertaining a richer suitor). Cities resolve in sorted
// order, bidders by descending spend then ascending airline id — all
// deterministic.
export function resolveNegotiations(state: GameState, events: GameEvent[]): void {
  let rng = state.rng.negotiations
  const byCity = new Map<string, { airline: (typeof state.airlines)[number]; spend: number }[]>()
  for (const airline of state.airlines) {
    for (const attempt of airline.negotiations) {
      const list = byCity.get(attempt.city) ?? []
      list.push({ airline, spend: attempt.spend })
      byCity.set(attempt.city, list)
    }
    airline.negotiations = []
  }
  for (const cityId of [...byCity.keys()].sort()) {
    const bidders = byCity.get(cityId)!
    bidders.sort((a, b) => b.spend - a.spend || a.airline.id - b.airline.id)
    const contested = bidders.length > 1
    if (contested) {
      events.push({ type: 'bidding_war', city: cityId, airlines: bidders.map((b) => b.airline.id) })
    }
    for (let rank = 0; rank < bidders.length; rank++) {
      const b = bidders[rank]!
      let bp = scarcityChanceBp(state, cityId, b.spend)
      if (contested && rank > 0) bp = Math.floor((bp * NEG_OUTBID_MALUS_BP) / 10000)
      const roll = chanceBp(rng, bp)
      rng = roll.rng
      const city = getCity(cityId)
      const remaining = city.slotPool - slotsAllocated(state, city.id)
      if (roll.value && remaining > 0) {
        const granted = Math.min(SLOTS_PER_GRANT, remaining)
        b.airline.slots[city.id] = (b.airline.slots[city.id] ?? 0) + granted
        events.push({ type: 'slots_granted', airline: b.airline.id, city: city.id, slots: granted })
      } else {
        events.push({ type: 'negotiation_failed', airline: b.airline.id, city: city.id })
      }
    }
  }
  state.rng.negotiations = rng
}
