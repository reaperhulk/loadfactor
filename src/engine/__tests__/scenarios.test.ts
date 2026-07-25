// Scenario smoke: every scenario must be playable end to end by the bots and
// respect its era. The tight difficulty envelope lives in balance.test.ts and
// covers jet_age; new scenarios graduate there once tuned.

import { describe, expect, it } from 'vitest'
import { typesOnSale } from '../../data/aircraft'
import { SCENARIOS } from '../../data/scenarios'
import { runCareer } from '../../harness/simulate'
import { newGame } from '../index'
import { netWorth, objectiveScore } from '../queries'

describe('scenario smoke', () => {
  for (const scenario of SCENARIOS) {
    it(`${scenario.id}: starter fleets are on sale and rivals have personalities`, () => {
      const onSale = typesOnSale(scenario.startYear).map((t) => t.id)
      for (const setup of [scenario.player, ...scenario.rivals]) {
        for (const type of setup.starterFleet) {
          expect(onSale, `${setup.name} starter ${type} on sale in ${scenario.startYear}`).toContain(type)
        }
      }
      const state = newGame(scenario.id, 'smoke')
      expect(state.airlines[0]!.personality).toBe('player')
      for (const rival of state.airlines.slice(1)) {
        expect(rival.personality).not.toBe('player')
      }
    })

    it(`${scenario.id}: the greedy bot plays the full window without bankruptcy`, () => {
      const result = runCareer(scenario.id, 'smoke-alpha', 'greedy', scenario.quarters)
      // Reaching the deadline means solvency held; the race verdict may be
      // either way on untuned scenarios.
      expect(result.summary.turn, `${scenario.id}: survived to the deadline`).toBe(scenario.quarters)
      expect(result.summary.routes).toBeGreaterThanOrEqual(2)
    })
  }
})

describe('era objectives (F3)', () => {
  it('every scenario names a distinct, scoreable objective', () => {
    const kinds = SCENARIOS.map((s) => s.objective.kind)
    expect(new Set(kinds).size, 'five eras, five different questions').toBe(SCENARIOS.length)
    for (const s of SCENARIOS) {
      expect(s.objective.target, `${s.id}: has a bar`).toBeGreaterThan(0)
      expect(s.objective.blurb.length, `${s.id}: tells the player how to win`).toBeGreaterThan(20)
      // Scoring a fresh airline must never throw and must start neutral.
      const fresh = newGame(s.id, 'objective-seed').airlines[0]!
      expect(objectiveScore(fresh, s.objective.kind)).toBeGreaterThanOrEqual(0)
    }
  })

  it('objectiveScore reads the metric each era actually cares about', () => {
    const state = newGame('jet_age', 'score-seed')
    const a = state.airlines[0]!
    const zero = {
      fuel: 0, fees: 0, flightPay: 0, service: 0, salaries: 0, ownership: 0,
      maintenance: 0, admin: 0, slots: 0, overhead: 0, marketing: 0, interest: 0,
    }
    a.history.push(
      { turn: 0, cash: 0, revenue: 300, costs: 100, profit: 200, pax: 1000, transferPax: 400, capacity: 2000, netWorth: 50, breakdown: zero },
      { turn: 1, cash: 0, revenue: 300, costs: 100, profit: 150, pax: 500, transferPax: 100, capacity: 2000, netWorth: 90, breakdown: zero },
    )
    expect(objectiveScore(a, 'profit'), 'profit accumulates across the era').toBe(350)
    expect(objectiveScore(a, 'pax')).toBe(1500)
    expect(objectiveScore(a, 'transfer')).toBe(500)
    // 1500 pax over 4000 seats = 37.5% lifetime load factor.
    expect(objectiveScore(a, 'loadFactor')).toBe(3750)
    // Net worth is a balance-sheet reading, not a sum over history.
    expect(objectiveScore(a, 'netWorth')).toBe(netWorth(a))
  })

  it('an airline that never flew a seat scores zero load factor rather than dividing by nothing', () => {
    const a = newGame('lcc_wars', 'empty-seed').airlines[0]!
    expect(objectiveScore(a, 'loadFactor')).toBe(0)
  })
})
