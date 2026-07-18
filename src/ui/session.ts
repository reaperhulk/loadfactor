// The bridge between the pure engine and the React shell. Holds the current
// GameState plus the full command log (which IS the save/replay format), and
// notifies subscribers after every engine call. Commands are the only write
// path — the UI never mutates state.

import { applyCommand, newGame, type Command, type GameEvent, type GameState, type Replay } from '../engine'

export interface Session {
  state: GameState
  lastEvents: GameEvent[] // events from the most recent engine call
  reportEvents: GameEvent[] // events from the most recent end_quarter
  commandLog: Command[]
}

type Listener = () => void

let session: Session | null = null
const listeners = new Set<Listener>()

function notify(): void {
  for (const l of listeners) l()
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getSession(): Session | null {
  return session
}

export function startGame(scenarioId: string, seed: string): void {
  session = {
    state: newGame(scenarioId, seed),
    lastEvents: [],
    reportEvents: [],
    commandLog: [],
  }
  notify()
}

export function dispatch(command: Command): GameEvent[] {
  if (!session) throw new Error('no active session')
  const { state, events } = applyCommand(session.state, command)
  session = {
    state,
    lastEvents: events,
    reportEvents: command.type === 'end_quarter' ? events : session.reportEvents,
    commandLog: [...session.commandLog, command],
  }
  notify()
  return events
}

export function getReplay(): Replay | null {
  if (!session) return null
  return {
    scenario: session.state.scenario,
    seed: session.state.seed,
    commands: session.commandLog,
  }
}

export function reset(): void {
  session = null
  notify()
}
