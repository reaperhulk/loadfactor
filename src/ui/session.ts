// The bridge between the pure engine and the React shell. Holds the current
// GameState plus the full command log (which IS the save/replay format), and
// notifies subscribers after every engine call. Commands are the only write
// path — the UI never mutates state.

import {
  applyCommand,
  newGame,
  runReplay,
  type Command,
  type GameEvent,
  type GameState,
  type PlayerSetup,
  type Replay,
} from '../engine'
import { getScenario } from '../data/scenarios'

export interface Session {
  state: GameState
  lastEvents: GameEvent[] // events from the most recent engine call
  reportEvents: GameEvent[] // events from the most recent end_quarter
  commandLog: Command[]
}

// A save IS a replay: (scenario, seed, customization, command log).
// Determinism does the rest. The airline color is presentation-only and
// rides along so identity survives a reload.
const SAVE_KEY = 'loadfactor:save:v1'

interface SaveV1 extends Replay {
  version: 1
  color?: string
}

// The player's chosen livery color (a CSS color), applied as the accent.
let playerColor: string | null = null

export function getPlayerColor(): string | null {
  return playerColor
}

function persist(): void {
  if (!session) return
  const save: SaveV1 = {
    version: 1,
    scenario: session.state.scenario,
    seed: session.state.seed,
    player: sessionPlayer ?? undefined,
    color: playerColor ?? undefined,
    commands: session.commandLog,
  }
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(save))
  } catch {
    // Storage may be full or unavailable (private mode) — play on without saves.
  }
}

// The customization the current session was started with (part of its replay).
let sessionPlayer: PlayerSetup | null = null

export function loadSave(): SaveV1 | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    if (!raw) return null
    const save = JSON.parse(raw) as SaveV1
    if (save.version !== 1 || typeof save.seed !== 'string' || !Array.isArray(save.commands)) return null
    getScenario(save.scenario) // throws on unknown scenario
    return save
  } catch {
    return null
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(SAVE_KEY)
  } catch {
    // ignore
  }
}

// Rebuild a session from a save by replaying it through the engine.
export function resumeSave(): boolean {
  const save = loadSave()
  if (!save) return false
  sessionPlayer = save.player ?? null
  playerColor = save.color ?? null
  const { state } = runReplay(save)
  // Recover the last quarter's report so the Report panel isn't empty on resume.
  let lastEnd = -1
  for (let i = save.commands.length - 1; i >= 0; i--) {
    if (save.commands[i]!.type === 'end_quarter') {
      lastEnd = i
      break
    }
  }
  let reportEvents: GameEvent[] = []
  if (lastEnd >= 0) {
    const upTo = runReplay({ ...save, commands: save.commands.slice(0, lastEnd) })
    reportEvents = applyCommand(upTo.state, { type: 'end_quarter' }).events
  }
  session = { state, lastEvents: [], reportEvents, commandLog: [...save.commands] }
  notify()
  return true
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

export function startGame(
  scenarioId: string,
  seed: string,
  custom?: PlayerSetup & { color?: string },
): void {
  const player: PlayerSetup | null =
    custom && (custom.name !== undefined || custom.hq !== undefined)
      ? { name: custom.name, hq: custom.hq }
      : null
  sessionPlayer = player
  playerColor = custom?.color ?? null
  session = {
    state: newGame(scenarioId, seed, player ?? undefined),
    lastEvents: [],
    reportEvents: [],
    commandLog: [],
  }
  persist()
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
  persist()
  notify()
  return events
}

export function getReplay(): Replay | null {
  if (!session) return null
  return {
    scenario: session.state.scenario,
    seed: session.state.seed,
    player: sessionPlayer ?? undefined,
    commands: session.commandLog,
  }
}

export function reset(): void {
  session = null
  sessionPlayer = null
  playerColor = null
  clearSave()
  notify()
}
