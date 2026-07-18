// The balance envelope (PLAN.md §2.4, §5.6): the difficulty curve as an
// asserted contract. M0 keeps the envelope loose — survival and ordering, not
// tight numbers; M1 tightens it. Re-derive these bounds when the curve
// intentionally moves, and say so in the commit.

import { describe, expect, it } from 'vitest'
import { runCareer } from '../simulate'

const SEEDS = ['alpha', 'beta', 'gamma']

describe('balance envelope', () => {
  it('the greedy bot survives and grows on every pinned seed', () => {
    for (const seed of SEEDS) {
      const result = runCareer('jet_age', seed, 'greedy', 60)
      expect(result.summary.phase, `${seed}: never went bankrupt`).not.toBe('lost')
      // Grew the airline meaningfully beyond the starting ~$30M net worth.
      expect(result.summary.netWorth, `${seed}: net worth grew`).toBeGreaterThan(40000)
      expect(result.summary.routes, `${seed}: built a network`).toBeGreaterThanOrEqual(3)
      // Curve guard: the scenario must not be trivially winnable.
      if (result.summary.phase === 'won') {
        expect(result.summary.turn, `${seed}: no instant victories`).toBeGreaterThanOrEqual(20)
      }
    }
  })

  it('the naive bot underperforms the greedy bot on every seed', () => {
    for (const seed of SEEDS) {
      const naive = runCareer('jet_age', seed, 'naive', 60)
      const greedy = runCareer('jet_age', seed, 'greedy', 60)
      expect(naive.summary.netWorth, `${seed}: strategy matters`).toBeLessThan(greedy.summary.netWorth)
    }
  })

  it('the naive bot is not instantly dead (the floor is survivable)', () => {
    for (const seed of SEEDS) {
      const result = runCareer('jet_age', seed, 'naive', 60)
      expect(result.summary.turn, `${seed}: naive survives the opening`).toBeGreaterThanOrEqual(12)
    }
  })
})
