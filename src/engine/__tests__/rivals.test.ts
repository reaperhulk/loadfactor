import { describe, expect, it } from 'vitest'
import { CITIES } from '../../data/cities'
import { applyCommand, newGame, type GameEvent } from '../index'
import { pairWeeklySeats, routeWeeklyCapacity } from '../queries'
import { expansionScore, runRivalTurn } from '../rivals'

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

  it('a healthy rival absorbs a distressed fellow rival — never the player', () => {
    const state = newGame('jet_age', 'consolidation-seed')
    const buyer = state.airlines[1]!
    const prey = state.airlines[2]!
    buyer.cash = 500_000
    prey.insolventQuarters = 1
    // The player is equally distressed with a real network — and still safe.
    state.airlines[0]!.insolventQuarters = 2
    for (const to of ['LHR', 'CDG']) {
      prey.routes.push({
        id: prey.nextId++,
        from: 'FRA',
        to,
        fareLevel: 0,
        serviceLevel: 2,
        frequency: 5,
        lastPax: 0,
        lastCapacity: 0,
        lastLoadFactorBp: 0,
        lastRevenue: 0,
        lastCost: 0,
        lastTransferPax: 0,
        history: [],
      })
    }
    const events: GameEvent[] = []
    runRivalTurn(state, 1, events)
    const deal = events.find((e) => e.type === 'rival_acquired')
    expect(deal, 'the rich rival consolidated the distressed one').toMatchObject({ airline: 1, target: 2 })
    expect(state.airlines[2]!.bankrupt).toBe(true)
    expect(buyer.routes.length).toBeGreaterThanOrEqual(2)
    expect(state.airlines[0]!.bankrupt).toBe(false) // the player seat survives
  })

  it('rivals counter-bid a pending negotiation instead of lowballing it', () => {
    const state = newGame('jet_age', 'counterbid-seed')
    // Give the player a pending bid at every authority: whichever city the
    // rival targets, it walks into a war in progress and must top the field.
    for (const c of CITIES) state.airlines[0]!.negotiations.push({ city: c.id, spend: 20_000 })
    const rival = state.airlines[1]!
    rival.cash = 500_000
    const events: GameEvent[] = []
    runRivalTurn(state, 1, events)
    const bid = rival.negotiations[0]
    expect(bid, 'the rival still entered a negotiation').toBeDefined()
    expect(bid!.spend, 'outbids the pending 20,000 by 20%').toBeGreaterThanOrEqual(24_000)
  })
})
