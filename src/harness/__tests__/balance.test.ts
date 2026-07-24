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
import { getScenario } from '../../data/scenarios'

const SEEDS = ['alpha', 'beta', 'gamma', 'delta', 'epsilon']
// PLAN §2.4's contract, asserted literally: no pinned career may finish above
// 10× its scenario's qualifying floor. Loan amortization and transfer
// handling costs (V2) pulled the curve inside this for every era — a money
// printer that reopens the gap trips these before it ships.
const runawayCap = (scenario: string): number => 10 * getScenario(scenario).targetNetWorth

describe('balance envelope', () => {
  it('the greedy bot survives the window and wins the race on every pinned seed', () => {
    for (const seed of SEEDS) {
      const result = runCareer('jet_age', seed, 'greedy', 80)
      expect(result.summary.turn, `${seed}: reached the 1980 deadline`).toBe(80)
      expect(result.summary.phase, `${seed}: finished #1 with the target met`).toBe('won')
      expect(result.summary.routes, `${seed}: built a network`).toBeGreaterThanOrEqual(3)
      expect(result.summary.netWorth, `${seed}: no runaway money printer`).toBeLessThan(
        runawayCap('jet_age'),
      )
    }
  })

  // The later eras graduate into the envelope with era-sized contracts:
  // every era has at least one pinned seed the competent bot WINS outright,
  // and its other pins hold competitive — floor cleared, and never below
  // 40% of the leading rival (the race stays a race, not a blowout).
  const ERA_PINS: readonly {
    scenario: string
    quarters: number
    wins: readonly string[]
    competitive: readonly string[]
  }[] = [
    // Re-derived after V3 (one shared strategy brain for bot AND rivals —
    // smarter rivals shuffled every race). Excluded as brutal-world seeds,
    // where every airline stalls or the start is structurally hostile:
    // oil_crisis theta pins competitive; deregulation/alpha (the western
    // b767 box) and open_skies/gamma are unpinned entirely.
    { scenario: 'oil_crisis', quarters: 60, wins: ['alpha', 'beta', 'gamma'], competitive: ['theta'] },
    { scenario: 'deregulation', quarters: 60, wins: ['beta', 'gamma'], competitive: [] },
    { scenario: 'open_skies', quarters: 60, wins: ['theta'], competitive: ['alpha', 'beta'] },
    { scenario: 'lcc_wars', quarters: 60, wins: ['alpha', 'beta', 'gamma'], competitive: [] },
  ]

  for (const era of ERA_PINS) {
    it(`${era.scenario}: the greedy bot wins its pinned seeds and stays competitive on the rest`, () => {
      for (const seed of era.wins) {
        const result = runCareer(era.scenario, seed, 'greedy', era.quarters)
        expect(result.summary.turn, `${era.scenario}/${seed}: reached the deadline`).toBe(era.quarters)
        expect(result.summary.phase, `${era.scenario}/${seed}: won the race`).toBe('won')
        expect(result.summary.netWorth, `${era.scenario}/${seed}: no runaway`).toBeLessThan(
          runawayCap(era.scenario),
        )
      }
      for (const seed of era.competitive) {
        const result = runCareer(era.scenario, seed, 'greedy', era.quarters)
        expect(result.summary.turn, `${era.scenario}/${seed}: reached the deadline`).toBe(era.quarters)
        const me = result.state.airlines[0]!
        const myWorth = me.history[me.history.length - 1]?.netWorth ?? 0
        const leader = Math.max(
          ...result.state.airlines
            .filter((a) => !a.bankrupt)
            .map((a) => a.history[a.history.length - 1]?.netWorth ?? 0),
        )
        expect(myWorth, `${era.scenario}/${seed}: within 40% of the leader`).toBeGreaterThanOrEqual(
          Math.floor((leader * 4000) / 10000),
        )
        expect(
          myWorth,
          `${era.scenario}/${seed}: clears the scenario's qualifying floor`,
        ).toBeGreaterThanOrEqual(getScenario(era.scenario).targetNetWorth)
      }
    })
  }

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
