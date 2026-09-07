import { describe, expect, it } from 'vitest'
import { applyCommandBatchFor, applyCommandFor, newGame } from '../index'
import { createForecastPlanner, forecastDirectRoute, forecastQuarter } from '../forecast'
import { resolveMarket } from '../market'
import { recurringFinancials } from '../accounting'
import { hashState } from '../../harness/hash'

function setup(seat = 0) {
  let state = newGame('jet_age', 'forecast-contract', undefined, [1])
  const airline = state.airlines[seat]!
  const destination = seat === 0 ? 'ORD' : 'MAD'
  state = applyCommandFor(state, seat, {
    type: 'open_route', from: airline.hq, to: destination,
    aircraftId: airline.fleet[0]!.id, frequency: 6,
  }).state
  return state
}

describe('planning forecasts', () => {
  it('reconciles with the market and ledger without changing state or RNG', () => {
    const state = setup(1)
    const before = hashState(state)
    const forecast = forecastQuarter(state, 1)
    expect(hashState(state)).toBe(before)
    const resolved = structuredClone(state)
    const totals = resolveMarket(resolved, [])
    const actual = recurringFinancials(resolved, resolved.airlines[1]!, totals[1]!)
    expect(forecast.profit).toBe(actual.profit)
    expect(forecast.breakdown).toEqual(actual.breakdown)
    expect(forecast.cashAfter).toBe(state.airlines[1]!.cash + actual.profit - actual.debtPayment)
    expect(forecast.routes[0]!.lastPax).toBe(resolved.airlines[1]!.routes[0]!.lastPax)
    expect(forecast.routes[0]!.from).not.toBe('JFK')
  })

  it('accounts for frequency, cabins, leased aging aircraft, and fuel hedges', () => {
    const state = setup()
    const airline = state.airlines[0]!
    const aircraft = airline.fleet[0]!
    aircraft.leased = true
    aircraft.ageQuarters = 32
    aircraft.cabin = 3
    const before = forecastQuarter(state, 0)
    const route = airline.routes[0]!
    const increased = forecastQuarter(state, 0, [{ type: 'set_frequency', routeId: route.id, frequency: 12 }])
    expect(increased.breakdown.fuel).toBeGreaterThan(before.breakdown.fuel)
    expect(increased.breakdown.ownership).toBe(before.breakdown.ownership)
    expect(increased.breakdown.maintenance).toBe(before.breakdown.maintenance)
    airline.fuelHedge = { bp: 5000, quartersLeft: 2 }
    const hedged = forecastQuarter(state, 0)
    expect(hedged.breakdown.fuel).toBeLessThan(before.breakdown.fuel)
    expect(forecastQuarter(state, 0, [], { fuelBp: 20000 }).breakdown.fuel).toBe(hedged.breakdown.fuel)
    const direct = forecastDirectRoute(state, 0, route)
    expect(direct.lastPax).toBe(hedged.routes[0]!.lastPax)
  })

  it('reports rejected proposals and never advances a quarter', () => {
    const state = setup()
    expect(forecastQuarter(state, 0, [{ type: 'set_frequency', routeId: -1, frequency: 1 }]).errors).toHaveLength(1)
    expect(() => forecastQuarter(state, 0, [{ type: 'end_quarter' }])).toThrow('planning')
  })
})

// Optimized previews must match the independent full-copy market/ledger path,
// including errors, check downtime and the histories exposed to inspectors.
it('route previews structurally share only read-only inputs', () => {
  const state = setup()
  const before = structuredClone(state)
  const routeId = state.airlines[0]!.routes[0]!.id
  const commands = [
    { type: 'set_fare', routeId, fareLevel: 1 },
    { type: 'set_service', routeId, serviceLevel: 3 },
    { type: 'set_frequency', routeId, frequency: 4 },
    { type: 'set_frequency', routeId: -1, frequency: 2 },
  ] as const
  const planned = applyCommandBatchFor(state, commands.map(command => ({ seat: 0, command })))
  const totals = resolveMarket(planned.state, [])
  const reference = recurringFinancials(planned.state, planned.state.airlines[0]!, totals[0]!)
  const freeze = (value: unknown): void => {
    if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze) }
  }
  freeze(state)
  const forecast = forecastQuarter(state, 0, commands)
  expect(forecast.breakdown).toEqual(reference.breakdown)
  expect(forecast.profit).toBe(reference.profit)
  expect(forecast.routes).toEqual(planned.state.airlines[0]!.routes)
  expect(forecast.errors).toEqual(planned.events.filter(e => e.type === 'command_rejected'))
  expect(state).toEqual(before)
})

it('prepared comparison sessions match standalone forecasts across schedules, fares, closure and stress', () => {
  const state = setup(), evaluate = createForecastPlanner(state, 0)
  const routeId = state.airlines[0]!.routes[0]!.id
  const variants = [[], [{ type: 'set_fare', routeId, fareLevel: 2 }],
    [{ type: 'set_frequency', routeId, frequency: 4 }],
    [{ type: 'set_frequency', routeId, frequency: 4 }, { type: 'set_service', routeId, serviceLevel: 1 }],
    [{ type: 'close_route', routeId }], [{ type: 'set_marketing', level: 3 }],
  ] as const
  for (const commands of variants) for (const assumptions of [{}, { operations: 'adverse' as const }, { fuelBp: 12000 }]) {
    expect(evaluate(commands, assumptions)).toEqual(forecastQuarter(state, 0, commands, assumptions))
    expect(evaluate(commands, assumptions)).toEqual(forecastQuarter(state, 0, commands, assumptions))
  }
})
