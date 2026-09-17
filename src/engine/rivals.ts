import { chooseCampaign } from './campaigns'
// Rival airline AI. Lives in the engine because rivals are part of the sim:
// their decisions must be deterministic and derived only from state + the
// rivals RNG stream. They act through the exact same command validator as the
// player (PLAN.md §3.3 step 1), and they run the exact same strategy brain as
// the reference bot (policy.ts) — personalities are dials, not forks.

import { applyPlanningCommand } from './commands'
import {
  assignmentCommands,
  cashBufferFor,
  hedgeCommands,
  launchCommands,
  launchFrequency,
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
import { getAircraftType, typesOnSale } from '../data/aircraft'
import { distanceKm, pairKey } from '../data/cities'
import { PRICE_WAR_FARE_LEVEL } from '../data/constants'
import { slotsFree, yearOf } from './queries'
import type { Command, GameEvent, GameState, RivalCampaign } from './types'

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
  let personality = PERSONALITIES[airline.personality] ?? PERSONALITIES['balanced']!
  if ((state.rulesVersion ?? 1) >= 2) {
    const campaign = airline.campaign
    if (campaign && state.turn >= campaign.fromTurn && state.turn < campaign.untilTurn) {
      personality = { ...personality,
        marketing: campaign.kind === 'defend' ? Math.max(2, personality.marketing) : personality.marketing,
        fareFloor: campaign.kind === 'price' ? -2 : personality.fareFloor,
        serviceLevel: campaign.kind === 'premium' ? 3 : personality.serviceLevel,
        raidBonus: campaign.kind === 'expand' ? personality.raidBonus + 5 : personality.raidBonus,
      }
      const warFare = (state.rulesVersion ?? 1) >= 5 ? PRICE_WAR_FARE_LEVEL : -1
      for (const r of airline.routes.filter((r) => r.from === campaign.city || r.to === campaign.city)) {
        if (campaign.kind === 'price') apply(state, idx, { type: 'set_fare', routeId: r.id, fareLevel: warFare }, events)
        if (campaign.kind === 'premium') apply(state, idx, { type: 'set_service', routeId: r.id, serviceLevel: 3 }, events)
      }
    }
    if (!campaign || state.turn >= campaign.untilTurn) {
      const kind = airline.personality === 'price_war' ? 'price' : airline.personality === 'premium' ? 'premium' : airline.personality === 'fortress' ? 'defend' : 'expand'
      airline.campaign = (state.rulesVersion ?? 1) >= 4 ? chooseCampaign(state, idx) : { kind, city: airline.slotInterest ?? airline.hq, fromTurn: state.turn + 1, untilTurn: state.turn + 5 }
      events.push({ type: 'operations_changed', airline: idx, detail: `${airline.name} announces a four-quarter ${airline.campaign.kind} campaign at ${airline.campaign.city}, starting next quarter` })
    }
  }

  const active = (state.rulesVersion ?? 1) >= 4 && airline.campaign && state.turn >= airline.campaign.fromTurn && state.turn < airline.campaign.untilTurn ? airline.campaign : null
  const recovering = active?.kind === 'recover'
  if (recovering) personality = { ...personality, marketing: 0, orderChanceBp: 0 }

  if (airline.operationsPolicy) {
    const reserveBp = airline.personality === 'premium' || airline.personality === 'fortress' ? 1000 : 500
    const recovery = (airline.history.at(-1)?.operations?.cancelledTrips ?? 0) > 0 && airline.cash > cashBufferFor(airline) * 2
    if (reserveBp !== airline.operationsPolicy.reserveBp || recovery !== airline.operationsPolicy.recovery)
      apply(state, idx, { type: 'set_operations_policy', reserveBp, recovery }, events)
  }
  applyAll(state, idx, treasuryCommands(state, idx), events)
  applyAll(state, idx, marketingCommands(state, idx, personality.marketing), events)
  applyAll(state, idx, takeoverCommands(state, idx, true), events)
  applyAll(state, idx, pruneCommands(state, idx), events)
  applyAll(state, idx, hedgeCommands(state, idx), events)
  applyAll(state, idx, yieldCommands(state, idx, personality.fareFloor), events)
  applyAll(state, idx, renewalCommands(state, idx), events)
  applyAll(state, idx, scheduleCommands(state, idx), events)
  applyAll(state, idx, refitCommands(state, idx, personality.cabin), events)
  const modernRace = (state.rulesVersion ?? 1) >= 5
  if (modernRace) {
    // Rules 5: expansion BEFORE assignment, like the reference bot. Under the
    // old order every arriving airframe was parked on the first route (its
    // demand gap was always the largest) and the launch stage never saw an
    // idle plane — a rival with four jets and one route for twelve quarters.
    if (active?.kind === 'raid') applyAll(state, idx, raidCommands(state, idx, personality, active), events)
    if (airline.fleet.some((a) => a.routeId === null) && !recovering) {
      applyAll(state, idx, launchCommands(state, idx, personality).commands, events)
    }
    applyAll(state, idx, assignmentCommands(state, idx), events)
  } else {
    applyAll(state, idx, assignmentCommands(state, idx), events)

    // Open the best reachable pair if an idle airframe can fly it.
    const idle = airline.fleet.some((a) => a.routeId === null)
    if (idle && !recovering) {
      applyAll(state, idx, launchCommands(state, idx, personality).commands, events)
    }
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
  // A raid redirects the slot campaign at the airport the target market
  // still needs — announced, like every other campaign, a quarter ahead.
  if (modernRace && active?.kind === 'raid' && active.pair && !recovering) {
    const [a, b] = active.pair.split('-') as [string, string]
    const missing = slotsFree(airline, a) < 1 && (airline.slots[a] ?? 0) === 0 ? a : slotsFree(airline, b) < 1 && (airline.slots[b] ?? 0) === 0 ? b : null
    if (missing !== null && airline.slotInterest !== missing) airline.slotInterest = missing
  }
  const announced = airline.slotInterest ?? null
  if (!recovering) applyAll(state, idx, slotRequestCommands(state, idx, personality, announced), events)
  // A campaign runs until it lands. Re-picking the richest target every
  // quarter looks smarter and is much worse: the authority you queued at last
  // quarter is abandoned the moment a marginally better one appears, and the
  // place in line — the only thing that matters — is thrown away. Only when
  // the announced city is held does the next campaign begin.
  const settled = announced === null || (airline.slots[announced] ?? 0) > 0
  if (settled && !recovering) {
    const next = slotTarget(state, idx, personality)
    if (next === null) delete airline.slotInterest
    else airline.slotInterest = next
    applyAll(state, idx, slotRequestCommands(state, idx, personality, next), events)
  }
  // Apply the announced product after generic yield management; otherwise
  // the policy immediately overwrites its own public commitment.
  if (active) for (const route of airline.routes) {
    if (route.from !== active.city && route.to !== active.city) continue
    if (active.kind === 'price') apply(state, idx, {type:'set_fare',routeId:route.id,fareLevel:modernRace ? PRICE_WAR_FARE_LEVEL : -1}, events)
    if (active.kind === 'premium') apply(state, idx, {type:'set_service',routeId:route.id,serviceLevel:3}, events)
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


// The raid itself (rules 5): once both airports are held, open the target
// pair with an idle airframe that can fly it — or order one sized for the
// market when the fleet is fully committed. Discount fares are the weapon;
// a premium carrier raids with its full-service product instead.
function raidCommands(state: GameState, idx: number, personality: Personality, campaign: RivalCampaign): Command[] {
  const airline = state.airlines[idx]!
  if (!campaign.pair) return []
  const [from, to] = campaign.pair.split('-') as [string, string]
  if (airline.routes.some((r) => pairKey(r.from, r.to) === campaign.pair)) return []
  if (slotsFree(airline, from) < 1 || slotsFree(airline, to) < 1) return []
  const km = distanceKm(from, to)
  const fareLevel = personality.fareLevel === 1 ? 0 : Math.max(-2, personality.fareLevel - 1)
  const launch = airline.fleet.find((ac) => ac.routeId === null && !(airline.operationsPolicy && ac.reserve) && getAircraftType(ac.type).rangeKm >= km)
  if (launch) {
    return [{ type: 'open_route', from, to, aircraftId: launch.id, frequency: launchFrequency(state, from, to, launch.type, airline.operationsPolicy?.reserveBp), fareLevel, serviceLevel: personality.serviceLevel }]
  }
  if (airline.orders.length > 0 || airline.cash < 0) return []
  const buffer = cashBufferFor(airline)
  const candidates = typesOnSale(yearOf(state)).filter((t) => t.rangeKm >= km && t.price + buffer <= airline.cash)
  if (candidates.length === 0) return []
  let pick = candidates[0]!
  for (const t of candidates) if (t.price < pick.price) pick = t
  return [{ type: 'order_aircraft', aircraftType: pick.id }]
}
