import { describe, expect, it } from 'vitest'
import { applyCommand, newGame } from '../index'
import { pairWeeklySeats, routeWeeklyCapacity } from '../queries'
import { expansionScore } from '../rivals'

describe('rival intelligence', () => {
  it('expansion score nets fielded seats out of demand by contest appetite', () => {
    expect(expansionScore(1000, 0, 10000)).toBe(1000)
    expect(expansionScore(1000, 400, 10000)).toBe(600)
    // price_war (6000) reads incumbents as beatable; premium (13000) reads a
    // crowded pair as poison — same market, different appetite.
    expect(expansionScore(1000, 400, 6000)).toBeGreaterThan(expansionScore(1000, 400, 13000))
  })

  it('pairWeeklySeats counts the hardware every airline flies on a pair', () => {
    let state = newGame('jet_age', 'seats-seed')
    expect(pairWeeklySeats(state, 'JFK', 'ORD')).toBe(0)
    state = applyCommand(state, {
      type: 'open_route',
      from: 'JFK',
      to: 'ORD',
      aircraftId: 1,
      frequency: 10,
    }).state
    const airline = state.airlines[0]!
    const seats = pairWeeklySeats(state, 'JFK', 'ORD')
    expect(seats).toBeGreaterThan(0)
    expect(seats).toBe(routeWeeklyCapacity(airline, airline.routes[0]!))
    expect(pairWeeklySeats(state, 'ORD', 'JFK')).toBe(seats)
  })
})
