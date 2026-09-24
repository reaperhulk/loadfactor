import { describe, expect, it } from 'vitest'
import type { Route, RouteQuarter } from '../../engine'
import { quarterTrends, routeProfitTrend } from '../map/quarterResult'

const q = (turn: number, revenue: number, cost: number): RouteQuarter => ({
  turn, pax: 0, transferPax: 0, capacity: 0, loadFactorBp: 0, revenue, cost,
})
const route = (id: number, history: RouteQuarter[]): Route => ({
  id, from: 'JFK', to: 'ORD', fareLevel: 0, serviceLevel: 2, frequency: 7,
  lastPax: 0, lastCapacity: 0, lastLoadFactorBp: 0, lastRevenue: 0, lastCost: 0, lastTransferPax: 0,
  history,
})

describe('quarter result on the map', () => {
  it('compares the quarter just flown with the one before', () => {
    expect(routeProfitTrend(route(1, [q(4, 1000, 900), q(5, 1200, 900)]), 6)).toBe('up')
    expect(routeProfitTrend(route(1, [q(4, 1000, 900), q(5, 1000, 1100)]), 6)).toBe('down')
    // Noise is not news: $5k on a $1M route.
    expect(routeProfitTrend(route(1, [q(4, 1000, 900), q(5, 1000, 895)]), 6)).toBe('flat')
  })

  it('scales the threshold with the route', () => {
    // $15k is a swing on a small route, noise on a $5M one.
    expect(routeProfitTrend(route(1, [q(4, 300, 250), q(5, 315, 250)]), 6)).toBe('up')
    expect(routeProfitTrend(route(1, [q(4, 5000, 4000), q(5, 5015, 4000)]), 6)).toBe('flat')
  })

  it('judges a first quarter on whether it made money', () => {
    expect(routeProfitTrend(route(1, [q(5, 800, 500)]), 6)).toBe('up')
    expect(routeProfitTrend(route(1, [q(5, 300, 500)]), 6)).toBe('down')
    // A gap (the route rested a quarter) is a fresh start too.
    expect(routeProfitTrend(route(1, [q(2, 900, 100), q(5, 300, 500)]), 6)).toBe('down')
  })

  it('says nothing about a route that did not fly the quarter', () => {
    expect(routeProfitTrend(route(1, []), 6)).toBe('flat')
    expect(routeProfitTrend(route(1, [q(3, 1000, 100), q(4, 2000, 100)]), 6)).toBe('flat')
  })

  it('counts the network', () => {
    const t = quarterTrends([
      route(1, [q(5, 800, 500)]),
      route(2, [q(5, 300, 500)]),
      route(3, [q(4, 800, 500), q(5, 800, 500)]),
    ], 6)
    expect([t.up, t.down]).toEqual([1, 1])
    expect([...t.byRoute]).toEqual([[1, 'up'], [2, 'down'], [3, 'flat']])
  })
})
