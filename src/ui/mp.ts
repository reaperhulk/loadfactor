// Async multiplayer by link (PLAN.md §10, MP1). Pure protocol logic — no DOM,
// no storage, no React — so the whole thing is unit-testable, including two
// simulated clients playing a full game against each other.
//
// The model is lockstep: nobody ever transmits game state. A game is
// (scenario, seed, seats, entries) where entries is an ordered log of
// {seat, command}; every client folds the same log through the same engine
// and holds the identical world (SeatReplay in the engine).
//
// The chain protocol, two players, strict alternation:
//   - The creator (seat 0) OPENS quarter 1: plans commands, sends the invite
//     link carrying setup + that first batch.
//   - Each sitting after that: CLOSE the current quarter (your commands, with
//     the other side's already applied — you see their moves), end_quarter,
//     then OPEN the next blind, and send.
//   - The closer therefore alternates every quarter, which is the rotation
//     rule from §10.4: no seat holds a standing last-mover advantage.
//
// A turn link carries only the entries appended during the sender's sitting —
// a delta, never history (§10.2) — plus the state hash after applying them.
// The receiver replays the delta on its own state and must land on the same
// hash: any divergence, tampering, or out-of-order link fails loudly instead
// of silently forking the game.

import {
  applyCommandFor,
  newGame,
  type Command,
  type GameState,
  type SeatCommand,
} from '../engine'
import { hashState } from '../harness/hash'

export const MP_SEATS: readonly number[] = [1] // seat 1 is human; seat 0 implicit
export const SEATS: readonly [number, number] = [0, 1]

export interface MpGame {
  v: 1
  gameId: string
  scenario: string
  seed: string
  mySeat: 0 | 1
  entries: SeatCommand[]
  // How much of the log the other side has seen — everything up to here was
  // either authored by them or already sent to them. The next turn link
  // carries entries.slice(theirKnown).
  theirKnown: number
}

// A turn link's payload. `expect` is the hash of the state the delta applies
// on top of (a fast, specific "you are behind / ahead" check); `result` is
// the hash after — the lockstep agreement itself.
export interface MpTurn {
  v: 1
  gameId: string
  scenario: string
  seed: string
  seat: 0 | 1
  delta: SeatCommand[]
  expect: string
  result: string
}

export function replayEntries(scenario: string, seed: string, entries: readonly SeatCommand[]): GameState {
  let state = newGame(scenario, seed, undefined, MP_SEATS)
  for (const e of entries) state = applyCommandFor(state, e.seat, e.command).state
  return state
}

export function quartersResolved(entries: readonly SeatCommand[]): number {
  return entries.filter((e) => e.command.type === 'end_quarter').length
}

// Whose sitting is it? The creator opens quarter 1; after that the closer of
// quarter q is seats[q % 2] (q counted from 1), and each sitting belongs to
// that closer. Equivalently: seat 1 closes odd quarters, seat 0 even ones.
export function nextActor(entries: readonly SeatCommand[]): 0 | 1 {
  if (entries.length === 0) return 0 // the creator opens q1
  return ((quartersResolved(entries) + 1) % 2) as 0 | 1
}

// One sitting's appended entries, from the acting seat's staged commands:
// close the current quarter, resolve it, open the next. The very first
// sitting (creator, empty log) only opens.
export function sittingEntries(
  entries: readonly SeatCommand[],
  seat: 0 | 1,
  close: readonly Command[],
  open: readonly Command[],
): SeatCommand[] {
  if (entries.length === 0) {
    return open.map((command) => ({ seat, command }))
  }
  return [
    ...close.map((command) => ({ seat, command })),
    { seat, command: { type: 'end_quarter' } as Command },
    ...open.map((command) => ({ seat, command })),
  ]
}

export function buildTurn(game: MpGame, appended: readonly SeatCommand[]): MpTurn {
  const before = replayEntries(game.scenario, game.seed, game.entries)
  let after = before
  for (const e of appended) after = applyCommandFor(after, e.seat, e.command).state
  return {
    v: 1,
    gameId: game.gameId,
    scenario: game.scenario,
    seed: game.seed,
    seat: game.mySeat,
    delta: [...appended],
    expect: hashState(before),
    result: hashState(after),
  }
}

export type ApplyOutcome =
  | { ok: true; entries: SeatCommand[]; state: GameState }
  | { ok: false; reason: string }

// A sitting has ONE legal shape, and validating it is what stops the quiet
// cheats that authorship and hashes cannot see. Without this, a hostile
// sender could pack several end_quarters into one delta and play multiple
// quarters solo while the opponent's airline idles — every hash would check
// out, because hashes attest what happened, not that it was allowed.
const MAX_DELTA = 200 // a sitting is ~a dozen commands; 200 is not a game, it is an attack

export function validSittingShape(
  prior: readonly SeatCommand[],
  delta: readonly SeatCommand[],
  finalState: GameState,
): string | null {
  if (delta.length === 0) return 'empty turn — nothing to apply'
  if (delta.length > MAX_DELTA) return 'turn is implausibly large'
  const eqCount = delta.filter((e) => e.command.type === 'end_quarter').length
  if (prior.length === 0) {
    // The creator's opening: plan quarter 1, resolve nothing.
    if (eqCount !== 0) return 'an opening sitting cannot resolve quarters'
    return null
  }
  if (eqCount !== 1) return 'a sitting resolves exactly one quarter'
  // Nothing may follow the resolution if it ended the game.
  const eqAt = delta.findIndex((e) => e.command.type === 'end_quarter')
  if (finalState.phase !== 'planning' && eqAt !== delta.length - 1) {
    return 'commands after the end of the game'
  }
  return null
}

// Fold an incoming turn into a local game. Every failure mode is a distinct,
// human-readable reason — a mis-pasted link should say what went wrong.
export function applyTurn(game: MpGame, turn: MpTurn): ApplyOutcome {
  if (turn.gameId !== game.gameId) return { ok: false, reason: 'link is for a different game' }
  if (turn.seat === game.mySeat) return { ok: false, reason: 'this is your own link — send it to your opponent' }
  if (turn.seat !== nextActor(game.entries)) {
    return { ok: false, reason: 'not their turn — this link is stale or already applied' }
  }
  // Authorship: every planning command in the delta must be theirs. The
  // engine would apply a mis-attributed command to the named seat, so the
  // guard lives here, at the trust boundary.
  for (const e of turn.delta) {
    if (e.command.type !== 'end_quarter' && e.seat !== turn.seat) {
      return { ok: false, reason: 'link contains commands for a seat its sender does not hold' }
    }
  }
  const before = replayEntries(game.scenario, game.seed, game.entries)
  if (hashState(before) !== turn.expect) {
    return { ok: false, reason: 'games out of sync — this link was made against a different history' }
  }
  // Fold their commands through OUR engine. The engine validates every one
  // exactly as it would our own — that is the security model: state is never
  // accepted from the wire, only commands, so an illegal state cannot be
  // injected, only proposed move by move to a rules engine we run. The
  // try/catch turns any residual engine surprise from hostile JSON into a
  // refusal instead of a crash.
  let after = before
  try {
    for (const e of turn.delta) after = applyCommandFor(after, e.seat, e.command).state
  } catch {
    return { ok: false, reason: 'link contains a command the engine cannot process' }
  }
  const shape = validSittingShape(game.entries, turn.delta, after)
  if (shape !== null) return { ok: false, reason: shape }
  if (hashState(after) !== turn.result) {
    return { ok: false, reason: 'replaying their turn gave a different world — the link is corrupt' }
  }
  return { ok: true, entries: [...game.entries, ...turn.delta], state: after }
}

// --- Wire format -----------------------------------------------------------
// deflate-raw + base64url, prefixed '1'; a '0' prefix is uncompressed
// base64url for engines without CompressionStream. Async because the
// streams API is.

const b64url = (bytes: Uint8Array): string => {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const unb64url = (text: string): Uint8Array => {
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream))
  return new Uint8Array(await out.arrayBuffer())
}

export async function encodeTurn(turn: MpTurn): Promise<string> {
  const raw = new TextEncoder().encode(JSON.stringify(turn))
  if (typeof CompressionStream === 'undefined') return '0' + b64url(raw)
  return '1' + b64url(await pipe(raw, new CompressionStream('deflate-raw')))
}

// Wire caps: a legitimate turn is under a kilobyte encoded (§10.2), so these
// bounds cost nothing real — but without the second one, a 400-character
// link could deflate to gigabytes and take the receiver's tab with it.
const MAX_ENCODED = 64 * 1024
const MAX_DECODED = 512 * 1024

async function inflateCapped(bytes: Uint8Array): Promise<Uint8Array | null> {
  const reader = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'))
    .getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > MAX_DECODED) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  return out
}

export async function decodeTurn(text: string): Promise<MpTurn | null> {
  try {
    if (text.length > MAX_ENCODED) return null
    const body = unb64url(text.slice(1))
    const raw = text[0] === '1' ? await inflateCapped(body) : body
    if (raw === null || raw.length > MAX_DECODED) return null
    const turn = JSON.parse(new TextDecoder().decode(raw)) as MpTurn
    if (turn.v !== 1 || typeof turn.gameId !== 'string' || !Array.isArray(turn.delta)) return null
    if (turn.seat !== 0 && turn.seat !== 1) return null
    if (typeof turn.expect !== 'string' || typeof turn.result !== 'string') return null
    return turn
  } catch {
    return null
  }
}
