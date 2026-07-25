// Airport capacity (PLAN.md §2.3): what a slot costs to take and to keep,
// how the waiting list resolves, and when the authorities build more.
//
// The old system auctioned slots with a seeded roll. Measurement killed it:
// no airport ever filled its pool, so the "contested resource" was never
// contested, and the only number the player controlled — the bid — had a
// closed-form optimum the interface pre-filled. What replaced it keeps the
// position (a slot is a standing asset at a city) and drops the dice:
//
//   • Capacity is genuinely scarce, so somebody has to go without.
//   • Requests QUEUE. Earlier requests are served first, so the decision is
//     WHEN to commit, not how much to spend.
//   • Nobody is thrown off a list. Being behind costs TIME, and cancelling
//     refunds the fee in full — so the price of a bad queue is the quarters
//     you waited, never the money.
//   • Slots are RENTED, not owned: holding one bills every quarter, so a
//     hoarded network of unused positions is a visible bill instead of the
//     silent confiscation use-it-or-lose-it used to perform.
//   • Authorities EXPAND on a published schedule. Scarcity is a timetable you
//     can plan around — wait two years for Heathrow's new terminal, or go
//     somewhere nobody is queuing today.

import { getCity } from '../data/cities'
import {
  EXPANSION_EVERY_QUARTERS,
  EXPANSION_SIZE_BASE,
  EXPANSION_SIZE_PER_POINT,
  SLOTS_PER_GRANT,
  SLOT_FEE_PER_POINT,
  SLOT_RENT_PER_POINT,
} from '../data/constants'
import { fnv1a } from './rng'
import { slotsAllocated, slotsFree } from './queries'
import type { Airline, GameEvent, GameState } from './types'

// A city's weight for every slot price: the same (pop + biz) scale the whole
// game reads a city's importance by.
function cityPoints(cityId: string): number {
  const c = getCity(cityId)
  return c.pop + c.biz
}

// One-off fee to join the waiting list for SLOTS_PER_GRANT slots. Refunded in
// full if the pool fills before the request is reached.
export function slotFee(cityId: string): number {
  return SLOT_FEE_PER_POINT * cityPoints(cityId)
}

// Quarterly rent per slot held. This is the reason not to hold slots you have
// no aircraft for: capacity at a great airport is expensive to sit on.
export function slotRent(cityId: string): number {
  return SLOT_RENT_PER_POINT * cityPoints(cityId)
}

// Every quarter, every slot away from home: the airline's capacity bill. The
// HOME BASE is exempt — those gates come with the airline, and charging for
// them would tax simply existing rather than taxing sprawl.
export function slotRentTotal(airline: Airline): number {
  let total = 0
  for (const city of Object.keys(airline.slots).sort()) {
    if (city === airline.hq) continue
    const held = airline.slots[city] ?? 0
    if (held > 0) total += held * slotRent(city)
  }
  return total
}

// The part of the rent buying nothing: capacity held with no route flying it.
// This is the number that used to be a silent confiscation.
export function idleSlotRent(airline: Airline): number {
  let total = 0
  for (const city of Object.keys(airline.slots).sort()) {
    if (city === airline.hq) continue
    const free = slotsFree(airline, city)
    if (free > 0) total += free * slotRent(city)
  }
  return total
}

// --- Expansion programs ---------------------------------------------------
//
// Every airport runs a building programme on a fixed cadence with a per-city
// phase, so the world's expansions are spread across the calendar instead of
// all landing at once. Derived from a stateless hash of (seed, city) — no RNG
// stream — which is what lets the UI ask about expansions arbitrarily far
// ahead. The schedule is public: that is the whole point of it existing.

const PROGRAM_NAMES = [
  'a second runway',
  'a new terminal',
  'a satellite concourse',
  'a rebuilt apron',
  'a night-movements waiver',
  'a remote stand field',
]

function phaseFor(seed: string, cityId: string): number {
  return fnv1a(`${seed}|expand|${cityId}`) % EXPANSION_EVERY_QUARTERS
}

// How many slots the nth completed programme adds. Bigger cities build bigger.
export function expansionSize(cityId: string): number {
  return EXPANSION_SIZE_BASE + Math.floor(cityPoints(cityId) / EXPANSION_SIZE_PER_POINT)
}

// Programmes finished on or before `turn` (programme n completes at
// phase + n * cadence, n >= 1).
export function expansionsBy(seed: string, cityId: string, turn: number): number {
  const phase = phaseFor(seed, cityId)
  if (turn < phase + EXPANSION_EVERY_QUARTERS) return 0
  return Math.floor((turn - phase) / EXPANSION_EVERY_QUARTERS)
}

// The city's pool as it stands this quarter: authored capacity plus every
// programme delivered so far. Nothing reads `city.slotPool` directly.
export function cityPool(state: GameState, cityId: string): number {
  return getCity(cityId).slotPool + expansionsBy(state.seed, cityId, state.turn) * expansionSize(cityId)
}

export interface Expansion {
  turn: number // the quarter it opens
  slots: number
  name: string
  quartersAway: number
}

// The next programme due at this city — the schedule the airports board
// publishes. Always defined: authorities never stop building.
export function nextExpansion(state: GameState, cityId: string): Expansion {
  const done = expansionsBy(state.seed, cityId, state.turn)
  const n = done + 1
  const turn = phaseFor(state.seed, cityId) + n * EXPANSION_EVERY_QUARTERS
  return {
    turn,
    slots: expansionSize(cityId),
    name: PROGRAM_NAMES[fnv1a(`${state.seed}|program|${cityId}|${n}`) % PROGRAM_NAMES.length]!,
    quartersAway: turn - state.turn,
  }
}

// Programmes opening as the quarter rolls over. Every city builds, but only
// the ones the player is invested in — holds slots at, or is queued at — earn
// a line in the report; the airports board carries the rest of the calendar.
export function expansionEvents(state: GameState, nextTurn: number): GameEvent[] {
  const player = state.airlines[0]
  if (!player) return []
  const watched = new Set<string>([
    ...Object.keys(player.slots),
    ...player.slotRequests.map((r) => r.city),
  ])
  const events: GameEvent[] = []
  for (const cityId of [...watched].sort()) {
    if (expansionsBy(state.seed, cityId, nextTurn) <= expansionsBy(state.seed, cityId, state.turn)) continue
    events.push({ type: 'airport_expanded', city: cityId, slots: expansionSize(cityId) })
  }
  return events
}

// --- The waiting list -----------------------------------------------------

export interface QueueEntry {
  airline: number
  city: string
  fee: number
  queuedTurn: number
}

// Every outstanding request, in the order the authorities will serve them:
// earliest request first, ties to the lower airline id. Deterministic, and
// the exact order the city panel shows the player.
export function slotQueue(state: GameState, cityId?: string): QueueEntry[] {
  const entries: QueueEntry[] = []
  for (const airline of state.airlines) {
    if (airline.bankrupt) continue
    for (const req of airline.slotRequests) {
      if (cityId !== undefined && req.city !== cityId) continue
      entries.push({ airline: airline.id, city: req.city, fee: req.fee, queuedTurn: req.queuedTurn })
    }
  }
  entries.sort((a, b) => a.queuedTurn - b.queuedTurn || a.airline - b.airline || (a.city < b.city ? -1 : 1))
  return entries
}

// Capacity left at a city right now, ignoring the queue.
export function slotsRemaining(state: GameState, cityId: string): number {
  return Math.max(0, cityPool(state, cityId) - slotsAllocated(state, cityId))
}

// What the player is really asking when they look at a queue: will MY request
// still find capacity when it is reached? Counts the grants promised to
// everyone ahead of the given position.
export function queueOutlook(
  state: GameState,
  cityId: string,
  airlineIdx: number,
): { position: number; ahead: number; willFit: boolean } | null {
  const queue = slotQueue(state, cityId)
  const position = queue.findIndex((q) => q.airline === airlineIdx)
  if (position < 0) return null
  return {
    position: position + 1,
    ahead: position,
    willFit: slotsRemaining(state, cityId) >= (position + 1) * SLOTS_PER_GRANT,
  }
}

// Mutates state (callers clone at the entry point). A request waits a full
// quarter before it is considered — commit now, fly next quarter — and then
// holds its place until capacity actually exists. Nobody is ever thrown off
// the list: being behind costs TIME, and the expansion calendar says exactly
// how much. Cancelling (and reclaiming the fee) is the player's way out.
export function resolveSlotRequests(state: GameState, events: GameEvent[]): void {
  for (const entry of slotQueue(state)) {
    if (entry.queuedTurn >= state.turn) continue // still in its waiting quarter
    if (slotsRemaining(state, entry.city) <= 0) continue // wait for the builders
    const airline = state.airlines[entry.airline]!
    const idx = airline.slotRequests.findIndex((r) => r.city === entry.city)
    if (idx < 0) continue
    airline.slotRequests.splice(idx, 1)
    const granted = Math.min(SLOTS_PER_GRANT, slotsRemaining(state, entry.city))
    airline.slots[entry.city] = (airline.slots[entry.city] ?? 0) + granted
    events.push({
      type: 'slots_granted',
      airline: airline.id,
      city: entry.city,
      slots: granted,
      waited: state.turn - entry.queuedTurn,
    })
  }
}
