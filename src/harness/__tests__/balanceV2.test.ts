import { describe, expect, it } from 'vitest'
import { ALL_SCENARIOS } from '../../data/scenarios'
import { objectiveScore } from '../../engine/queries'
import type { BotName } from '../bots'
import { runCareer } from '../simulate'

// Distribution gates, separate from exact legacy pins. An occasional loss is
// healthy; a whole scenario with no viable operating policy is not.
describe('current rules balance across independent seeds and operating styles', () => {
  for (const scenario of ALL_SCENARIOS) it(`${scenario.id}: playable, winnable and bounded`, () => {
    const careers = ['greedy', 'cautious'].flatMap((bot) =>
      Array.from({ length: 3 }, (_, i) => runCareer(scenario.id, `balance-v2-${i}`, bot as 'greedy' | 'cautious', scenario.quarters)))
    expect(careers.filter((c) => c.summary.turn === scenario.quarters).length, 'most competent operators survive').toBeGreaterThanOrEqual(4)
    // Some competent operating style wins: the reference pair first, then the
    // other doctrines on the same seeds only if neither of them did.
    const won = careers.some((c) => c.summary.phase === 'won') ||
      (['budget', 'premium', 'connector'] as BotName[]).some((bot) =>
        Array.from({ length: 3 }, (_, i) => `balance-v2-${i}`).some((seed) => runCareer(scenario.id, seed, bot, scenario.quarters).summary.phase === 'won'))
    expect(won, 'at least one competent operating style can win').toBe(true)
    for (const career of careers) {
      expect(career.summary.netWorth).toBeLessThan(scenario.targetNetWorth * 10)
      expect(career.state.airlines.some((a) => a.controller === 'rival' && !a.bankrupt), JSON.stringify(career.summary)).toBe(true)
    }
    if (scenario.objective.kind === 'loadFactor') {
      const naive = runCareer(scenario.id, 'balance-v2-0', 'naive', scenario.quarters)
      expect(naive.summary.phase, 'a token full schedule never wins the efficiency mandate').toBe('lost')
      expect(Math.max(...careers.map((c) => objectiveScore(c.state.airlines[0]!, 'pax')))).toBeGreaterThan(1500000)
    }
  })
})

// The race contract (PLAN.md §2.4, re-derived for rules 6): on the two long
// net-worth races the reference bot wins most seeds, and every mainstream
// doctrine is a way to win rather than a way to lose. Measured on these
// seeds when rules 6 shipped: wins out of 8 were greedy 6, budget 6,
// connector 5, premium 3 (rules 5 on the review probe: budget well ahead,
// the reference bot winning 1 Jet Age seed in 8). The bars leave room for
// the curve to move a little without letting one doctrine sweep the field.
describe('the race rewards more than one way to run an airline (rules 6)', () => {
  const DOCTRINES: BotName[] = ['greedy', 'budget', 'premium', 'connector']
  const wins = new Map<BotName, number>()
  for (const bot of DOCTRINES) {
    let count = 0
    for (const scenario of ['jet_age', 'oil_crisis']) for (let i = 0; i < 4; i++) {
      const quarters = ALL_SCENARIOS.find((s) => s.id === scenario)!.quarters
      if (runCareer(scenario, `balance-v6-${i}`, bot, quarters).summary.phase === 'won') count++
    }
    wins.set(bot, count)
  }

  it('the reference bot wins most seeds', () => {
    expect(wins.get('greedy')!).toBeGreaterThanOrEqual(5)
  })

  it('every mainstream doctrine wins some seeds, and none runs away from the rest', () => {
    for (const bot of DOCTRINES) expect(wins.get(bot)!, `${bot} wins`).toBeGreaterThanOrEqual(2)
    const counts = [...wins.values()]
    expect(Math.max(...counts) - Math.min(...counts), JSON.stringify(Object.fromEntries(wins))).toBeLessThanOrEqual(4)
  })
})
