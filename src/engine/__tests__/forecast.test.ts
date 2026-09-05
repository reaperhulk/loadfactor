import { describe, expect, it } from 'vitest'
import { applyCommandFor, newGame } from '../index'
import { forecastDirectRoute, forecastQuarter } from '../forecast'
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
