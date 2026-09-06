import { describe, expect, it } from 'vitest'
import { ALL_SCENARIOS } from '../../data/scenarios'
import { objectiveScore } from '../../engine/queries'
import { runCareer } from '../simulate'

// Distribution gates, separate from exact legacy pins. An occasional loss is
// healthy; a whole scenario with no viable operating policy is not.
describe('current rules balance across independent seeds and operating styles', () => {
  for (const scenario of ALL_SCENARIOS) it(`${scenario.id}: playable, winnable and bounded`, () => {
    const careers = ['greedy', 'cautious'].flatMap((bot) =>
      Array.from({ length: 3 }, (_, i) => runCareer(scenario.id, `balance-v2-${i}`, bot as 'greedy' | 'cautious', scenario.quarters)))
    expect(careers.filter((c) => c.summary.turn === scenario.quarters).length, 'most competent operators survive').toBeGreaterThanOrEqual(4)
    expect(careers.some((c) => c.summary.phase === 'won'), 'at least one competent operating style can win').toBe(true)
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
