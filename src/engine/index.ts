// The engine's public surface. Three entry points (PLAN.md §3.1):
//   newGame(scenarioId, seed) → GameState
//   applyCommand(state, cmd)  → { state, events }   (planning actions)
//   endQuarter(state)         → { state, events }   (quarter resolution)
// applyCommand treats end_quarter as a command so a replay is a plain fold
// over (scenarioId, seed, Command[]).

import { applyPlanningCommand } from './commands'
import { newGame } from './newGame'
import { endQuarter } from './turn'
import type { PlayerSetup } from './newGame'
import type { Command, EngineResult, GameEvent, GameState } from './types'

export { deriveFootholds, newGame } from './newGame'
export type { PlayerSetup } from './newGame'
export { endQuarter } from './turn'
export * from './types'

export function applyCommand(prev: GameState, command: Command): EngineResult {
  return applyCommandFor(prev, 0, command)
}

// The multiplayer entry point: any airline seat a human holds issues its
// commands here. Seat 0 via applyCommand is the same call — "the player" is
// a UI convention, not an engine one. end_quarter is seat-agnostic: it is a
// phase transition, and who may trigger it is the session's protocol rule.
export function applyCommandFor(prev: GameState, seat: number, command: Command): EngineResult {
  if (command.type === 'end_quarter') return endQuarter(prev)
  const state = structuredClone(prev)
  const { events } = applyPlanningCommand(state, seat, command)
  return { state, events }
}

// Apply a log without cloning the whole simulation for every planning click.
// State is cloned lazily once per consecutive planning run; endQuarter keeps
// its existing immutable boundary. This preserves the exact command/event
// ordering of repeated applyCommandFor calls while making long replays cheap.
export function applyCommandBatchFor(prev: GameState, entries: readonly SeatCommand[]): EngineResult {
  let state = prev
  let planningStateIsMutable = false
  const events: GameEvent[] = []

  for (const { seat, command } of entries) {
    if (command.type === 'end_quarter') {
      const result = endQuarter(state)
      state = result.state
      planningStateIsMutable = false
      events.push(...result.events)
      continue
    }

    if (!planningStateIsMutable) {
      state = structuredClone(state)
      planningStateIsMutable = true
    }
    events.push(...applyPlanningCommand(state, seat, command).events)
  }

  return { state, events }
}

export function applyCommandBatch(prev: GameState, commands: readonly Command[]): EngineResult {
  return applyCommandBatchFor(
    prev,
    commands.map((command) => ({ seat: 0, command })),
  )
}

// A multiplayer log entry: which seat issued the command. A multiplayer game
// is (scenario, seed, seats, entries) exactly as a solo game is
// (scenario, seed, commands) — fold the entries and determinism does the rest.
export interface SeatCommand {
  seat: number
  command: Command
}

export interface SeatReplay {
  scenario: string
  seed: string
  player?: PlayerSetup
  humanSeats: readonly number[]
  entries: readonly SeatCommand[]
}

export function runSeatReplay(replay: SeatReplay): { state: GameState; events: GameEvent[] } {
  return applyCommandBatchFor(
    newGame(replay.scenario, replay.seed, replay.player, replay.humanSeats),
    replay.entries,
  )
}

export interface Replay {
  scenario: string
  seed: string
  // Optional player customization (name, HQ) — part of the replay so a
  // customized career reproduces bit-for-bit.
  player?: PlayerSetup
  commands: Command[]
}

export function runReplay(replay: Replay): { state: GameState; events: GameEvent[] } {
  return applyCommandBatch(newGame(replay.scenario, replay.seed, replay.player), replay.commands)
}
