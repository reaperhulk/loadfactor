// Quarter resolution — the fixed order documented in PLAN.md §3.3. Every cash
// movement in this file flows through the quarterly P&L so the accounting test
// can reconcile reported profit against the actual cash delta.

import { getAircraftType } from '../data/aircraft'
import {
  AIRCRAFT_ADMIN_PER_QUARTER,
  AIRLINE_OVERHEAD_PER_QUARTER,
  INSOLVENCY_QUARTERS_TO_FAIL,
  MAINT_AGE_BP_PER_QUARTER,
  OWNERSHIP_BP_PER_QUARTER,
} from '../data/constants'
import { getScenario } from '../data/scenarios'
import { resolveMarket } from './market'
import { resolveNegotiations } from './negotiation'
import { netWorth } from './queries'
import { runRivalTurn } from './rivals'
import type { Airline, EngineResult, GameEvent, GameState } from './types'
import { updateWorld } from './worldEvents'

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
        const aircraft = { id: airline.nextId++, type: order.type, ageQuarters: 0, routeId: null }
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

  // 4. World economy and events.
  events.push(...updateWorld(state))

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
    let fixedCosts = AIRLINE_OVERHEAD_PER_QUARTER
    for (const ac of airline.fleet) {
      const type = getAircraftType(ac.type)
      fixedCosts += Math.floor((type.maintBase * (10000 + MAINT_AGE_BP_PER_QUARTER * ac.ageQuarters)) / 10000)
      fixedCosts += Math.floor((type.price * OWNERSHIP_BP_PER_QUARTER) / 10000)
      fixedCosts += AIRCRAFT_ADMIN_PER_QUARTER
    }
    let interest = 0
    for (const loan of airline.loans) {
      interest += Math.floor((loan.principal * loan.annualRateBp) / 4 / 10000)
    }
    const revenue = t.revenue
    const costs = t.cost + fixedCosts + interest
    const profit = revenue - costs
    airline.cash += profit

    // 7. Aging, solvency, stats.
    for (const ac of airline.fleet) ac.ageQuarters++
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

  // Victory / defeat, then advance the clock.
  const scenario = getScenario(state.scenario)
  const player = state.airlines[0]!
  if (player.insolventQuarters >= INSOLVENCY_QUARTERS_TO_FAIL) {
    state.phase = 'lost'
    events.push({ type: 'game_over', result: 'lost', reason: 'bankruptcy' })
  } else if (netWorth(player) >= scenario.targetNetWorth) {
    state.phase = 'won'
    events.push({ type: 'game_over', result: 'won', reason: 'objective reached' })
  } else if (state.turn + 1 >= scenario.quarters) {
    state.phase = 'lost'
    events.push({ type: 'game_over', result: 'lost', reason: 'deadline reached' })
  }
  state.turn++

  return { state, events }
}
