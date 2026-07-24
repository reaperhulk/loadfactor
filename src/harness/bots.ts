// Strategy bots: pure functions of GameState → the player's planning commands
// for this quarter. No RNG — a bot's whole career is determined by the seed's
// effect on the world. Bots drive golden tests, the balance envelope, and CI
// careers (PLAN.md §5.6). The competence itself lives in the engine's shared
// policy module — the same brain the rivals run — so "rivals are as smart as
// the reference bot" is a fact of the code, not an aspiration.

import {
  assignmentCommands as policyAssignment,
  distressCommands,
  hedgeCommands,
  launchCommands as policyLaunch,
  marketingCommands,
  negotiationCommands,
  orderCommands,
  pruneCommands,
  renewalCommands,
  scheduleCommands,
  takeoverCommands,
  treasuryCommands,
  yieldCommands,
  type PolicyDials,
} from '../engine/policy'
import type { Command, GameState } from '../engine/types'

export type BotName = 'naive' | 'greedy'

// Re-exports: the fuzzer and tests address these through the bot surface.
export { launchFrequency, pairScore, bestUnservedPair } from '../engine/policy'

// The greedy bot's dials: the balanced-operator reference point every rival
// personality deviates from.
export const GREEDY_DIALS: PolicyDials = {
  fareLevel: 0,
  serviceLevel: 2,
  fareFloor: -1,
  // 250 in seat-net units (the shared brain's scale) — the old 300 was in
  // pairScore units and translated into an expansion bar that starved thin
  // starts (the deregulation western box) of the route count they live on.
  expandMinDemand: 250,
  contestDiscountBp: 10000,
  negotiateBudgetBp: 10000,
  raidBonus: 0,
  homeRegionUntil: 0,
  marketing: 1,
}

// Player-seat wrappers (the bot always drives airline 0).
export function assignmentCommands(state: GameState, skip?: ReadonlySet<number>): Command[] {
  return policyAssignment(state, 0, skip)
}

export function launchCommands(
  state: GameState,
  minScore: number,
  fareLevel = 0,
  serviceLevel = 2,
  contestDiscountBp = 10000,
): { commands: Command[]; usedAircraft: number | null } {
  return policyLaunch(state, 0, {
    fareLevel,
    serviceLevel,
    expandMinDemand: minScore,
    contestDiscountBp,
  })
}

// Naive: opens whatever route it can and parks planes on it. Never orders,
// never negotiates, never borrows, never touches fares. The balance envelope
// expects this bot to survive early but lose the scenario.
function naiveCommands(state: GameState): Command[] {
  const launch = launchCommands(state, 0)
  const skip = launch.usedAircraft !== null ? new Set([launch.usedAircraft]) : undefined
  return [...launch.commands, ...assignmentCommands(state, skip)]
}

// Greedy: the shared policy stages, all computed against the same pre-apply
// snapshot (the harness applies them in order): stay solvent, hedge cheap
// fuel, discipline the schedule, shed distress, brand while liquid, prune
// losers, renew geriatric metal, buy the rival lever, expand, order, and
// negotiate for the next city.
function greedyCommands(state: GameState): Command[] {
  const commands: Command[] = []
  commands.push(...treasuryCommands(state, 0))
  commands.push(...hedgeCommands(state, 0))
  commands.push(...scheduleCommands(state, 0))
  commands.push(...distressCommands(state, 0))
  commands.push(...marketingCommands(state, 0, GREEDY_DIALS.marketing))
  const prune = pruneCommands(state, 0)
  commands.push(...prune)
  const renewal = renewalCommands(state, 0)
  commands.push(...renewal)
  // The player's takeover keeps the 4x-size clause — the human lever the
  // reference bot must exercise (rivals are rescue-only on purpose).
  commands.push(...takeoverCommands(state, 0, false))
  const launch = policyLaunch(state, 0, GREEDY_DIALS)
  commands.push(...launch.commands)
  commands.push(...orderCommands(state, 0, { renewedThisQuarter: renewal.length > 0 }))
  commands.push(...negotiationCommands(state, 0, GREEDY_DIALS))
  commands.push(...yieldCommands(state, 0, GREEDY_DIALS.fareFloor))
  const skip = launch.usedAircraft !== null ? new Set([launch.usedAircraft]) : undefined
  commands.push(...assignmentCommands(state, skip))
  return commands
}

export function botCommands(state: GameState, bot: BotName): Command[] {
  return bot === 'naive' ? naiveCommands(state) : greedyCommands(state)
}
