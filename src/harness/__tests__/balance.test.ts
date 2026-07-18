// The balance envelope (PLAN.md §2.4, §5.6): the difficulty curve as an
// asserted contract. The scenario is a race — victory is scored at the
// deadline against the rival airlines. M0 pins the current curve: the
// competent bot wins on most seeds (3 of 5), survives the window on all of
// them, and the naive bot always loses. M1 tightens this (less seed variance,
// tighter bounds). Re-derive when the curve intentionally moves, and say so
// in the commit.

import { describe, expect, it } from 'vitest'
import { runCareer } from '../simulate'

const SEEDS = ['alpha', 'beta', 'gamma', 'delta', 'epsilon']
// Seeds where the M0 greedy bot out-races the rivals; alpha and delta are
// known-hard starts it survives but loses on points.
const WINNING_SEEDS = ['beta', 'gamma', 'epsilon']

describe('balance envelope', () => {
  it('the greedy bot survives the full window on every pinned seed', () => {
    for (const seed of SEEDS) {
      const result = runCareer('jet_age', seed, 'greedy', 80)
      expect(result.summary.turn, `${seed}: reached the 1980 deadline`).toBe(80)
      expect(result.summary.netWorth, `${seed}: net worth grew`).toBeGreaterThan(40000)
      expect(result.summary.routes, `${seed}: built a network`).toBeGreaterThanOrEqual(3)
    }
  })

  it('the greedy bot wins the race on most seeds', () => {
    for (const seed of WINNING_SEEDS) {
      const result = runCareer('jet_age', seed, 'greedy', 80)
      expect(result.summary.phase, `${seed}: finished #1 with the target met`).toBe('won')
    }
  })

  it('the naive bot never wins and always underperforms the greedy bot', () => {
    for (const seed of SEEDS) {
      const naive = runCareer('jet_age', seed, 'naive', 80)
      expect(naive.summary.phase, `${seed}: naive loses the scenario`).toBe('lost')
      const greedy = runCareer('jet_age', seed, 'greedy', 80)
      expect(naive.summary.netWorth, `${seed}: strategy matters`).toBeLessThan(greedy.summary.netWorth)
    }
  })

  it('the naive bot is not instantly dead (the floor is survivable)', () => {
    for (const seed of SEEDS) {
      const result = runCareer('jet_age', seed, 'naive', 80)
      expect(result.summary.turn, `${seed}: naive survives the opening`).toBeGreaterThanOrEqual(12)
    }
  })
})
