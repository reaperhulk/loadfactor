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
  let state = newGame(replay.scenario, replay.seed, replay.player, replay.humanSeats)
  const allEvents: GameEvent[] = []
  for (const entry of replay.entries) {
    const result = applyCommandFor(state, entry.seat, entry.command)
    state = result.state
    allEvents.push(...result.events)
  }
  return { state, events: allEvents }
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
  let state = newGame(replay.scenario, replay.seed, replay.player)
  const allEvents: GameEvent[] = []
  for (const command of replay.commands) {
    const result = applyCommand(state, command)
    state = result.state
    allEvents.push(...result.events)
  }
  return { state, events: allEvents }
}
