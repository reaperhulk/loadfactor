// The engine's public surface. Three entry points (PLAN.md §3.1):
//   newGame(scenarioId, seed) → GameState
//   applyCommand(state, cmd)  → { state, events }   (planning actions)
//   endQuarter(state)         → { state, events }   (quarter resolution)
// applyCommand treats end_quarter as a command so a replay is a plain fold
// over (scenarioId, seed, Command[]).

import { applyPlanningCommand } from './commands'
import { newGame } from './newGame'
import { endQuarter } from './turn'
import type { Command, EngineResult, GameEvent, GameState } from './types'

export { newGame } from './newGame'
export { endQuarter } from './turn'
export * from './types'

export function applyCommand(prev: GameState, command: Command): EngineResult {
  if (command.type === 'end_quarter') return endQuarter(prev)
  const state = structuredClone(prev)
  const { events } = applyPlanningCommand(state, 0, command)
  return { state, events }
}

export interface Replay {
  scenario: string
  seed: string
  commands: Command[]
}

export function runReplay(replay: Replay): { state: GameState; events: GameEvent[] } {
  let state = newGame(replay.scenario, replay.seed)
  const allEvents: GameEvent[] = []
  for (const command of replay.commands) {
    const result = applyCommand(state, command)
    state = result.state
    allEvents.push(...result.events)
  }
  return { state, events: allEvents }
}
