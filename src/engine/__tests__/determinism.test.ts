// The keystone suite (PLAN.md §5.2): the sim is a pure function of
// (scenario, seed, commands), and state survives JSON round-trips losslessly.

import { describe, expect, it } from 'vitest'
import { botCommands } from '../../harness/bots'
import { hashState } from '../../harness/hash'
import { runCareer } from '../../harness/simulate'
import {
  applyCommand,
  applyCommandBatch,
  applyCommandBatchFor,
  applyCommandFor,
  newGame,
  runReplay,
  type GameState,
  type SeatCommand,
} from '../index'

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

  it('batched solo commands preserve sequential state and events', () => {
    const start = newGame('jet_age', 'det-batch')
    const commands = [
      ...botCommands(start, 'greedy'),
      { type: 'end_quarter' } as const,
      { type: 'set_marketing', level: 2 } as const,
      { type: 'set_marketing', level: 99 } as const,
    ]
    let sequentialState = start
    const sequentialEvents = []
    for (const command of commands) {
      const result = applyCommand(sequentialState, command)
      sequentialState = result.state
      sequentialEvents.push(...result.events)
    }

    const batched = applyCommandBatch(start, commands)
    expect(batched.state).toEqual(sequentialState)
    expect(batched.events).toEqual(sequentialEvents)
    expect(start).toEqual(newGame('jet_age', 'det-batch'))
  })

  it('batched seat commands preserve multiplayer ordering', () => {
    const start = newGame('jet_age', 'det-seat-batch', undefined, [0, 1])
    const entries: SeatCommand[] = [
      { seat: 0, command: { type: 'set_marketing', level: 1 } },
      { seat: 1, command: { type: 'set_marketing', level: 2 } },
      { seat: 1, command: { type: 'end_quarter' } },
    ]
    let sequentialState = start
    const sequentialEvents = []
    for (const entry of entries) {
      const result = applyCommandFor(sequentialState, entry.seat, entry.command)
      sequentialState = result.state
      sequentialEvents.push(...result.events)
    }

    const batched = applyCommandBatchFor(start, entries)
    expect(batched.state).toEqual(sequentialState)
    expect(batched.events).toEqual(sequentialEvents)
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
