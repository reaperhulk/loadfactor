// The bridge between the pure engine and the React shell. Holds the current
// GameState plus the full command log (which IS the save/replay format), and
// notifies subscribers after every engine call. Commands are the only write
// path — the UI never mutates state.

import {
  applyCommandFor,
  newGame,
  runReplay,
  type Command,
  type GameEvent,
  type GameState,
  type PlayerSetup,
  type Replay,
  type SeatCommand,
} from '../engine'
import { hashState } from '../harness/hash'
import {
  applyTurn,
  buildTurn,
  decodeTurn,
  encodeTurn,
  MP_SEATS,
  nextActor,
  type MpGame,
} from './mp'
import { getScenario } from '../data/scenarios'
import { checkAchievements, type AchievementDef } from './achievements'

// One resolved quarter's full event batch — the newspaper archive's unit.
export interface QuarterRecord {
  turn: number // the turn that was resolved (pre-increment)
  events: GameEvent[]
}

export type SessionMode = 'solo' | 'hotseat' | 'link'

export interface Session {
  state: GameState
  lastEvents: GameEvent[] // events from the most recent engine call
  reportEvents: GameEvent[] // events from the most recent end_quarter
  reportArchive: QuarterRecord[] // every resolved quarter, oldest first
  commandLog: Command[]
  lastUnlocks: AchievementDef[] // achievements unlocked by the latest engine call
  careerUnlocks: string[] // achievement ids earned during this career
  // Multiplayer (PLAN.md §10). Solo is a one-seat game of the same shape.
  mode: SessionMode
  seats: number[] // airline indices held by humans, ascending
  activeSeat: number // the seat currently planning (the viewer, in link mode)
  entries: SeatCommand[] // seat-tagged log — the multiplayer replay format
  mp: null | {
    gameId: string
    mySeat: 0 | 1
    theirKnown: number // how much of `entries` the other side has
    awaiting: boolean // their sitting: planning is locked here
  }
}

// Whose airline the UI is showing/controlling right now. Every panel that
// used to hard-code airlines[0] reads this instead.
export function viewSeat(): number {
  return session?.activeSeat ?? 0
}

// Hot-seat: planning order rotates with the quarter so no seat always plans
// first (or last — the last planner sees everyone else's committed moves).
export function seatOrder(): number[] {
  if (!session) return [0]
  const seats = session.seats
  const shift = session.state.turn % seats.length
  return [...seats.slice(shift), ...seats.slice(0, shift)]
}

// Hand the device to the next player this quarter, if any.
export function passSeat(): boolean {
  if (!session || session.mode !== 'hotseat') return false
  const order = seatOrder()
  const at = order.indexOf(session.activeSeat)
  if (at < 0 || at >= order.length - 1) return false
  session = { ...session, activeSeat: order[at + 1]! }
  notify()
  return true
}

// End Quarter is the last planner's button in hot-seat; anyone's in solo.
export function canEndQuarter(): boolean {
  if (!session) return false
  if (session.mode === 'hotseat') {
    const order = seatOrder()
    return session.activeSeat === order[order.length - 1]
  }
  if (session.mode === 'link') {
    // The closer resolves; the opener's first sitting has nothing to close.
    return session.mp !== null && !session.mp.awaiting && session.entries.length > 0
  }
  return true
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
  finished?: boolean // the career ended — the save is a finished record now
}

// A hot-seat save: same identity idea, seat-tagged log. Solo saves stay v1
// so every existing save keeps loading.
interface SaveV2 {
  version: 2
  scenario: string
  seed: string
  player?: PlayerSetup
  color?: string
  savedAt?: number
  finished?: boolean
  humanSeats: number[]
  entries: SeatCommand[]
}

export type AnySave = SaveV1 | SaveV2

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
  if (session.mode === 'link') {
    persistMp()
    return
  }
  if (session.mode === 'hotseat') {
    const save: SaveV2 = {
      version: 2,
      scenario: session.state.scenario,
      seed: session.state.seed,
      player: sessionPlayer ?? undefined,
      color: playerColor ?? undefined,
      finished: session.state.phase !== 'planning' || undefined,
      savedAt: Date.now(),
      humanSeats: session.seats.filter((x) => x !== 0),
      entries: session.entries,
    }
    try {
      localStorage.setItem(SLOT_KEYS[activeSlot]!, JSON.stringify(save))
    } catch {
      // no storage, play on
    }
    return
  }
  const save: SaveV1 = {
    version: 1,
    scenario: session.state.scenario,
    seed: session.state.seed,
    player: sessionPlayer ?? undefined,
    color: playerColor ?? undefined,
    challenge: challengeTarget ?? undefined,
    finished: session.state.phase !== 'planning' || undefined,
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

export function loadSaveAt(slot: number): AnySave | null {
  try {
    const raw = localStorage.getItem(SLOT_KEYS[slot] ?? '')
    if (!raw) return null
    const save = JSON.parse(raw) as AnySave
    if (typeof save.seed !== 'string') return null
    if (save.version === 1 && !Array.isArray(save.commands)) return null
    if (save.version === 2 && (!Array.isArray(save.entries) || !Array.isArray(save.humanSeats)))
      return null
    if (save.version !== 1 && save.version !== 2) return null
    getScenario(save.scenario) // throws on unknown scenario
    return save
  } catch {
    return null
  }
}

export function listSaves(): (AnySave | null)[] {
  return SLOT_KEYS.map((_, i) => loadSaveAt(i))
}

// The slot a new career will claim: first free, else the stalest save.
export function nextFreeSlot(): { slot: number; overwrites: AnySave | null } {
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

// Rebuild a session from a save by replaying it through the engine — one
// incremental pass that also reconstructs the full quarter archive (the
// Report tab's newspaper morgue), since a save IS a replay.
export function resumeSave(slot = 0): boolean {
  const save = loadSaveAt(slot)
  if (!save) return false
  activeSlot = slot
  sessionPlayer = save.player ?? null
  playerColor = save.color ?? null
  challengeTarget = (save.version === 1 ? save.challenge : undefined) ?? null
  const seats = save.version === 2 ? [0, ...save.humanSeats] : [0]
  const entries: SeatCommand[] =
    save.version === 2 ? save.entries : save.commands.map((command) => ({ seat: 0, command }))
  sessionFromEntries({
    scenario: save.scenario,
    seed: save.seed,
    entries,
    mode: seats.length > 1 ? 'hotseat' : 'solo',
    seats,
    // Resuming mid-quarter lands at the head of the current rotation — the
    // safe seat to hand the device to.
    activeSeat: 0,
    mp: null,
    player: save.player,
  })
  if (session && session.mode === 'hotseat') {
    session = { ...session, activeSeat: session.state.turn % seats.length }
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
  humans = 1, // hot-seat: how many airline seats are people at this device
): void {
  const player: PlayerSetup | null =
    custom && (custom.name !== undefined || custom.hq !== undefined)
      ? { name: custom.name, hq: custom.hq }
      : null
  sessionPlayer = player
  playerColor = custom?.color ?? null
  challengeTarget = humans > 1 ? null : (challenge ?? null)
  activeSlot = nextFreeSlot().slot
  const seats = Array.from({ length: Math.max(1, Math.min(4, humans)) }, (_, i) => i)
  session = {
    state: newGame(scenarioId, seed, player ?? undefined, seats.slice(1)),
    lastEvents: [],
    reportEvents: [],
    reportArchive: [],
    commandLog: [],
    lastUnlocks: [],
    careerUnlocks: [],
    mode: seats.length > 1 ? 'hotseat' : 'solo',
    seats,
    activeSeat: 0,
    entries: [],
    mp: null,
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
  if (session.mode === 'link' && session.mp?.awaiting) return [] // their sitting
  const seat = session.activeSeat
  const wasPlanning = session.state.phase === 'planning'
  const { state, events } = applyCommandFor(session.state, seat, command)
  // Fame and achievements are solo concepts: a hot-seat or link game has no
  // single "the player" to credit.
  if (session.mode === 'solo' && wasPlanning && state.phase !== 'planning') recordFame(state)
  const unlocks = session.mode === 'solo' ? checkAchievements(state, events) : []
  const resolved =
    command.type === 'end_quarter' &&
    events.some((e) => e.type === 'quarter_report' || e.type === 'game_over')
  // A resolved quarter re-opens planning at the head of the new rotation.
  const nextActive =
    resolved && session.mode === 'hotseat'
      ? (state.turn % session.seats.length) as number
      : session.activeSeat
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
    mode: session.mode,
    seats: session.seats,
    activeSeat: nextActive,
    entries: [...session.entries, { seat, command }],
    mp: session.mp,
  }
  persist()
  notify()
  return events
}

// --- Link duels (PLAN.md §10, MP1) ----------------------------------------
// One store for all link games, keyed by gameId. The session holds the open
// one; the menu lists the rest.

const MP_KEY = 'loadfactor:mp:v1'

interface MpRecord {
  gameId: string
  scenario: string
  seed: string
  mySeat: 0 | 1
  entries: SeatCommand[]
  theirKnown: number
  awaiting: boolean
  savedAt: number
}

function loadMpStore(): Record<string, MpRecord> {
  try {
    const raw = localStorage.getItem(MP_KEY)
    const map = raw ? (JSON.parse(raw) as Record<string, MpRecord>) : {}
    return map && typeof map === 'object' ? map : {}
  } catch {
    return {}
  }
}

function persistMp(): void {
  if (!session || session.mode !== 'link' || !session.mp) return
  const store = loadMpStore()
  store[session.mp.gameId] = {
    gameId: session.mp.gameId,
    scenario: session.state.scenario,
    seed: session.state.seed,
    mySeat: session.mp.mySeat,
    entries: session.entries,
    theirKnown: session.mp.theirKnown,
    awaiting: session.mp.awaiting,
    savedAt: Date.now(),
  }
  try {
    localStorage.setItem(MP_KEY, JSON.stringify(store))
  } catch {
    // no storage — the game lives only in this tab
  }
}

export function listMpGames(): MpRecord[] {
  return Object.values(loadMpStore()).sort((a, b) => b.savedAt - a.savedAt)
}

// Rebuild a live session from an entry log — the one fold used by resume,
// join, and receive, so they cannot disagree about how a log becomes a game.
function sessionFromEntries(record: {
  scenario: string
  seed: string
  entries: SeatCommand[]
  mode: SessionMode
  seats: number[]
  activeSeat: number
  mp: Session['mp']
  player?: PlayerSetup
}): void {
  let state = newGame(record.scenario, record.seed, record.player, record.seats.slice(1))
  const reportArchive: QuarterRecord[] = []
  for (const e of record.entries) {
    const turnBefore = state.turn
    const res = applyCommandFor(state, e.seat, e.command)
    state = res.state
    if (
      e.command.type === 'end_quarter' &&
      res.events.some((ev) => ev.type === 'quarter_report' || ev.type === 'game_over')
    ) {
      reportArchive.push({ turn: turnBefore, events: res.events })
    }
  }
  session = {
    state,
    lastEvents: [],
    reportEvents: reportArchive[reportArchive.length - 1]?.events ?? [],
    reportArchive,
    commandLog: record.entries.map((e) => e.command),
    lastUnlocks: [],
    careerUnlocks: [],
    mode: record.mode,
    seats: record.seats,
    activeSeat: record.activeSeat,
    entries: [...record.entries],
    mp: record.mp,
  }
}

export function startLinkGame(scenarioId: string, seed: string): void {
  const gameId = `${seed}-${crypto.randomUUID().slice(0, 8)}`
  sessionPlayer = null
  playerColor = null
  challengeTarget = null
  sessionFromEntries({
    scenario: scenarioId,
    seed,
    entries: [],
    mode: 'link',
    seats: [0, 1],
    activeSeat: 0,
    mp: { gameId, mySeat: 0, theirKnown: 0, awaiting: false },
  })
  persist()
  notify()
}

export function resumeMpGame(gameId: string): boolean {
  const rec = loadMpStore()[gameId]
  if (!rec) return false
  sessionPlayer = null
  playerColor = null
  challengeTarget = null
  sessionFromEntries({
    scenario: rec.scenario,
    seed: rec.seed,
    entries: rec.entries,
    mode: 'link',
    seats: [0, 1],
    activeSeat: rec.mySeat,
    mp: { gameId: rec.gameId, mySeat: rec.mySeat, theirKnown: rec.theirKnown, awaiting: rec.awaiting },
  })
  notify()
  return true
}

// Package everything the other side has not seen into a turn link, and lock
// planning until their reply.
// The most recent outgoing link, for "copy again" while waiting. In-memory
// only: after a reload the chain still works, there is just nothing to
// re-copy until the next sitting.
let lastSentLink: string | null = null

export function getLastSentLink(): string | null {
  return lastSentLink
}

export async function sendSitting(): Promise<string | null> {
  if (!session || session.mode !== 'link' || !session.mp || session.mp.awaiting) return null
  const known = session.entries.slice(0, session.mp.theirKnown)
  const appended = session.entries.slice(session.mp.theirKnown)
  if (appended.length === 0) return null
  const game: MpGame = {
    v: 1,
    gameId: session.mp.gameId,
    scenario: session.state.scenario,
    seed: session.state.seed,
    mySeat: session.mp.mySeat,
    entries: known,
    theirKnown: session.mp.theirKnown,
  }
  const turn = buildTurn(game, appended)
  const encoded = await encodeTurn(turn)
  session = {
    ...session,
    mp: { ...session.mp, theirKnown: session.entries.length, awaiting: true },
  }
  persist()
  notify()
  const base = `${window.location.origin}${window.location.pathname}`
  lastSentLink = `${base}#mpturn=${encoded}`
  return lastSentLink
}

export type ReceiveResult = { ok: true; joined: boolean } | { ok: false; reason: string }

// Fold an incoming turn link into its game — resuming, or joining if the
// link opens a game we have never seen (the invite IS the first turn).
export async function receiveTurn(encoded: string): Promise<ReceiveResult> {
  const turn = await decodeTurn(encoded)
  if (!turn) return { ok: false, reason: 'that link is not a turn link' }
  const store = loadMpStore()
  let rec = store[turn.gameId]
  let joined = false
  if (!rec) {
    // Never seen: joinable only if it opens the game from the start — the
    // expected-state hash must be a fresh world's.
    const fresh = newGame(turn.scenario, turn.seed, undefined, MP_SEATS)
    if (turn.seat !== 0 || turn.expect !== hashState(fresh)) {
      return { ok: false, reason: 'no local copy of this game — ask for a fresh invite link' }
    }
    rec = {
      gameId: turn.gameId,
      scenario: turn.scenario,
      seed: turn.seed,
      mySeat: 1,
      entries: [],
      theirKnown: 0,
      awaiting: false,
      savedAt: Date.now(),
    }
    joined = true
  }
  const game: MpGame = {
    v: 1,
    gameId: rec.gameId,
    scenario: rec.scenario,
    seed: rec.seed,
    mySeat: rec.mySeat,
    entries: rec.entries,
    theirKnown: rec.theirKnown,
  }
  const outcome = applyTurn(game, turn)
  if (!outcome.ok) return { ok: false, reason: outcome.reason }
  sessionPlayer = null
  playerColor = null
  challengeTarget = null
  sessionFromEntries({
    scenario: rec.scenario,
    seed: rec.seed,
    entries: outcome.entries,
    mode: 'link',
    seats: [0, 1],
    activeSeat: rec.mySeat,
    mp: {
      gameId: rec.gameId,
      mySeat: rec.mySeat,
      theirKnown: outcome.entries.length,
      awaiting: false,
    },
  })
  persist()
  notify()
  return { ok: true, joined }
}

// Whose sitting is it, for the banner. Derived from the log, not stored, so
// it cannot drift from the truth.
export function mpStatus(): { yourSitting: boolean; opening: boolean } | null {
  if (!session || session.mode !== 'link' || !session.mp) return null
  if (session.mp.awaiting) return { yourSitting: false, opening: false }
  const actor = nextActor(session.entries.slice(0, session.mp.theirKnown))
  return { yourSitting: actor === session.mp.mySeat, opening: session.entries.length === 0 }
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

// Back to the menu. The save STAYS: a finished career is the only replayable
// record of those decades, and "New game" used to destroy it. Slots recycle
// via nextFreeSlot (stalest first) or an explicit delete.
export function reset(): void {
  session = null
  sessionPlayer = null
  playerColor = null
  challengeTarget = null
  notify()
}
