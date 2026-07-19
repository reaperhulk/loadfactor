import { describe, expect, it } from 'vitest'
import { applyCommand, newGame } from '../index'
import { baseFare, fareFor, pairWeeklyDemand, resolveMarket } from '../market'
import type { GameEvent, GameState } from '../types'

function withRoute(state: GameState, airlineIdx: number, from: string, to: string, fareLevel = 0): number {
  const airline = state.airlines[airlineIdx]!
  const [a, b] = from < to ? [from, to] : [to, from]
  const route = {
    id: airline.nextId++,
    from: a,
    to: b,
    fareLevel,
    serviceLevel: 2,
    frequency: 9999, // effective schedule capped by the assigned fleet
    lastPax: 0,
    lastCapacity: 0,
    lastLoadFactorBp: 0,
    lastRevenue: 0,
    lastCost: 0,
    lastTransferPax: 0,
    history: [],
  }
  airline.routes.push(route)
  airline.slots[a] = (airline.slots[a] ?? 0) + 1
  airline.slots[b] = (airline.slots[b] ?? 0) + 1
  return route.id
}

describe('demand model', () => {
  it('big pairs have meaningful demand', () => {
    const state = newGame('jet_age', 'demand-seed')
    expect(pairWeeklyDemand(state, 'JFK', 'LHR')).toBeGreaterThan(2000)
    expect(pairWeeklyDemand(state, 'JFK', 'ORD')).toBeGreaterThan(2000)
  })

  it('demand is symmetric in city order', () => {
    const state = newGame('jet_age', 'demand-seed')
    expect(pairWeeklyDemand(state, 'LHR', 'JFK')).toBe(pairWeeklyDemand(state, 'JFK', 'LHR'))
  })

  it('demand grows with the era', () => {
    const state = newGame('jet_age', 'demand-seed')
    const early = pairWeeklyDemand(state, 'JFK', 'LHR')
    const later = structuredClone(state)
    later.turn = 40
    // Noise is ±8%, growth over 40 quarters is +50% — strictly bigger.
    expect(pairWeeklyDemand(later, 'JFK', 'LHR')).toBeGreaterThan(early)
  })

  it('fares rise with distance, concavely, and with fare level', () => {
    expect(baseFare(2000)).toBeGreaterThan(baseFare(1000))
    // Long-haul $/km is lower than short-haul $/km.
    const shortPerKm = baseFare(1000) / 1000
    const longPerKm = baseFare(9000) / 9000
    expect(longPerKm).toBeLessThan(shortPerKm)
    expect(fareFor(2000, 2)).toBeGreaterThan(fareFor(2000, 0))
    expect(fareFor(2000, -2)).toBeLessThan(fareFor(2000, 0))
  })
})

describe('market resolution', () => {
  it('caps pax at capacity and reports a load factor in [0, 10000]', () => {
    const state = newGame('jet_age', 'market-seed')
    const routeId = withRoute(state, 0, 'JFK', 'ORD')
    state.airlines[0]!.fleet[0]!.routeId = routeId
    const events: GameEvent[] = []
    resolveMarket(state, events)
    const result = events.find((e) => e.type === 'route_result')
    expect(result).toBeDefined()
    if (result?.type === 'route_result') {
      expect(result.pax).toBeLessThanOrEqual(result.capacity)
      expect(result.loadFactorBp).toBeGreaterThanOrEqual(0)
      expect(result.loadFactorBp).toBeLessThanOrEqual(10000)
      expect(result.revenue).toBeGreaterThan(0)
      expect(result.cost).toBeGreaterThan(0)
    }
  })

  it('a route with no aircraft carries nobody but costs nothing', () => {
    const state = newGame('jet_age', 'market-seed')
    withRoute(state, 0, 'JFK', 'ORD')
    const events: GameEvent[] = []
    const totals = resolveMarket(state, events)
    expect(totals[0]).toEqual({ revenue: 0, cost: 0, pax: 0 })
  })

  it('competition splits a pair and cheaper fares win share', () => {
    const state = newGame('jet_age', 'market-seed')
    // Both airlines fly JFK-ORD with one identical aircraft each; the rival
    // undercuts on fare. Fill JFK-ORD far beyond both capacities so the split
    // is demand-rich: with spill both fill up. Use a thin pair instead.
    const playerRoute = withRoute(state, 0, 'MIA', 'YYZ', 0)
    const rivalRoute = withRoute(state, 1, 'MIA', 'YYZ', -2)
    state.airlines[0]!.fleet[0]!.routeId = playerRoute
    state.airlines[1]!.fleet[0]!.routeId = rivalRoute
    const events: GameEvent[] = []
    resolveMarket(state, events)
    const results = events.filter((e) => e.type === 'route_result')
    expect(results).toHaveLength(2)
    if (results[0]?.type === 'route_result' && results[1]?.type === 'route_result') {
      const player = results.find((r) => r.type === 'route_result' && r.airline === 0)
      const rival = results.find((r) => r.type === 'route_result' && r.airline === 1)
      if (player?.type === 'route_result' && rival?.type === 'route_result') {
        expect(rival.pax).toBeGreaterThan(player.pax)
      }
    }
  })

  it('connecting pax ride spare seats over a hub on unserved pairs', () => {
    const state = newGame('jet_age', 'connect-seed')
    const airline = state.airlines[0]!
    const type = airline.fleet[0]!.type
    // JFK–ORD and ORD–LAX exist; JFK–LAX does not. Via ORD is barely a detour,
    // so a share of JFK–LAX demand should connect. Pile on capacity so direct
    // demand leaves spare seats on both legs.
    const leg1 = withRoute(state, 0, 'JFK', 'ORD')
    const leg2 = withRoute(state, 0, 'ORD', 'LAX')
    for (let i = 0; i < 8; i++) {
      airline.fleet.push({
        id: airline.nextId++,
        type,
        ageQuarters: 0,
        routeId: i % 2 === 0 ? leg1 : leg2,
        leased: false,
        cabin: 2,
      })
    }
    const events: GameEvent[] = []
    resolveMarket(state, events)
    const r1 = airline.routes.find((r) => r.id === leg1)!
    const r2 = airline.routes.find((r) => r.id === leg2)!
    // The same connecting flow rides both legs (only one unserved pair here).
    expect(r1.lastTransferPax).toBeGreaterThan(0)
    expect(r2.lastTransferPax).toBe(r1.lastTransferPax)
    expect(r1.lastPax).toBeLessThanOrEqual(r1.lastCapacity)
    expect(r2.lastPax).toBeLessThanOrEqual(r2.lastCapacity)
    const results = events.filter((e) => e.type === 'route_result')
    for (const r of results) {
      if (r.type === 'route_result') expect(r.transferPax).toBeGreaterThan(0)
    }
  })

  it('nobody connects through an absurd detour', () => {
    const state = newGame('jet_age', 'connect-seed')
    const airline = state.airlines[0]!
    const type = airline.fleet[0]!.type
    // JFK–LAX and LAX–ORD exist; the unserved pair JFK–ORD is short, and
    // routing it through LAX is a ~5.7× detour — beyond any tolerance.
    const leg1 = withRoute(state, 0, 'JFK', 'LAX')
    const leg2 = withRoute(state, 0, 'LAX', 'ORD')
    for (let i = 0; i < 8; i++) {
      airline.fleet.push({
        id: airline.nextId++,
        type,
        ageQuarters: 0,
        routeId: i % 2 === 0 ? leg1 : leg2,
        leased: false,
        cabin: 2,
      })
    }
    resolveMarket(state, [])
    for (const r of airline.routes) expect(r.lastTransferPax).toBe(0)
  })

  it('cabin fits trade seats for yield', () => {
    const flyWithCabin = (cabin: number) => {
      const state = newGame('jet_age', 'cabin-seed')
      const routeId = withRoute(state, 0, 'JFK', 'ORD')
      state.airlines[0]!.fleet[0]!.routeId = routeId
      state.airlines[0]!.fleet[0]!.cabin = cabin
      resolveMarket(state, [])
      return state.airlines[0]!.routes[0]!
    }
    const dense = flyWithCabin(1)
    const standard = flyWithCabin(2)
    const premium = flyWithCabin(3)
    // High density fields more seats; premium fields fewer but earns more per
    // passenger flown (fare × yield), whatever the pax split.
    expect(dense.lastCapacity).toBeGreaterThan(standard.lastCapacity)
    expect(premium.lastCapacity).toBeLessThan(standard.lastCapacity)
    const perPax = (r: typeof standard) => r.lastRevenue / Math.max(1, r.lastPax)
    expect(perPax(premium)).toBeGreaterThan(perPax(standard))
    expect(perPax(dense)).toBeLessThan(perPax(standard))
  })

  it('quarter resolution emits results through the public surface', () => {
    let r = applyCommand(newGame('jet_age', 'market-seed'), {
      type: 'open_route',
      from: 'JFK',
      to: 'ORD',
      aircraftId: 1,
      frequency: 10,
    })
    r = applyCommand(r.state, { type: 'end_quarter' })
    const route = r.state.airlines[0]!.routes[0]!
    expect(route.lastPax).toBeGreaterThan(0)
    expect(route.lastRevenue).toBeGreaterThan(0)
    expect(route.lastLoadFactorBp).toBeGreaterThan(0)
  })
})
