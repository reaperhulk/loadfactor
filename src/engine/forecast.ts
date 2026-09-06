import { aircraftOperations } from './operations'
// A planning forecast holds today's world and rival schedules fixed. It uses
// real market resolution and accounting, never next quarter's hidden RNG draws.
import { applyCommandBatchFor } from './index'
import { recurringFinancials } from './accounting'
import { resolveMarket } from './market'
import { getAircraftType } from '../data/aircraft'
import { LEASE_BP_PER_QUARTER } from '../data/constants'
import { currentLoanRateBp, resaleValue } from './queries'
import { pairKey } from '../data/cities'
import type { Command, GameEvent, GameState, Route } from './types'

export interface ForecastAssumptions {
  operations?: 'forecast' | 'adverse'
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
  const totals = resolveMarket(state, events, undefined, assumptions.operations ?? 'forecast')[seat]!
  const financials = recurringFinancials(state, airline, totals)
  return {
    ...financials,
    operations: totals.operations,
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

export function forecastReplacement(state: GameState, seat: number, aircraftId: number, type: string, leased: boolean, financed = false) {
  const before = forecastQuarter(state, seat)
  const variant = structuredClone(state)
  const ac = variant.airlines[seat]!.fleet.find((a) => a.id === aircraftId)
  if (!ac) throw new Error('Unknown aircraft')
  const old = { ...ac }
  const spec = getAircraftType(type)
  ac.type = type; ac.ageQuarters = 0; ac.leased = leased; ac.cabin = 2
  delete ac.operations
  if (variant.airlines[seat]!.operationsPolicy) ac.operations = aircraftOperations(variant.airlines[seat]!, ac, state.turn)
  delete ac.groundedUntil; delete ac.maintainedUntil
  const borrow = financed && !leased ? Math.max(0, spec.price - state.airlines[seat]!.cash) : 0
  if (borrow > 0) variant.airlines[seat]!.loans.push({ id: -1, principal: borrow, annualRateBp: currentLoanRateBp(state) })
  const after = forecastQuarter(variant, seat)
  return { quarterlySaving: after.profit - before.profit, deliveryQuarters: leased ? 1 : spec.deliveryQuarters,
    purchaseCash: leased ? 0 : spec.price,
    requiredCash: leased ? Math.floor(spec.price * LEASE_BP_PER_QUARTER / 10000) : spec.price,
    saleOnDelivery: old.leased ? 0 : resaleValue(old.type, old.ageQuarters + (leased ? 1 : spec.deliveryQuarters)),
    projectedProfit: after.profit }
}
