import { enableOperations, modernOperations, resolveOperations } from './operations'
import { recurringFinancials } from './accounting'
// Quarter resolution — the fixed order documented in PLAN.md §3.3. Every cash
// movement in this file flows through the quarterly P&L so the accounting test
// can reconcile reported profit against the actual cash delta.

import { AIRCRAFT, getAircraftType, typesOnSale } from '../data/aircraft'
import { CITIES, distanceKm } from '../data/cities'
import {
  INSOLVENCY_QUARTERS_TO_FAIL,
  USED_MARGIN_BP,
  USED_OFFERS_PER_QUARTER,
  LOAN_AMORT_BP,
  GROUNDING_AGE_QUARTERS,
  GROUNDING_BP_PER_QUARTER_OVER,
  GROUNDING_MAX_BP,
  GROUNDING_QUARTERS,
  GROUNDING_REPAIR_BP,
  MILESTONE_PCTS,
  MILESTONE_PCTS_RATE,
  REPUTATION_HIT_PER_GROUNDING,
  REPUTATION_MIN_BP,
  REPUTATION_RECOVERY_BP,
  ENTRANT_EVERY_QUARTERS,
  RESTRUCTURE_CASH_K,
  RESTRUCTURE_KEEP_FLEET,
  RESTRUCTURE_KEEP_ROUTES,
  RESTRUCTURE_MAX} from '../data/constants'
import { fnv1a, nextInt } from './rng'
import { getScenario } from '../data/scenarios'
import { inflationBp, resolveMarket } from './market'
import { resaleValue, totalDebt } from './queries'
import { expansionEvents, resolveSlotRequests, slotsRemaining } from './slots'
import { isGrounded, netWorth, objectiveQualified, objectiveBeats, objectiveMet, objectiveScore, objectiveScoreAt, yearOf } from './queries'
import { expireOffersAndDeals, maybeOfferDeal } from './offers'
import { deriveFootholds } from './newGame'
import { runRivalTurn } from './rivals'
import type { Airline, EngineResult, GameEvent, GameState, OwnedAircraft } from './types'
import { updateWorld } from './worldEvents'

// This quarter's used-market offers: recently produced types, mid-life ages,
// priced at resale plus a dealer margin. Stateless hashes keep it deterministic.
function rollUsedMarket(state: GameState): GameState['world']['usedMarket'] {
  const year = yearOf(state)
  const candidates = AIRCRAFT.filter((a) => year >= a.availableFrom && year <= a.availableTo + 10)
  if (candidates.length === 0) return []
  const offers = []
  for (let i = 0; i < USED_OFFERS_PER_QUARTER; i++) {
    const h = fnv1a(`${state.seed}|used|${state.turn}|${i}`)
    const type = candidates[h % candidates.length]!
    const ageQuarters = 16 + ((h >>> 8) % 32)
    const price = Math.floor((resaleValue(type.id, ageQuarters) * (10000 + USED_MARGIN_BP)) / 10000)
    offers.push({ id: state.turn * 100 + i, type: type.id, ageQuarters, price })
  }
  return offers
}

function liquidate(airline: Airline): void {
  airline.bankrupt = true
  airline.routes = []
  airline.fleet = []
  airline.orders = []
  airline.slotRequests = []
  delete airline.slotInterest
  airline.loans = []
  airline.slots = {}
  airline.cash = 0
}

// Chapter 11, not the graveyard: creditors eat the debt, the fleet and
// network shrink to a survivable core, and fresh capital arrives. The
// airline keeps its slots and its seat in the race — weakened, not deleted.
function restructure(airline: Airline, turn: number): GameEvent {
  // Creditors take a haircut — half the principal, not a free clean slate.
  // A rival that fails must come back weaker than the airlines that never
  // did, or failure becomes the cheapest way to finance an airline.
  const debtBefore = totalDebt(airline)
  for (const loan of airline.loans) loan.principal = Math.floor(loan.principal / 2)
  airline.loans = airline.loans.filter((l) => l.principal > 0)
  const debtWiped = debtBefore - totalDebt(airline)
  airline.orders = []
  airline.slotRequests = []
  delete airline.slotInterest
  // Keep the best routes by last quarter's profit; the rest close.
  const ranked = [...airline.routes].sort(
    (a, b) => b.lastRevenue - b.lastCost - (a.lastRevenue - a.lastCost) || a.id - b.id,
  )
  const keptRoutes = ranked.slice(0, RESTRUCTURE_KEEP_ROUTES)
  const keptRouteIds = new Set(keptRoutes.map((r) => r.id))
  const routesClosed = airline.routes.length - keptRoutes.length
  // Keep the youngest metal, and only what the surviving network can fly.
  const keptFleet = [...airline.fleet]
    .sort((a, b) => a.ageQuarters - b.ageQuarters || a.id - b.id)
    .slice(0, RESTRUCTURE_KEEP_FLEET)
  const fleetSold = airline.fleet.length - keptFleet.length
  for (const ac of keptFleet) {
    if (ac.routeId !== null && !keptRouteIds.has(ac.routeId)) ac.routeId = null
    if (ac.secondaryRouteId !== undefined && (!keptRouteIds.has(ac.secondaryRouteId) || ac.routeId === null)) delete ac.secondaryRouteId
  }
  airline.routes = airline.routes.filter((r) => keptRouteIds.has(r.id))
  airline.fleet = keptFleet
  airline.cash = Math.max(airline.cash, Math.floor((RESTRUCTURE_CASH_K * inflationBp(turn)) / 10000))
  airline.insolventQuarters = 0
  airline.restructures = (airline.restructures ?? 0) + 1
  airline.fuelHedge = null
  return { type: 'airline_restructured', airline: airline.id, routesClosed, fleetSold, debtWiped }
}

// Clamp a starting endowment to the capacity actually free at each airport.
function grantWithinPools(state: GameState, wanted: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const city of Object.keys(wanted).sort()) {
    const n = Math.min(wanted[city]!, slotsRemaining(state, city))
    if (n > 0) out[city] = n
  }
  return out
}

// A late entrant takes an empty seat: era-appropriate capital and metal, a
// home the incumbents have not claimed, and a personality drawn from the
// rivals stream. Ids equal the index, so entrants append.
function admitEntrant(state: GameState, events: GameEvent[]): void {
  const scenario = getScenario(state.scenario)
  const taken = new Set(state.airlines.filter((a) => !a.bankrupt).map((a) => a.hq))
  const home = [...CITIES]
    .filter((c) => !taken.has(c.id) && c.slotPool >= 10 && slotsRemaining(state, c.id) >= 6)
    .sort((a, b) => b.pop * 4 + b.biz * 3 + b.tour * 2 - (a.pop * 4 + a.biz * 3 + a.tour * 2) || (a.id < b.id ? -1 : 1))
  if (home.length === 0) return
  const pick = nextInt(state.rng.rivals, 0, Math.min(5, home.length - 1))
  state.rng.rivals = pick.rng
  const hq = home[pick.value]!.id
  const personalities = ['price_war', 'balanced', 'premium', 'fortress'] as const
  const pdraw = nextInt(state.rng.rivals, 0, personalities.length - 1)
  state.rng.rivals = pdraw.rng
  const ndraw = nextInt(state.rng.rivals, 0, ENTRANT_NAMES.length - 1)
  state.rng.rivals = ndraw.rng
  const used = new Set(state.airlines.map((a) => a.name))
  let name = ENTRANT_NAMES[ndraw.value]!
  for (let i = 0; used.has(name) && i < ENTRANT_NAMES.length; i++) {
    name = ENTRANT_NAMES[(ndraw.value + i + 1) % ENTRANT_NAMES.length]!
  }
  // Era-appropriate metal: the smallest type on sale that can still work.
  const onSale = typesOnSale(yearOf(state))
  if (onSale.length === 0) return
  let metal = onSale[0]!
  for (const t of onSale) if (t.seats < metal.seats) metal = t
  // Reuse a liquidated seat when one exists — the field stays the size the
  // scenario intended instead of accumulating corpses (and the rivals panel,
  // the race chart, and the state hash stay bounded).
  const deadSeat = state.airlines.findIndex((a) => a.controller === 'rival' && a.bankrupt)
  const id = deadSeat >= 0 ? deadSeat : state.airlines.length
  const airline: Airline = {
    id,
    name,
    controller: 'rival',
    personality: personalities[pdraw.value]!,
    hq,
    // Fresh capital, scaled to the era's opening stake.
    cash: Math.floor((scenario.player.cash * 12) / 10),
    loans: [],
    fleet: [],
    orders: [],
    routes: [],
    // The regulator grants a home and a few footholds — but only capacity
    // that exists. An entrant handed slots the airport does not have would
    // put every pool display over 100% and quietly break the queue's promise.
    slots: grantWithinPools(state, { [hq]: 8, ...deriveFootholds(hq) }),
    slotRequests: [],
    servedUntil: {},
    fuelHedge: null,
    marketing: 0,
    insolventQuarters: 0,
    bankrupt: false,
    history: [],
    nextId: 1,
    enteredTurn: state.turn,
  }
  for (let i = 0; i < 2; i++) {
    airline.fleet.push({ id: airline.nextId++, type: metal.id, ageQuarters: 0, routeId: null, leased: false, cabin: 2 })
  }
  if (deadSeat >= 0) state.airlines[deadSeat] = airline
  else state.airlines.push(airline)
  events.push({ type: 'airline_entered', airline: id, name, hq })
}

// Startup names for late entrants, drawn deterministically.
const ENTRANT_NAMES: readonly string[] = [
  'Skyward',
  'Vector Air',
  'Northwind',
  'Solstice Airways',
  'Meridian Blue',
  'Cardinal Air',
  'Halcyon',
  'Compass Airlines',
  'Zephyr Jet',
  'Aurora Lines',
]

export function endQuarter(prev: GameState): EngineResult {
  if (prev.phase !== 'planning') return { state: prev, events: [] }
  const state = structuredClone(prev)
  const events: GameEvent[] = []

  // 1. Rival AI turns, ascending index, through the same command validator.
  for (const airline of state.airlines) {
    if (airline.controller === 'rival') runRivalTurn(state, airline.id, events)
  }

  // 2. Aircraft deliveries.
  for (const airline of state.airlines) {
    const remaining = []
    for (const order of airline.orders) {
      order.quartersLeft--
      if (order.quartersLeft > 0) {
        remaining.push(order)
      } else {
        const aircraft: OwnedAircraft = {
          id: airline.nextId++,
          type: order.type,
          ageQuarters: 0,
          routeId: null,
          leased: order.leased,
          cabin: 2,
        }
        if (order.replacesAircraftId !== undefined) {
          const old = airline.fleet.find((a) => a.id === order.replacesAircraftId)
          if (old) {
            // Deliver first, then retire; the old aircraft stays in service
            // throughout the waiting period. If its routes changed beyond
            // the new type's range, delivery is safely parked for reassignment.
            const routes = airline.routes.filter((r) => r.id === old.routeId || r.id === old.secondaryRouteId)
            if (routes.every((r) => distanceKm(r.from, r.to) <= getAircraftType(aircraft.type).rangeKm)) {
              aircraft.routeId = old.routeId
              if (old.secondaryRouteId !== undefined) aircraft.secondaryRouteId = old.secondaryRouteId
              if (old.reserve) aircraft.reserve = true
              const proceeds = old.leased ? 0 : resaleValue(old.type, old.ageQuarters)
              airline.cash += proceeds
              airline.fleet = airline.fleet.filter((a) => a.id !== old.id)
              events.push({ type: 'aircraft_sold', airline: airline.id, aircraftId: old.id, proceeds })
            }
          }
        }
        airline.fleet.push(aircraft)
        events.push({
          type: 'aircraft_delivered',
          airline: airline.id,
          aircraftId: aircraft.id,
          aircraftType: aircraft.type,
        })
      }
    }
    airline.orders = remaining
  }

  // 3. The airport waiting lists: places queued at least a quarter ago are
  // served in order while capacity lasts (engine/slots.ts).
  resolveSlotRequests(state, events)

  // 4. World economy and events, plus this quarter's used-aircraft market
  // (stateless hash picks — deterministic, order-independent).
  events.push(...updateWorld(state))
  state.world.usedMarket = rollUsedMarket(state)

  // 5. Route economics.
  if (modernOperations(state)) enableOperations(state)
  const operations = new Map(state.airlines.filter(a => a.operationsPolicy && !a.bankrupt).map(a => [a.id, resolveOperations(state, a, 'actual')]))
  const totals = resolveMarket(state, events, operations)

  // 6. Financials. Every cost lands in a named breakdown bucket; the total
  // is the sum of the buckets, never a separate number.
  const ZERO_BREAKDOWN = {
    fuel: 0,
    fees: 0,
    flightPay: 0,
    service: 0,
    salaries: 0,
    ownership: 0,
    maintenance: 0,
    admin: 0,
    slots: 0,
    overhead: 0,
    marketing: 0,
    interest: 0,
  }
  for (const airline of state.airlines) {
    if (airline.bankrupt) {
      airline.history.push({
        turn: state.turn,
        cash: 0,
        revenue: 0,
        costs: 0,
        profit: 0,
        pax: 0,
        netWorth: 0,
        breakdown: { ...ZERO_BREAKDOWN },
      })
      continue
    }
    const t = totals[airline.id]!
    const { revenue, costs, profit, debtPayment, breakdown } = recurringFinancials(state, airline, t)
    for (const loan of airline.loans) {
      loan.principal -= Math.min(loan.principal, Math.max(100, Math.floor((loan.principal * LOAN_AMORT_BP) / 10000)))
    }
    airline.loans = airline.loans.filter((loan) => loan.principal > 0)
    airline.cash += profit - debtPayment

    // 7. Aging, reliability, hedge runoff, solvency, stats.
    for (const ac of airline.fleet) ac.ageQuarters++
    // Old metal breaks. Risk climbs with every quarter past the threshold, is
    // capped per airframe, and uses stateless per-entity hashing (PLAN §3.2)
    // rather than a stream draw. A grounded airframe still draws salaries and
    // ownership — that is the whole point of deferring renewal being a gamble.
    for (const ac of airline.fleet) {
      if (airline.operationsPolicy || isGrounded(ac, state.turn)) continue
      const over = ac.ageQuarters - GROUNDING_AGE_QUARTERS
      if (over <= 0) continue
      const baseRisk = Math.min(GROUNDING_MAX_BP, over * GROUNDING_BP_PER_QUARTER_OVER)
      const riskBp = (state.rulesVersion ?? 1) >= 2 && (ac.maintainedUntil ?? 0) > state.turn ? Math.floor(baseRisk / 4) : baseRisk
      // A clean uniform 0..9999 per (seed, turn, airframe): hashNoiseBp is
      // centered on 10000 and would not give an honest probability here.
      const roll = fnv1a(`${state.seed}|${state.turn}|ground:${airline.id}:${ac.id}`) % 10000
      if (roll >= riskBp) continue
      const repairK = Math.floor((getAircraftType(ac.type).price * GROUNDING_REPAIR_BP) / 10000)
      ac.groundedUntil = state.turn + 1 + GROUNDING_QUARTERS
      airline.cash -= repairK
      airline.reputationBp = Math.max(
        REPUTATION_MIN_BP,
        (airline.reputationBp ?? 10000) - REPUTATION_HIT_PER_GROUNDING,
      )
      events.push({
        type: 'aircraft_grounded',
        airline: airline.id,
        aircraftId: ac.id,
        aircraftType: ac.type,
        quarters: GROUNDING_QUARTERS,
        repairK,
      })
    }
    const resolved = operations.get(airline.id)
    if (resolved) {
      for (const ac of airline.fleet) ac.operations = resolved.aircraft.get(ac.id)!
      if (resolved.summary.affectedPassengers > 0) {
        const penalty = Math.min(1500, Math.floor(resolved.summary.affectedPassengers * 10000 / Math.max(1, t.pax + resolved.summary.affectedPassengers)))
        airline.reputationBp = Math.max(REPUTATION_MIN_BP, (airline.reputationBp ?? 10000) - penalty)
      }
      events.push({ type: 'operations_report', airline: airline.id, summary: resolved.summary })
    }
    // Reputation heals slowly toward spotless.
    airline.reputationBp = Math.min(10000, (airline.reputationBp ?? 10000) + REPUTATION_RECOVERY_BP)
    if (airline.fuelHedge !== null) {
      airline.fuelHedge.quartersLeft--
      if (airline.fuelHedge.quartersLeft <= 0) airline.fuelHedge = null
    }
    if (airline.cash < 0) airline.insolventQuarters++
    else airline.insolventQuarters = 0

    airline.history.push({
      turn: state.turn,
      cash: airline.cash,
      revenue,
      costs,
      profit,
      debtPayment,
      pax: t.pax,
      transferPax: t.transferPax,
      capacity: t.capacity,
      netWorth: netWorth(airline),
      breakdown,
      ...(t.operations ? { operations: t.operations } : {}),
    })

    events.push({
      type: 'quarter_report',
      airline: airline.id,
      turn: state.turn,
      revenue,
      costs,
      profit,
      debtPayment,
      cash: airline.cash,
      netWorth: netWorth(airline),
      pax: t.pax,
      breakdown,
    })

    if (airline.insolventQuarters >= INSOLVENCY_QUARTERS_TO_FAIL) {
      if (airline.controller === 'rival' && (airline.restructures ?? 0) < RESTRUCTURE_MAX) {
        // A rival gets its chapter-11 rounds before the receivers arrive.
        events.push(restructure(airline, state.turn))
      } else {
        events.push({ type: 'airline_bankrupt', airline: airline.id })
        if (airline.controller === 'rival') liquidate(airline)
        else if ((state.rulesVersion ?? 1) >= 2) airline.bankrupt = true
      }
    }
  }

  // 9. Milestones on the era's objective: the back half needs a ladder to
  // climb, not just a deadline to wait for.
  for (const p0 of ((state.rulesVersion ?? 1) >= 2 ? state.airlines.filter((a) => a.controller === 'player') : [state.airlines[0]!])) {
    const obj = getScenario(state.scenario).objective
    if (!p0.bankrupt && obj.higherIsBetter) {
      const score = objectiveScore(p0, obj.kind)
      const prevScore = p0.history.length >= 2 ? objectiveScoreAt(p0, obj.kind, p0.history.length - 1) : 0
      const ladder = obj.unit === 'rate' ? MILESTONE_PCTS_RATE : MILESTONE_PCTS
      for (const pct of ladder) {
        const bar = Math.floor((obj.target * pct) / 100)
        if (prevScore < bar && score >= bar) {
          events.push({ type: 'milestone_reached', airline: p0.id, label: obj.label, pctOfTarget: pct })
        }
      }
    }
  }

  // 10. The world asks a question: at most one open offer at a time, and
  // anything unanswered lapses.
  expireOffersAndDeals(state, events)
  maybeOfferDeal(state, events)

  // 11. New entrants: an empty seat draws fresh capital on a fixed cadence, so
  // the map never becomes a one-airline world. Capped at the scenario's
  // intended field size.
  const liveRivals = state.airlines.filter((a) => a.controller === 'rival' && !a.bankrupt).length
  if (
    liveRivals < getScenario(state.scenario).rivals.length &&
    state.turn > 0 &&
    state.turn % ENTRANT_EVERY_QUARTERS === 0
  ) {
    admitEntrant(state, events)
  }

  // Victory / defeat, then advance the clock. The scenario is a race over a
  // fixed window (PLAN.md §2.4): bankruptcy loses at any time, but victory is
  // only scored when the final quarter resolves — finish #1 in net worth
  // among the airlines AND clear the scenario's qualifying target.
  const scenario = getScenario(state.scenario)
  const player = state.airlines[0]!
  const humans = state.airlines.filter((a) => a.controller === 'player')
  if ((state.rulesVersion ?? 1) >= 2 && humans.length > 1) {
    if (humans.every((a) => a.bankrupt) || state.turn + 1 >= scenario.quarters) {
      const ranked = state.airlines.filter((a) => !a.bankrupt && objectiveQualified(state, a))
        .sort((a, b) => objectiveScore(b, scenario.objective.kind) - objectiveScore(a, scenario.objective.kind))
      const winner = ranked[0]
      if (winner && objectiveMet(objectiveScore(winner, scenario.objective.kind), scenario.objective.target, scenario.objective.higherIsBetter)) state.winnerSeat = winner.id
      state.phase = winner?.controller === 'player' && state.winnerSeat !== undefined ? 'won' : 'lost'
      events.push({ type: 'game_over', result: state.phase, reason: state.winnerSeat === undefined ? 'No airline qualified' : `${winner!.name} wins on ${scenario.objective.label}` })
    }
  } else if (player.insolventQuarters >= INSOLVENCY_QUARTERS_TO_FAIL) {
    state.phase = 'lost'
    events.push({ type: 'game_over', result: 'lost', reason: 'bankruptcy' })
  } else if (state.turn + 1 >= scenario.quarters) {
    // Scored on the ERA's own measure, not always net worth (PLAN §2.4):
    // finish #1 among the live airlines AND clear the qualifying bar.
    const obj = scenario.objective
    const myScore = objectiveScore(player, obj.kind)
    let bestRival: Airline | null = null
    let bestRivalScore = 0
    for (const rival of state.airlines) {
      if (rival.id === 0 || rival.bankrupt || !objectiveQualified(state, rival)) continue
      const score = objectiveScore(rival, obj.kind)
      if (bestRival === null || objectiveBeats(score, bestRivalScore, obj.higherIsBetter)) {
        bestRival = rival
        bestRivalScore = score
      }
    }
    if (!objectiveMet(myScore, obj.target, obj.higherIsBetter) || !objectiveQualified(state, player)) {
      state.phase = 'lost'
      events.push({
        type: 'game_over',
        result: 'lost',
        reason: `missed the ${obj.label} target${(state.rulesVersion ?? 1) >= 2 ? ' or required operating scale' : ''}`,
      })
    } else if (bestRival !== null && !objectiveBeats(myScore, bestRivalScore, obj.higherIsBetter)) {
      state.phase = 'lost'
      events.push({ type: 'game_over', result: 'lost', reason: `outscored by ${bestRival.name} on ${obj.label}` })
    } else {
      state.phase = 'won'
      events.push({ type: 'game_over', result: 'won', reason: `finished #1 on ${obj.label}` })
    }
  }
  // Airport building programmes open as the calendar rolls. The schedule is
  // public and computable arbitrarily far ahead (slots.ts) — this only files
  // the report line for airports the player actually has a stake in.
  events.push(...expansionEvents(state, state.turn + 1))
  state.turn++

  return { state, events }
}
