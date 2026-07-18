// Slot negotiation resolution (PLAN.md §2.3). Spend was already deducted at
// command time; each pending attempt resolves with one seeded roll whose odds
// scale with spend relative to the city's difficulty.

import {
  NEG_BASE_CHANCE_BP,
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

// Mutates state (callers clone at the entry point). Airlines resolve in
// ascending index, attempts in command order — both deterministic.
export function resolveNegotiations(state: GameState, events: GameEvent[]): void {
  let rng = state.rng.negotiations
  for (const airline of state.airlines) {
    for (const attempt of airline.negotiations) {
      const roll = chanceBp(rng, scarcityChanceBp(state, attempt.city, attempt.spend))
      rng = roll.rng
      const city = getCity(attempt.city)
      const remaining = city.slotPool - slotsAllocated(state, city.id)
      if (roll.value && remaining > 0) {
        const granted = Math.min(SLOTS_PER_GRANT, remaining)
        airline.slots[city.id] = (airline.slots[city.id] ?? 0) + granted
        events.push({ type: 'slots_granted', airline: airline.id, city: city.id, slots: granted })
      } else {
        events.push({ type: 'negotiation_failed', airline: airline.id, city: city.id })
      }
    }
    airline.negotiations = []
  }
  state.rng.negotiations = rng
}
