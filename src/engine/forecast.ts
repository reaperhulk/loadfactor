// A planning forecast holds today's world and rival schedules fixed. It uses
// real market resolution and accounting, never next quarter's hidden RNG draws.
import { applyCommandBatchFor } from './index'
import { recurringFinancials } from './accounting'
import { resolveMarket } from './market'
import { pairKey } from '../data/cities'
import type { Command, GameEvent, GameState, Route } from './types'

export interface ForecastAssumptions {
  economyBp?: number
  fuelBp?: number
}

export function forecastQuarter(
  previous: GameState,
  seat: number,
  commands: readonly Command[] = [],
  assumptions: ForecastAssumptions = {},
) {
  if (commands.some((command) => command.type === 'end_quarter')) {
    throw new Error('Forecasts accept planning actions only')
  }
  const planned = applyCommandBatchFor(previous, commands.map((command) => ({ seat, command })))
  const state = planned.state === previous ? structuredClone(previous) : planned.state
  if (assumptions.economyBp !== undefined) state.world.economyBp = assumptions.economyBp
  if (assumptions.fuelBp !== undefined) state.world.fuelBp = assumptions.fuelBp
  const airline = state.airlines[seat]
  if (!airline) throw new Error('Unknown forecast airline')
  const events: GameEvent[] = []
  const totals = resolveMarket(state, events)[seat]!
  const financials = recurringFinancials(state, airline, totals)
  return {
    ...financials,
    cashRequired: previous.airlines[seat]!.cash - airline.cash,
    cashAfter: airline.cash + financials.profit - financials.debtPayment,
    routes: airline.routes,
    errors: planned.events.filter((event) => event.type === 'command_rejected'),
  }
}

// A smaller direct-market evaluation for fare and frequency controls. Preserve
// every airline on this pair, but omit other routes and connecting itineraries.
export function forecastDirectRoute(previous: GameState, seat: number, variant: Route): Route {
  const key = pairKey(variant.from, variant.to)
  const state: GameState = {
    ...previous,
    airlines: previous.airlines.map((airline) => ({
      ...airline,
      routes: (airline.id === seat ? [variant] : airline.routes.filter((r) => pairKey(r.from, r.to) === key))
        .map((route) => ({ ...route, history: [...route.history] })),
    })),
  }
  resolveMarket(state, [])
  return state.airlines[seat]!.routes[0]!
}
