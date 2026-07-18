// Quarter resolution — the fixed order documented in PLAN.md §3.3. Every cash
// movement in this file flows through the quarterly P&L so the accounting test
// can reconcile reported profit against the actual cash delta.

import { AIRCRAFT, getAircraftType } from '../data/aircraft'
import {
  AIRCRAFT_ADMIN_PER_QUARTER,
  AIRLINE_OVERHEAD_PER_QUARTER,
  INSOLVENCY_QUARTERS_TO_FAIL,
  LEASE_BP_PER_QUARTER,
  MAINT_AGE_BP_PER_QUARTER,
  OWNERSHIP_BP_PER_QUARTER,
  USED_MARGIN_BP,
  USED_OFFERS_PER_QUARTER,
} from '../data/constants'
import { fnv1a } from './rng'
import { getScenario } from '../data/scenarios'
import { inflationBp, resolveMarket } from './market'
import { resaleValue } from './queries'
import { resolveNegotiations } from './negotiation'
import { netWorth, yearOf } from './queries'
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
  airline.negotiations = []
  airline.loans = []
  airline.slots = {}
  airline.cash = 0
}

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

  // 3. Slot negotiations.
  resolveNegotiations(state, events)

  // 4. World economy and events, plus this quarter's used-aircraft market
  // (stateless hash picks — deterministic, order-independent).
  events.push(...updateWorld(state))
  state.world.usedMarket = rollUsedMarket(state)

  // 5. Route economics.
  const totals = resolveMarket(state, events)

  // 6. Financials.
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
      })
      continue
    }
    const t = totals[airline.id]!
    // Overhead, maintenance, and admin inflate with the era (market.ts
    // inflates the per-route operating costs); ownership tracks list price.
    let inflatable = AIRLINE_OVERHEAD_PER_QUARTER
    let fixedCosts = 0
    for (const ac of airline.fleet) {
      const type = getAircraftType(ac.type)
      inflatable += Math.floor((type.maintBase * (10000 + MAINT_AGE_BP_PER_QUARTER * ac.ageQuarters)) / 10000)
      inflatable += AIRCRAFT_ADMIN_PER_QUARTER
      // Owned airframes carry ownership (depreciation+insurance); leased ones
      // pay the lessor instead.
      fixedCosts += ac.leased
        ? Math.floor((type.price * LEASE_BP_PER_QUARTER) / 10000)
        : Math.floor((type.price * OWNERSHIP_BP_PER_QUARTER) / 10000)
    }
    fixedCosts += Math.floor((inflatable * inflationBp(state.turn)) / 10000)
    let interest = 0
    for (const loan of airline.loans) {
      interest += Math.floor((loan.principal * loan.annualRateBp) / 4 / 10000)
    }
    const revenue = t.revenue
    const costs = t.cost + fixedCosts + interest
    const profit = revenue - costs
    airline.cash += profit

    // 7. Aging, hedge runoff, solvency, stats.
    for (const ac of airline.fleet) ac.ageQuarters++
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
      pax: t.pax,
      netWorth: netWorth(airline),
    })

    events.push({
      type: 'quarter_report',
      airline: airline.id,
      turn: state.turn,
      revenue,
      costs,
      profit,
      cash: airline.cash,
      netWorth: netWorth(airline),
      pax: t.pax,
    })

    if (airline.insolventQuarters >= INSOLVENCY_QUARTERS_TO_FAIL) {
      events.push({ type: 'airline_bankrupt', airline: airline.id })
      if (airline.controller === 'rival') liquidate(airline)
    }
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
    const playerWorth = netWorth(player)
    let bestRival: Airline | null = null
    for (const rival of state.airlines) {
      if (rival.id === 0 || rival.bankrupt) continue
      if (bestRival === null || netWorth(rival) > netWorth(bestRival)) bestRival = rival
    }
    if (playerWorth < scenario.targetNetWorth) {
      state.phase = 'lost'
      events.push({
        type: 'game_over',
        result: 'lost',
        reason: `missed the $${Math.floor(scenario.targetNetWorth / 1000)}M target`,
      })
    } else if (bestRival !== null && netWorth(bestRival) >= playerWorth) {
      state.phase = 'lost'
      events.push({ type: 'game_over', result: 'lost', reason: `outscored by ${bestRival.name}` })
    } else {
      state.phase = 'won'
      events.push({ type: 'game_over', result: 'won', reason: 'finished #1 with the target met' })
    }
  }
  state.turn++

  return { state, events }
}
