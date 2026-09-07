import { aircraftOperations, modernOperations, resolveOperations, type OperationsResult } from './operations'
// A planning forecast holds today's world and rival schedules fixed. It uses
// real market resolution and accounting, never next quarter's hidden RNG draws.
import { applyCommandBatchFor } from './index'
import { applyPlanningCommand } from './commands'
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

function evaluateQuarter(
  previous: GameState,
  seat: number,
  commands: readonly Command[] = [],
  assumptions: ForecastAssumptions = {},
  prepare?: (state: GameState, commands: readonly Command[], mode: 'forecast' | 'adverse') => Map<number, OperationsResult>,
) {
  if (commands.some((command) => command.type === 'end_quarter')) {
    throw new Error('Forecasts accept planning actions only')
  }
  // Market resolution writes route results only. Route-control previews need
  // independent routes/history arrays and world indices, not copies of every
  // past aircraft operations report. Other commands retain the full boundary.
  const routeOnly = commands.every(localRouteCommand)
  const planned = routeOnly ? { state: marketSnapshot(previous), events: [] as GameEvent[] }
    : applyCommandBatchFor(previous, commands.map((command) => ({ seat, command })))
  const state = planned.state
  if (routeOnly) for (const command of commands) planned.events.push(...applyPlanningCommand(state, seat, command).events)
  if (assumptions.economyBp !== undefined) state.world.economyBp = assumptions.economyBp
  if (assumptions.fuelBp !== undefined) state.world.fuelBp = assumptions.fuelBp
  const airline = state.airlines[seat]
  if (!airline) throw new Error('Unknown forecast airline')
  const events: GameEvent[] = []
  const mode = assumptions.operations ?? 'forecast'
  const prepared = routeOnly && modernOperations(state) ? prepare?.(state, commands, mode) : undefined
  const totals = resolveMarket(state, events, prepared, mode)[seat]!
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

const localRouteCommand = (c: Command) => ['set_fare', 'set_service', 'set_frequency', 'open_route', 'close_route'].includes(c.type)
export const forecastQuarter = (previous: GameState, seat: number, commands: readonly Command[] = [], assumptions: ForecastAssumptions = {}) =>
  evaluateQuarter(previous, seat, commands, assumptions)

// A comparison session reuses dispatch for unchanged rival fleets and for
// fare/service variants sharing the same schedule. Passenger markets always
// resolve across the full network. Cache lifetime is one immutable snapshot.
export function createForecastPlanner(previous: GameState, seat: number) {
  const rivals = new Map<string, OperationsResult>()
  const own = new Map<string, OperationsResult>()
  const prepare = (state: GameState, commands: readonly Command[], mode: 'forecast' | 'adverse') => {
    const key = mode + JSON.stringify(commands.filter(c => c.type !== 'set_fare' && c.type !== 'set_service'))
    const prepared = new Map<number, OperationsResult>()
    for (const airline of state.airlines) {
      if (airline.bankrupt) continue
      const cache = airline.id === seat ? own : rivals
      const id = airline.id === seat ? key : `${mode}:${airline.id}`
      let result = cache.get(id)
      if (!result) {
        result = resolveOperations(state, airline, mode)
        if (cache.size >= 64) cache.delete(cache.keys().next().value!)
        cache.set(id, result)
      }
      // resolveMarket adds estimated affected passengers to the summary.
      prepared.set(airline.id, { ...result, summary: { ...result.summary } })
    }
    return prepared
  }
  return (commands: readonly Command[] = [], assumptions: ForecastAssumptions = {}) => evaluateQuarter(previous, seat, commands, assumptions, prepare)
}

// Structural sharing is confined to read-only inputs of resolveMarket and
// recurringFinancials. Callers must treat forecast output as read-only too.
function marketSnapshot(previous: GameState): GameState {
  return { ...previous, world: { ...previous.world }, airlines: previous.airlines.map(a => ({
    ...a, routes: a.routes.map(r => ({ ...r, history: [...r.history] })),
    fleet: a.fleet.map(ac => ({ ...ac })), servedUntil: { ...a.servedUntil },
  })) }
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
