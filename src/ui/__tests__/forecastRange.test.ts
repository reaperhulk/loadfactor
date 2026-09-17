import { describe, expect, it } from 'vitest'
import { applyCommand, newGame } from '../../engine'
import { forecastQuarter } from '../../engine/forecast'
import { forecastRange } from '../forecastRange'

function flying() {
  let state = newGame('jet_age', 'range-seed')
  const me = state.airlines[0]!
  state = applyCommand(state, { type: 'open_route', from: 'JFK', to: 'ORD', aircraftId: me.fleet[0]!.id, frequency: 8 }).state
  state = applyCommand(state, { type: 'open_route', from: 'JFK', to: 'MIA', aircraftId: me.fleet[1]!.id, frequency: 6 }).state
  return state
}

describe('forecast range', () => {
  it('brackets the point forecast and names its drivers', () => {
    const state = flying()
    const forecast = forecastQuarter(state, 0)
    const range = forecastRange(state, 0, forecast)
    expect(range.low).toBeLessThan(forecast.profit)
    expect(range.high).toBeGreaterThan(forecast.profit)
    expect(range.drivers.map((d) => d.label)).toContain('Demand noise and the economy walk')
    expect(range.drivers.some((d) => d.label.startsWith('Fuel price walk'))).toBe(true)
    for (const d of range.drivers) { expect(d.low).toBeLessThanOrEqual(0); expect(d.high).toBeGreaterThanOrEqual(0) }
  })

  it('a hedge removes the fuel driver', () => {
    const state = flying()
    state.airlines[0]!.fuelHedge = { bp: 10000, quartersLeft: 4 }
    const range = forecastRange(state, 0, forecastQuarter(state, 0))
    expect(range.drivers.some((d) => d.label.startsWith('Fuel price walk'))).toBe(false)
  })

  it('an event in its last quarter shifts the range in the direction it reverses', () => {
    const state = flying()
    state.world.events.push({ id: 'boom', quartersLeft: 1, city: null, region: null })
    const boomEnds = forecastRange(state, 0, forecastQuarter(state, 0))
    const boom = boomEnds.drivers.find((d) => d.label.includes('Economic boom'))!
    expect(boom).toBeDefined()
    expect(boom.low).toBeLessThan(0)
    expect(boom.high).toBe(0)
    state.world.events = [{ id: 'recession', quartersLeft: 1, city: null, region: null }]
    const slumpEnds = forecastRange(state, 0, forecastQuarter(state, 0))
    const recession = slumpEnds.drivers.find((d) => d.label.includes('recession'))!
    expect(recession.high).toBeGreaterThan(0)
    expect(recession.low).toBe(0)
    // Two quarters left: no reversal yet, no driver.
    state.world.events = [{ id: 'recession', quartersLeft: 2, city: null, region: null }]
    expect(forecastRange(state, 0, forecastQuarter(state, 0)).drivers.some((d) => d.label.includes('recession'))).toBe(false)
  })

  it('contested pairs and an announced raid widen the downside', () => {
    const state = flying()
    const quiet = forecastRange(state, 0, forecastQuarter(state, 0))
    const rival = state.airlines[1]!
    rival.slots['JFK'] = 2; rival.slots['ORD'] = 2
    rival.routes.push({ id: rival.nextId++, from: 'JFK', to: 'ORD', fareLevel: -1, serviceLevel: 2, frequency: 5, lastPax: 0, lastCapacity: 0, lastLoadFactorBp: 0, lastRevenue: 0, lastCost: 0, lastTransferPax: 0, history: [] })
    const contested = forecastRange(state, 0, forecastQuarter(state, 0))
    expect(contested.high - contested.low).toBeGreaterThan(quiet.high - quiet.low)
    expect(contested.drivers.some((d) => d.label.includes('contested pair'))).toBe(true)
    state.airlines[2]!.campaign = { kind: 'raid', city: 'MIA', pair: 'JFK-MIA', target: 0, fromTurn: state.turn, untilTurn: state.turn + 8 }
    const raided = forecastRange(state, 0, forecastQuarter(state, 0))
    const raid = raided.drivers.find((d) => d.label.includes('raid campaign'))!
    expect(raid.low).toBeLessThan(0)
    expect(raid.high).toBe(0)
    expect(raided.low).toBeLessThan(contested.low)
    expect(raided.high).toBe(contested.high)
  })
})
