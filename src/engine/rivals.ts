// Rival airline AI. Lives in the engine because rivals are part of the sim:
// their decisions must be deterministic and derived only from state + the
// rivals RNG stream. They act through the exact same command validator as the
// player (PLAN.md §3.3 step 1), and they run the exact same strategy brain as
// the reference bot (policy.ts) — personalities are dials, not forks.

import { applyPlanningCommand } from './commands'
import {
  assignmentCommands,
  hedgeCommands,
  launchCommands,
  marketingCommands,
  slotReleaseCommands,
  slotRequestCommands,
  slotTarget,
  orderCommands,
  pruneCommands,
  refitCommands,
  renewalCommands,
  scheduleCommands,
  surplusCommands,
  takeoverCommands,
  treasuryCommands,
  yieldCommands,
  type PolicyDials,
} from './policy'
import { chanceBp } from './rng'
import type { Command, GameEvent, GameState } from './types'

// Re-exported for tests and callers that treat rivals.ts as the AI surface.
export { expansionScore } from './policy'

function apply(state: GameState, idx: number, cmd: Command, events: GameEvent[]): void {
  events.push(...applyPlanningCommand(state, idx, cmd).events)
}

function applyAll(state: GameState, idx: number, cmds: Command[], events: GameEvent[]): void {
  for (const cmd of cmds) apply(state, idx, cmd, events)
}

// Rival archetypes (PLAN.md M3): the same policy brain, different dials.
// price_war floods cheap seats, premium sells service at a markup, fortress
// builds a dense home-region web before venturing out.
interface Personality extends PolicyDials {
  orderChanceBp: number // per-quarter appetite for a new airframe
  cabin: number // preferred cabin fit for the fleet (1 dense / 2 std / 3 prem)
}

const PERSONALITIES: Record<string, Personality> = {
  balanced: {
    orderChanceBp: 7000,
    fareLevel: 0,
    serviceLevel: 2,
    fareFloor: -1,
    expandMinDemand: 300,
    slotBudgetBp: 10000,
    homeRegionUntil: 0,
    cabin: 2,
    marketing: 1,
    contestDiscountBp: 10000,
    raidBonus: 8,
  },
  price_war: {
    orderChanceBp: 8000,
    fareLevel: -1,
    serviceLevel: 1,
    fareFloor: -2,
    expandMinDemand: 200,
    slotBudgetBp: 9000,
    homeRegionUntil: 0,
    cabin: 1,
    marketing: 0,
    contestDiscountBp: 6000,
    raidBonus: 14,
  },
  premium: {
    orderChanceBp: 6000,
    fareLevel: 1,
    serviceLevel: 3,
    fareFloor: 0,
    expandMinDemand: 300,
    slotBudgetBp: 11000,
    homeRegionUntil: 0,
    cabin: 3,
    marketing: 2,
    contestDiscountBp: 13000,
    raidBonus: 4,
  },
  fortress: {
    orderChanceBp: 7000,
    fareLevel: 0,
    serviceLevel: 2,
    fareFloor: -1,
    expandMinDemand: 250,
    slotBudgetBp: 7000,
    // Airlines start holding 4 slot cities, so the old threshold of 6
    // expired after two negotiations — a fortress in name only. Ten keeps it
    // weaving its home web deep into the mid-game.
    homeRegionUntil: 10,
    cabin: 2,
    marketing: 1,
    contestDiscountBp: 11000,
    raidBonus: 0,
  },
}

// One rival's planning turn: the shared policy stages in a fixed order, each
// applied before the next is computed so later stages see fresh state.
// Rival-specific texture on top: cabin doctrine refits, RNG-paced ordering,
// and rescue-only consolidation (the player's 4x-size clause snowballs when
// an AI holds it).
export function runRivalTurn(state: GameState, idx: number, events: GameEvent[]): void {
  const airline = state.airlines[idx]
  if (!airline || airline.bankrupt) return
  const personality = PERSONALITIES[airline.personality] ?? PERSONALITIES['balanced']!

  applyAll(state, idx, treasuryCommands(state, idx), events)
  applyAll(state, idx, marketingCommands(state, idx, personality.marketing), events)
  applyAll(state, idx, takeoverCommands(state, idx, true), events)
  applyAll(state, idx, pruneCommands(state, idx), events)
  applyAll(state, idx, hedgeCommands(state, idx), events)
  applyAll(state, idx, yieldCommands(state, idx, personality.fareFloor), events)
  applyAll(state, idx, renewalCommands(state, idx), events)
  applyAll(state, idx, scheduleCommands(state, idx), events)
  applyAll(state, idx, refitCommands(state, idx, personality.cabin), events)
  applyAll(state, idx, assignmentCommands(state, idx), events)

  // Open the best reachable pair if an idle airframe can fly it.
  const idle = airline.fleet.some((a) => a.routeId === null)
  if (idle) {
    applyAll(state, idx, launchCommands(state, idx, personality).commands, events)
  }

  applyAll(state, idx, surplusCommands(state, idx), events)
  applyAll(state, idx, distressSale(state, idx), events)

  // Buy at most one aircraft per quarter; a seeded coin flip paces rivals
  // differently across seeds.
  const flip = chanceBp(state.rng.rivals, personality.orderChanceBp)
  state.rng.rivals = flip.rng
  if (flip.value) {
    applyAll(state, idx, orderCommands(state, idx), events)
  }

  // Slot campaigns run on a declared clock. A rival joins the waiting list at
  // the authority it named LAST quarter — which the player saw on the map and
  // in the city panel during planning, and could have queued at first — then
  // names the authority it will court next. The queue is public and served in
  // order, so being early is the whole game.
  applyAll(state, idx, slotReleaseCommands(state, idx), events)
  const announced = airline.slotInterest ?? null
  applyAll(state, idx, slotRequestCommands(state, idx, personality, announced), events)
  // A campaign runs until it lands. Re-picking the richest target every
  // quarter looks smarter and is much worse: the authority you queued at last
  // quarter is abandoned the moment a marginally better one appears, and the
  // place in line — the only thing that matters — is thrown away. Only when
  // the announced city is held does the next campaign begin.
  const settled = announced === null || (airline.slots[announced] ?? 0) > 0
  if (settled) {
    const next = slotTarget(state, idx, personality)
    if (next === null) delete airline.slotInterest
    else airline.slotInterest = next
    applyAll(state, idx, slotRequestCommands(state, idx, personality, next), events)
  }
}

// Distress sale, rival-flavored: keep at least a two-frame core but shed the
// oldest metal when under water (the sale-and-shrink every real carrier
// reaches for before the receivers do).
function distressSale(state: GameState, idx: number): Command[] {
  const airline = state.airlines[idx]!
  if (airline.cash >= 0 || airline.fleet.length <= 2) return []
  const byAge = airline.fleet
    .filter((a) => !a.leased)
    .sort((a, b) => b.ageQuarters - a.ageQuarters || a.id - b.id)
    .slice(0, Math.min(2, airline.fleet.length - 2))
  return byAge.map((ac) => ({ type: 'sell_aircraft' as const, aircraftId: ac.id }))
}

