// The balance envelope (PLAN.md §2.4, §5.6): the difficulty curve as an
// asserted contract. The scenario is a race — victory is scored at the
// deadline against the rival airlines. M1 state: cost inflation trails demand
// growth so saturated routes decay, and the competent bot (prune losers,
// renew geriatric fleet, borrow to expand) wins on every pinned seed. The
// runaway cap is a tripwire for money-printer regressions; late-game
// magnitudes still deserve compression in M2. Re-derive when the curve
// intentionally moves, and say so in the commit.

import { describe, expect, it } from 'vitest'
import { runCareer } from '../simulate'

const SEEDS = ['alpha', 'beta', 'gamma', 'delta', 'epsilon']
const RUNAWAY_CAP = 12_000_000 // $12B — tightened after the M2 growth taper

// Five 80-quarter careers per test run ~3s locally but CI runners are slower;
// the default 5s timeout is flaky there.
const TIMEOUT = 60_000

describe('balance envelope', () => {
  it('the greedy bot survives the window and wins the race on every pinned seed', { timeout: TIMEOUT }, () => {
    for (const seed of SEEDS) {
      const result = runCareer('jet_age', seed, 'greedy', 80)
      expect(result.summary.turn, `${seed}: reached the 1980 deadline`).toBe(80)
      expect(result.summary.phase, `${seed}: finished #1 with the target met`).toBe('won')
      expect(result.summary.routes, `${seed}: built a network`).toBeGreaterThanOrEqual(3)
      expect(result.summary.netWorth, `${seed}: no runaway money printer`).toBeLessThan(RUNAWAY_CAP)
    }
  })

  it('the naive bot never wins and always underperforms the greedy bot', { timeout: TIMEOUT }, () => {
    for (const seed of SEEDS) {
      const naive = runCareer('jet_age', seed, 'naive', 80)
      expect(naive.summary.phase, `${seed}: naive loses the scenario`).toBe('lost')
      const greedy = runCareer('jet_age', seed, 'greedy', 80)
      expect(naive.summary.netWorth, `${seed}: strategy matters`).toBeLessThan(greedy.summary.netWorth)
    }
  })

  it('the naive bot is not instantly dead (the floor is survivable)', { timeout: TIMEOUT }, () => {
    for (const seed of SEEDS) {
      const result = runCareer('jet_age', seed, 'naive', 80)
      expect(result.summary.turn, `${seed}: naive survives the opening`).toBeGreaterThanOrEqual(12)
    }
  })
})
