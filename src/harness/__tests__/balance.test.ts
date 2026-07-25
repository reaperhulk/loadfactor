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
import { objectiveScore } from '../../engine/queries'

const SEEDS = ['alpha', 'beta', 'gamma', 'delta', 'epsilon']
// PLAN §2.4's contract, asserted literally: no pinned career may finish above
// 10× its scenario's qualifying floor. Loan amortization and transfer
// handling costs (V2) pulled the curve inside this for every era — a money
// printer that reopens the gap trips these before it ships.
const runawayCap = (scenario: string): number => 10 * getScenario(scenario).targetNetWorth

describe('balance envelope', () => {
  // Survival is the floor contract: a competent operator always reaches the
  // deadline with a real network and without printing money. WINNING is
  // pinned per seed below — since F1 the field fights back, so a close loss
  // on a hostile seed is a feature, not a regression.
  it('the greedy bot survives the full window on every jet_age seed', () => {
    for (const seed of SEEDS) {
      const result = runCareer('jet_age', seed, 'greedy', 80)
      expect(result.summary.turn, `${seed}: reached the 1980 deadline`).toBe(80)
      expect(result.summary.routes, `${seed}: built a network`).toBeGreaterThanOrEqual(3)
      expect(result.summary.netWorth, `${seed}: no runaway money printer`).toBeLessThan(
        runawayCap('jet_age'),
      )
    }
  })

  // Drama contract (F1): the race must still be live deep into the era. A
  // rival field that dies by the midpoint is the failure mode this whole
  // package exists to prevent — probes showed every rival bankrupt by
  // quarter 30 of 80 before it.
  it('the rival field survives to the deadline', () => {
    for (const [scenario, quarters] of [
      ['jet_age', 80],
      ['lcc_wars', 60],
    ] as const) {
      for (const seed of ['alpha', 'beta', 'gamma']) {
        const result = runCareer(scenario, seed, 'greedy', quarters)
        const liveRivals = result.state.airlines.filter((a) => a.id !== 0 && !a.bankrupt).length
        expect(liveRivals, `${scenario}/${seed}: someone is still racing at the deadline`).toBeGreaterThanOrEqual(1)
        // Seats are recycled, never accumulated — the field stays the size
        // the scenario intended.
        expect(result.state.airlines.length, `${scenario}/${seed}: field size bounded`).toBeLessThanOrEqual(
          getScenario(scenario).rivals.length + 1,
        )
      }
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
    // Re-derived for S (airport capacity): pools are tight, slots are rented
    // rather than auctioned, and airports build on a published schedule. The
    // curve moved everywhere — capacity now paces how fast a network can grow,
    // and the top hubs run 60-100% full deep into an era. The home base is
    // rent-free, so the pressure lands on sprawl rather than on existing.
    { scenario: 'jet_age', quarters: 80, wins: ['alpha', 'beta', 'delta'], competitive: ['theta'] },
    { scenario: 'oil_crisis', quarters: 60, wins: ['beta', 'gamma', 'delta'], competitive: ['alpha', 'omega'] },
    { scenario: 'deregulation', quarters: 60, wins: ['alpha', 'beta', 'delta'], competitive: ['kappa'] },
    // open_skies scores connecting volume, which needs capacity at exactly the
    // hubs everyone else wants — the era where scarcity bites hardest.
    { scenario: 'open_skies', quarters: 60, wins: ['theta', 'lambda'], competitive: ['iota', 'kappa', 'omega'] },
    { scenario: 'lcc_wars', quarters: 60, wins: ['alpha', 'gamma', 'theta'], competitive: ['beta', 'delta'] },
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
        // Judged on the ERA's metric: a seed the bot loses must still be a
        // race it was in — within 60% of the leader on whatever this era
        // actually scores.
        const kind = getScenario(era.scenario).objective.kind
        const mine = objectiveScore(result.state.airlines[0]!, kind)
        const leader = Math.max(
          ...result.state.airlines.filter((a) => !a.bankrupt).map((a) => objectiveScore(a, kind)),
        )
        expect(
          mine,
          `${era.scenario}/${seed}: within 60% of the leader on ${getScenario(era.scenario).objective.label}`,
        ).toBeGreaterThanOrEqual(Math.floor((leader * 6000) / 10000))
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
