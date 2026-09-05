import { describe, expect, it } from 'vitest'
import { distanceKm } from '../../data/cities'
import { resolveItineraries } from '../itineraries'
import { newGame } from '../index'
import type { RouteAcc } from '../market'
import type { GameState, Route } from '../types'

function leg(state: GameState, airline: number, from: string, to: string, capacity = 100000): RouteAcc {
  const a = state.airlines[airline]!
  const route: Route = { id: a.nextId++, from: from < to ? from : to, to: from < to ? to : from,
    fareLevel: 0, serviceLevel: 2, frequency: 12, lastPax: 0, lastCapacity: 0, lastLoadFactorBp: 0,
    lastRevenue: 0, lastCost: 0, lastTransferPax: 0,
    history: Array.from({ length: 4 }, (_, turn) => ({ turn, pax: 100, capacity: 100, transferPax: 0, loadFactorBp: 10000, revenue: 1, cost: 1 })) }
  a.routes.push(route)
  return { airlineIdx: airline, route, km: distanceKm(from, to), weeklyTrips: 12, weeklyPax: 0,
    weeklyTransfer: 0, weeklyCapacity: capacity, yieldBp: 10000, weeklyRevenue: 0,
    weeklyFuel: 0, weeklyFees: 0, weeklyFlightPay: 0, weeklyService: 0 }
}
describe('shared itinerary market', () => {
  it('conserves each O/D population with multiple airlines, direct service and competing hubs', () => {
    const state = newGame('jet_age', 'itinerary-audit')
    const legs = [leg(state, 0, 'JFK', 'LAX'), leg(state, 1, 'JFK', 'ORD'), leg(state, 1, 'ORD', 'LAX'), leg(state, 2, 'JFK', 'DEN'), leg(state, 2, 'DEN', 'LAX')]
    const audit = resolveItineraries(state, legs)
    for (const market of audit) {
      expect(market.carried).toBeLessThanOrEqual(market.demand)
      expect(market.connecting).toBeLessThanOrEqual(market.carried)
    }
    expect(audit.find((m) => m.pair === 'JFK-LAX')!.connecting).toBeGreaterThan(0)
    expect(legs.reduce((sum, l) => sum + l.weeklyPax, 0)).toBe(audit.reduce((sum, m) => sum + m.carried + m.connecting, 0))
    for (const l of legs) {
      expect(l.weeklyPax).toBeLessThanOrEqual(l.weeklyCapacity)
      expect(Object.values(l.segments!).reduce((a, b) => a + b, 0)).toBe(l.weeklyPax)
    }
  })
  it('uses an alternative hub when the first hub has no seats', () => {
    const state = newGame('jet_age', 'alternate-hub')
    const full = leg(state, 0, 'JFK', 'ORD', 1)
    full.weeklyPax = 1
    const legs = [full, leg(state, 0, 'ORD', 'LAX'), leg(state, 0, 'JFK', 'DEN'), leg(state, 0, 'DEN', 'LAX')]
    const market = resolveItineraries(state, legs).find((m) => m.pair === 'JFK-LAX')!
    expect(market.connecting).toBeGreaterThan(0)
    expect(legs[2]!.weeklyTransfer).toBeGreaterThan(0)
    expect(full.weeklyPax).toBe(1)
  })
  it('business passengers reward service and budget passengers reward low prices', () => {
    const state = newGame('jet_age', 'segments')
    const premium = leg(state, 0, 'JFK', 'LAX')
    const basic = leg(state, 1, 'JFK', 'LAX')
    premium.route.serviceLevel = 3
    basic.route.serviceLevel = 1
    basic.route.fareLevel = -2
    resolveItineraries(state, [premium, basic])
    expect(premium.segments!.business).toBeGreaterThan(basic.segments!.business)
    expect(basic.segments!.budget).toBeGreaterThan(premium.segments!.budget)
  })
})

it('a hub strategy values complementary spokes rather than redundant detours', async () => {
  const { connectionOpportunity } = await import('../policy')
  const state = newGame('open_skies', 'hub-strategy')
  const existing = leg(state, 0, 'SIN', 'HKG')
  state.airlines[0]!.fleet[0]!.routeId = existing.route.id
  expect(connectionOpportunity(state, 0, 'SIN', 'SYD')).toBeGreaterThan(connectionOpportunity(state, 0, 'SIN', 'HND'))
})
