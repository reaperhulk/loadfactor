// The keystone suite (PLAN.md §5.2): the sim is a pure function of
// (scenario, seed, commands), and state survives JSON round-trips losslessly.

import { describe, expect, it } from 'vitest'
import { botCommands } from '../../harness/bots'
import { hashState } from '../../harness/hash'
import { runCareer } from '../../harness/simulate'
import { applyCommand, newGame, runReplay, type GameState } from '../index'

function advance(state: GameState, quarters: number): GameState {
  for (let q = 0; q < quarters && state.phase === 'planning'; q++) {
    for (const command of botCommands(state, 'greedy')) {
      state = applyCommand(state, command).state
    }
    state = applyCommand(state, { type: 'end_quarter' }).state
  }
  return state
}

describe('determinism', () => {
  it('identical careers hash identically', () => {
    const a = runCareer('jet_age', 'det-alpha', 'greedy', 30)
    const b = runCareer('jet_age', 'det-alpha', 'greedy', 30)
    expect(hashState(a.state)).toBe(hashState(b.state))
    expect(a.checkpointHashes).toEqual(b.checkpointHashes)
  })

  it('different seeds diverge', () => {
    const a = runCareer('jet_age', 'det-alpha', 'greedy', 20)
    const b = runCareer('jet_age', 'det-beta', 'greedy', 20)
    expect(hashState(a.state)).not.toBe(hashState(b.state))
  })

  it('a replay of the command log reproduces the exact final state', () => {
    const career = runCareer('jet_age', 'det-replay', 'greedy', 25)
    const replayed = runReplay({ scenario: 'jet_age', seed: 'det-replay', commands: career.commandLog })
    expect(hashState(replayed.state)).toBe(hashState(career.state))
  })

  it('JSON round-trip mid-career is lossless and continues identically', () => {
    const start = advance(newGame('jet_age', 'det-roundtrip'), 15)
    const restored = JSON.parse(JSON.stringify(start)) as GameState
    expect(hashState(restored)).toBe(hashState(start))
    const continuedOriginal = advance(start, 10)
    const continuedRestored = advance(restored, 10)
    expect(hashState(continuedRestored)).toBe(hashState(continuedOriginal))
  })

  it('state contains no undefined holes, functions, or non-JSON values', () => {
    const state = advance(newGame('jet_age', 'det-json'), 10)
    const walk = (value: unknown, path: string): void => {
      expect(value, path).not.toBeUndefined()
      if (typeof value === 'number') {
        expect(Number.isFinite(value), `${path} is finite`).toBe(true)
      } else if (Array.isArray(value)) {
        value.forEach((v, i) => walk(v, `${path}[${i}]`))
      } else if (value !== null && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) walk(v, `${path}.${k}`)
      } else {
        expect(['string', 'boolean', 'number', 'object']).toContain(typeof value)
      }
    }
    walk(state, 'state')
  })
})
