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
import { checkAchievements, type AchievementDef } from './achievements'

// One resolved quarter's full event batch — the newspaper archive's unit.
export interface QuarterRecord {
  turn: number // the turn that was resolved (pre-increment)
  events: GameEvent[]
}

export interface Session {
  state: GameState
  lastEvents: GameEvent[] // events from the most recent engine call
  reportEvents: GameEvent[] // events from the most recent end_quarter
  reportArchive: QuarterRecord[] // every resolved quarter, oldest first
  commandLog: Command[]
  lastUnlocks: AchievementDef[] // achievements unlocked by the latest engine call
  careerUnlocks: string[] // achievement ids earned during this career
}

// A save IS a replay: (scenario, seed, customization, command log).
// Determinism does the rest. The airline color is presentation-only and
// rides along so identity survives a reload.
//
// Three slots. Slot 0 keeps the original key so pre-slot saves load as-is.
const SLOT_KEYS = ['loadfactor:save:v1', 'loadfactor:save:v1:1', 'loadfactor:save:v1:2'] as const
export const SAVE_SLOTS = SLOT_KEYS.length

interface SaveV1 extends Replay {
  version: 1
  color?: string
  savedAt?: number // wall-clock ms, presentation only (slot ordering/labels)
  challenge?: ChallengeTarget // the duel this career was started against
}

// A challenge link can carry the challenger's net worth — the number to beat.
export interface ChallengeTarget {
  worth: number // $k
  by?: string // challenger's airline name
}

let challengeTarget: ChallengeTarget | null = null

export function getChallengeTarget(): ChallengeTarget | null {
  return challengeTarget
}

// The player's chosen livery color (a CSS color), applied as the accent.
let playerColor: string | null = null

export function getPlayerColor(): string | null {
  return playerColor
}

// The slot the current career auto-saves into (claimed at start/resume).
let activeSlot = 0

function persist(): void {
  if (!session) return
  const save: SaveV1 = {
    version: 1,
    scenario: session.state.scenario,
    seed: session.state.seed,
    player: sessionPlayer ?? undefined,
    color: playerColor ?? undefined,
    challenge: challengeTarget ?? undefined,
    savedAt: Date.now(),
    commands: session.commandLog,
  }
  try {
    localStorage.setItem(SLOT_KEYS[activeSlot]!, JSON.stringify(save))
  } catch {
    // Storage may be full or unavailable (private mode) — play on without saves.
  }
}

// The customization the current session was started with (part of its replay).
let sessionPlayer: PlayerSetup | null = null

export function loadSaveAt(slot: number): SaveV1 | null {
  try {
    const raw = localStorage.getItem(SLOT_KEYS[slot] ?? '')
    if (!raw) return null
    const save = JSON.parse(raw) as SaveV1
    if (save.version !== 1 || typeof save.seed !== 'string' || !Array.isArray(save.commands)) return null
    getScenario(save.scenario) // throws on unknown scenario
    return save
  } catch {
    return null
  }
}

// The legacy single-save read: slot 0.
export function loadSave(): SaveV1 | null {
  return loadSaveAt(0)
}

export function listSaves(): (SaveV1 | null)[] {
  return SLOT_KEYS.map((_, i) => loadSaveAt(i))
}

// The slot a new career will claim: first free, else the stalest save.
export function nextFreeSlot(): { slot: number; overwrites: SaveV1 | null } {
  const saves = listSaves()
  const free = saves.findIndex((s) => s === null)
  if (free >= 0) return { slot: free, overwrites: null }
  let oldest = 0
  for (let i = 1; i < saves.length; i++) {
    if ((saves[i]?.savedAt ?? 0) < (saves[oldest]?.savedAt ?? 0)) oldest = i
  }
  return { slot: oldest, overwrites: saves[oldest]! }
}

export function clearSaveAt(slot: number): void {
  try {
    localStorage.removeItem(SLOT_KEYS[slot] ?? '')
  } catch {
    // ignore
  }
}

export function clearSave(): void {
  clearSaveAt(activeSlot)
}

// Rebuild a session from a save by replaying it through the engine — one
// incremental pass that also reconstructs the full quarter archive (the
// Report tab's newspaper morgue), since a save IS a replay.
export function resumeSave(slot = 0): boolean {
  const save = loadSaveAt(slot)
  if (!save) return false
  activeSlot = slot
  sessionPlayer = save.player ?? null
  playerColor = save.color ?? null
  challengeTarget = save.challenge ?? null
  let state = newGame(save.scenario, save.seed, save.player)
  const reportArchive: QuarterRecord[] = []
  for (const cmd of save.commands) {
    const turnBefore = state.turn
    const res = applyCommand(state, cmd)
    state = res.state
    if (cmd.type === 'end_quarter' && res.events.some((e) => e.type === 'quarter_report' || e.type === 'game_over')) {
      reportArchive.push({ turn: turnBefore, events: res.events })
    }
  }
  session = {
    state,
    lastEvents: [],
    reportEvents: reportArchive[reportArchive.length - 1]?.events ?? [],
    reportArchive,
    commandLog: [...save.commands],
    lastUnlocks: [],
    careerUnlocks: [],
  }
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
  challenge?: ChallengeTarget,
): void {
  const player: PlayerSetup | null =
    custom && (custom.name !== undefined || custom.hq !== undefined)
      ? { name: custom.name, hq: custom.hq }
      : null
  sessionPlayer = player
  playerColor = custom?.color ?? null
  challengeTarget = challenge ?? null
  activeSlot = nextFreeSlot().slot
  session = {
    state: newGame(scenarioId, seed, player ?? undefined),
    lastEvents: [],
    reportEvents: [],
    reportArchive: [],
    commandLog: [],
    lastUnlocks: [],
    careerUnlocks: [],
  }
  persist()
  notify()
}

// Finished careers, newest first, capped — the menu's hall of fame.
const FAME_KEY = 'loadfactor:fame:v1'

export interface FameEntry {
  name: string
  scenario: string
  seed: string
  won: boolean
  netWorth: number
  years: number
}

// Export/import: a save is plain JSON, so a career can travel between
// browsers as text. Import validates the same way loadSaveAt does and
// claims the given slot.
export function exportSave(slot: number): string | null {
  const save = loadSaveAt(slot)
  return save ? JSON.stringify(save) : null
}

export function importSave(raw: string, slot: number): boolean {
  try {
    const save = JSON.parse(raw) as SaveV1
    if (save.version !== 1 || typeof save.seed !== 'string' || !Array.isArray(save.commands)) return false
    getScenario(save.scenario) // throws on unknown scenario
    runReplay(save) // must replay cleanly before we store it
    localStorage.setItem(SLOT_KEYS[slot] ?? '', JSON.stringify(save))
    return true
  } catch {
    return false
  }
}

// Forget everything: every save slot, the hall of fame, and the coach
// dismissal. The menu's start-fresh escape hatch.
export function clearAllData(): void {
  for (let i = 0; i < SAVE_SLOTS; i++) clearSaveAt(i)
  try {
    localStorage.removeItem(FAME_KEY)
    localStorage.removeItem('loadfactor:coach:v1')
    localStorage.removeItem('loadfactor:achievements:v1')
  } catch {
    // ignore
  }
}

export function loadFame(): FameEntry[] {
  try {
    const raw = localStorage.getItem(FAME_KEY)
    const list = raw ? (JSON.parse(raw) as FameEntry[]) : []
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

function recordFame(state: GameState): void {
  const me = state.airlines[0]!
  const entry: FameEntry = {
    name: me.name,
    scenario: state.scenario,
    seed: state.seed,
    won: state.phase === 'won',
    netWorth: me.history[me.history.length - 1]?.netWorth ?? 0,
    years: Math.floor(state.turn / 4),
  }
  try {
    localStorage.setItem(FAME_KEY, JSON.stringify([entry, ...loadFame()].slice(0, 10)))
  } catch {
    // no storage, no fame
  }
}

export function dispatch(command: Command): GameEvent[] {
  if (!session) throw new Error('no active session')
  const wasPlanning = session.state.phase === 'planning'
  const { state, events } = applyCommand(session.state, command)
  if (wasPlanning && state.phase !== 'planning') recordFame(state)
  const unlocks = checkAchievements(state, events)
  const resolved =
    command.type === 'end_quarter' &&
    events.some((e) => e.type === 'quarter_report' || e.type === 'game_over')
  session = {
    state,
    lastEvents: events,
    reportEvents: command.type === 'end_quarter' ? events : session.reportEvents,
    reportArchive: resolved
      ? [...session.reportArchive, { turn: session.state.turn, events }]
      : session.reportArchive,
    commandLog: [...session.commandLog, command],
    lastUnlocks: unlocks,
    careerUnlocks: unlocks.length
      ? [...session.careerUnlocks, ...unlocks.map((a) => a.id)]
      : session.careerUnlocks,
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
  challengeTarget = null
  clearSave()
  notify()
}
