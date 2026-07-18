// Scenario smoke: every scenario must be playable end to end by the bots and
// respect its era. The tight difficulty envelope lives in balance.test.ts and
// covers jet_age; new scenarios graduate there once tuned.

import { describe, expect, it } from 'vitest'
import { typesOnSale } from '../../data/aircraft'
import { SCENARIOS } from '../../data/scenarios'
import { runCareer } from '../../harness/simulate'
import { newGame } from '../index'

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
