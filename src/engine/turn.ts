// Quarter resolution — the fixed order documented in PLAN.md §3.3. Every cash
// movement in this file flows through the quarterly P&L so the accounting test
// can reconcile reported profit against the actual cash delta.

import { AIRCRAFT, getAircraftType, typesOnSale } from '../data/aircraft'
import { CITIES } from '../data/cities'
import {
  AIRCRAFT_ADMIN_PER_QUARTER,
  AIRLINE_OVERHEAD_PER_QUARTER,
  CREW_SALARY_BP_PER_QUARTER,
  INSOLVENCY_QUARTERS_TO_FAIL,
  LEASE_BP_PER_QUARTER,
  MARKETING_BASE_PER_LEVEL,
  MARKETING_PER_ROUTE_PER_LEVEL,
  MAINT_AGE_BP_PER_QUARTER,
  OWNERSHIP_BP_PER_QUARTER,
  ROUTE_OVERHEAD_QUAD,
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
  DOMINANCE_PARITY_MULT_BP,
  DOMINANCE_SCRUTINY_BP,
  DOMINANCE_SCRUTINY_MAX_BP,
  ENTRANT_EVERY_QUARTERS,
  RESTRUCTURE_CASH_K,
  RESTRUCTURE_KEEP_FLEET,
  RESTRUCTURE_KEEP_ROUTES,
  RESTRUCTURE_MAX,
} from '../data/constants'
import { fnv1a, nextInt } from './rng'
import { getScenario } from '../data/scenarios'
import { inflationBp, resolveMarket } from './market'
import { resaleValue, routeWeeklyCapacity, totalDebt } from './queries'
import { expansionEvents, resolveSlotRequests, slotRentTotal, slotsRemaining } from './slots'
import { isGrounded, netWorth, objectiveBeats, objectiveMet, objectiveScore, objectiveScoreAt, yearOf } from './queries'
import { dealUpkeep, expireOffersAndDeals, maybeOfferDeal } from './offers'
import { deriveFootholds } from './newGame'
import { runRivalTurn } from './rivals'
import type { Airline, EngineResult, GameEvent, GameState } from './types'
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
  }
  airline.routes = airline.routes.filter((r) => keptRouteIds.has(r.id))
  airline.fleet = keptFleet
  airline.cash = Math.max(airline.cash, Math.floor((RESTRUCTURE_CASH_K * inflationBp(turn)) / 10000))
  airline.insolventQuarters = 0
  airline.restructures = (airline.restructures ?? 0) + 1
  airline.fuelHedge = null
  return { type: 'airline_restructured', airline: airline.id, routesClosed, fleetSold, debtWiped }
}

// Total weekly seats an airline puts in the air — the industry-share
// denominator for regulatory scrutiny.
function fieldedSeats(airline: Airline): number {
  let seats = 0
  for (const r of airline.routes) seats += routeWeeklyCapacity(airline, r)
  return seats
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
        const aircraft = {
          id: airline.nextId++,
          type: order.type,
          ageQuarters: 0,
          routeId: null,
          leased: order.leased,
          cabin: 2,
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
  const totals = resolveMarket(state, events)

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
    // Overhead, maintenance, admin, and salaries inflate with the era
    // (market.ts inflates the per-route operating costs); ownership and
    // lease payments track list price. Sprawl carries a quadratic overhead.
    const inflate = (v: number) => Math.floor((v * inflationBp(state.turn)) / 10000)
    let maintenance = 0
    let admin = 0
    let salaries = 0
    let ownership = 0
    for (const ac of airline.fleet) {
      const type = getAircraftType(ac.type)
      maintenance += inflate(
        Math.floor((type.maintBase * (10000 + MAINT_AGE_BP_PER_QUARTER * ac.ageQuarters)) / 10000),
      )
      admin += inflate(AIRCRAFT_ADMIN_PER_QUARTER)
      // Crews are salaried per airframe whether it flies or not — parking
      // the schedule saves fuel and fees, never the payroll.
      salaries += inflate(Math.floor((type.price * CREW_SALARY_BP_PER_QUARTER) / 10000))
      // Owned airframes carry ownership (depreciation+insurance); leased ones
      // pay the lessor instead.
      ownership += ac.leased
        ? Math.floor((type.price * LEASE_BP_PER_QUARTER) / 10000)
        : Math.floor((type.price * OWNERSHIP_BP_PER_QUARTER) / 10000)
    }
    let overhead = inflate(
      AIRLINE_OVERHEAD_PER_QUARTER + ROUTE_OVERHEAD_QUAD * airline.routes.length * airline.routes.length,
    )
    // Regulatory scrutiny: past a share of industry seats, dominance costs
    // real money (compliance, political friction, punitive fees, fare caps).
    // Charged against REVENUE so it scales with the airline it restrains —
    // an overhead-based charge is rounding error to a monopolist. Folded into
    // the overhead bucket so the breakdown still sums exactly to costs.
    const mySeats = fieldedSeats(airline)
    if (mySeats > 0) {
      let industrySeats = 0
      let liveAirlines = 0
      for (const a of state.airlines) {
        industrySeats += fieldedSeats(a)
        if (!a.bankrupt) liveAirlines++
      }
      const shareBp = industrySeats > 0 ? Math.floor((mySeats * 10000) / industrySeats) : 0
      const parityBp = Math.floor(10000 / Math.max(1, liveAirlines))
      const thresholdBp = Math.floor((parityBp * DOMINANCE_PARITY_MULT_BP) / 10000)
      if (shareBp > thresholdBp) {
        const excessBp = shareBp - thresholdBp
        const chargeBp = Math.min(
          DOMINANCE_SCRUTINY_MAX_BP,
          Math.floor((excessBp * DOMINANCE_SCRUTINY_BP) / 10000),
        )
        overhead += Math.floor((t.revenue * chargeBp) / 10000)
      }
    }
    // Public-service obligations and other accepted deals bill every quarter
    // until they run out — the price of the gates you took early.
    overhead += dealUpkeep(airline)
    // Brand spend: priced per level against network size (see constants).
    const marketing =
      airline.marketing *
      inflate(MARKETING_BASE_PER_LEVEL + MARKETING_PER_ROUTE_PER_LEVEL * airline.routes.length)
    let interest = 0
    for (const loan of airline.loans) {
      interest += Math.floor((loan.principal * loan.annualRateBp) / 4 / 10000)
    }
    // Principal amortizes AFTER interest accrues on the carried balance: a
    // share of the remaining principal comes due each quarter, with a floor
    // so stubs extinguish. Not a cost — a balance-sheet transfer — but it
    // drains the treasury, so leverage must be productive, not parked.
    let debtPayment = 0
    for (const loan of airline.loans) {
      const due = Math.min(loan.principal, Math.max(100, Math.floor((loan.principal * LOAN_AMORT_BP) / 10000)))
      loan.principal -= due
      debtPayment += due
    }
    airline.loans = airline.loans.filter((l) => l.principal > 0)
    // Airport rent: every slot held bills every quarter, whether an aircraft
    // uses it or not. Capacity is leased from the authority, and a position
    // you are not flying is a position you are paying to deny to someone else.
    const slotRent = slotRentTotal(airline)
    const breakdown = {
      fuel: t.fuel,
      fees: t.fees,
      flightPay: t.flightPay,
      service: t.service,
      salaries,
      ownership,
      maintenance,
      admin,
      slots: slotRent,
      overhead,
      marketing,
      interest,
    }
    const revenue = t.revenue
    const costs =
      t.cost + salaries + ownership + maintenance + admin + slotRent + overhead + marketing + interest
    const profit = revenue - costs
    airline.cash += profit - debtPayment

    // 7. Aging, reliability, hedge runoff, solvency, stats.
    for (const ac of airline.fleet) ac.ageQuarters++
    // Old metal breaks. Risk climbs with every quarter past the threshold, is
    // capped per airframe, and uses stateless per-entity hashing (PLAN §3.2)
    // rather than a stream draw. A grounded airframe still draws salaries and
    // ownership — that is the whole point of deferring renewal being a gamble.
    for (const ac of airline.fleet) {
      if (isGrounded(ac, state.turn)) continue
      const over = ac.ageQuarters - GROUNDING_AGE_QUARTERS
      if (over <= 0) continue
      const riskBp = Math.min(GROUNDING_MAX_BP, over * GROUNDING_BP_PER_QUARTER_OVER)
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
      }
    }
  }

  // 9. Milestones on the era's objective: the back half needs a ladder to
  // climb, not just a deadline to wait for.
  {
    const obj = getScenario(state.scenario).objective
    const p0 = state.airlines[0]!
    if (!p0.bankrupt && obj.higherIsBetter) {
      const score = objectiveScore(p0, obj.kind)
      const prevScore = p0.history.length >= 2 ? objectiveScoreAt(p0, obj.kind, p0.history.length - 1) : 0
      const ladder = obj.unit === 'rate' ? MILESTONE_PCTS_RATE : MILESTONE_PCTS
      for (const pct of ladder) {
        const bar = Math.floor((obj.target * pct) / 100)
        if (prevScore < bar && score >= bar) {
          events.push({ type: 'milestone_reached', airline: 0, label: obj.label, pctOfTarget: pct })
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
  if (player.insolventQuarters >= INSOLVENCY_QUARTERS_TO_FAIL) {
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
      if (rival.id === 0 || rival.bankrupt) continue
      const score = objectiveScore(rival, obj.kind)
      if (bestRival === null || objectiveBeats(score, bestRivalScore, obj.higherIsBetter)) {
        bestRival = rival
        bestRivalScore = score
      }
    }
    if (!objectiveMet(myScore, obj.target, obj.higherIsBetter)) {
      state.phase = 'lost'
      events.push({
        type: 'game_over',
        result: 'lost',
        reason: `missed the ${obj.label} target`,
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
