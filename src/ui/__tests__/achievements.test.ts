// The new career milestones judge pure predicates over (state, events) — no
// storage involved, so the defs are testable directly.

import { describe, expect, it } from 'vitest'
import { newGame } from '../../engine'
import type { GameEvent, GameState } from '../../engine'
import { ACHIEVEMENTS } from '../achievements'

function def(id: string) {
  const found = ACHIEVEMENTS.find((a) => a.id === id)
  if (!found) throw new Error(`no achievement ${id}`)
  return found
}

const zeroBreakdown = {
  fuel: 0,
  fees: 0,
  flightPay: 0,
  service: 0,
  salaries: 0,
  ownership: 0,
  maintenance: 0,
  admin: 0,
  overhead: 0,
  marketing: 0,
  interest: 0,
}

function withQuarter(state: GameState, profit: number): GameState {
  state.airlines[0]!.history.push({
    turn: state.turn,
    cash: 0,
    revenue: Math.max(0, profit),
    costs: Math.max(0, -profit),
    profit,
    pax: 0,
    netWorth: 0,
    breakdown: zeroBreakdown,
  })
  return state
}

describe('achievement predicates', () => {
  it('spoils of war: a bidding war you were in, ended with the slots granted', () => {
    const state = newGame('jet_age', 'ach-test')
    const war: GameEvent = { type: 'bidding_war', city: 'LHR', airlines: [0, 1] }
    const grant: GameEvent = { type: 'slots_granted', airline: 0, city: 'LHR', slots: 2 }
    expect(def('war_winner').test(state, [war, grant])).toBe(true)
    // Losing the war (no grant), or a grant with no war, earns nothing.
    expect(def('war_winner').test(state, [war])).toBe(false)
    expect(def('war_winner').test(state, [grant])).toBe(false)
    // A rival's war at some other city does not count either.
    const otherWar: GameEvent = { type: 'bidding_war', city: 'CDG', airlines: [1, 2] }
    expect(def('war_winner').test(state, [otherWar, grant])).toBe(false)
  })

  it('shockproof: a profitable quarter flown while the oil shock burns', () => {
    const report: GameEvent = {
      type: 'quarter_report',
      airline: 0,
      turn: 1,
      revenue: 100,
      costs: 50,
      profit: 50,
      debtPayment: 0,
      cash: 0,
      netWorth: 0,
      pax: 0,
      breakdown: zeroBreakdown,
    }
    const shocked = withQuarter(newGame('jet_age', 'ach-test'), 50)
    shocked.world.events.push({ id: 'oil_shock', quartersLeft: 2, city: null, region: null })
    expect(def('oil_proof').test(shocked, [report])).toBe(true)
    // In the red during the shock: no medal.
    const bleeding = withQuarter(newGame('jet_age', 'ach-test'), -50)
    bleeding.world.events.push({ id: 'oil_shock', quartersLeft: 2, city: null, region: null })
    expect(def('oil_proof').test(bleeding, [report])).toBe(false)
    // Profitable but calm skies: no medal.
    const calm = withQuarter(newGame('jet_age', 'ach-test'), 50)
    expect(def('oil_proof').test(calm, [report])).toBe(false)
    // Not a resolution batch (no quarter_report): never judged.
    expect(def('oil_proof').test(shocked, [])).toBe(false)
  })
})
