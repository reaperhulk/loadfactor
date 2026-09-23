import { describe, expect, it } from 'vitest'
import type { Route } from '../../engine'
import { explainRoute } from '../routeExplain'

const base: Route = { id: 1, from: 'JFK', to: 'ORD', fareLevel: 0, serviceLevel: 2, frequency: 8, lastPax: 0, lastCapacity: 0,
  lastLoadFactorBp: 0, lastRevenue: 0, lastCost: 0, lastTransferPax: 0, history: [] }

describe('route explanations', () => {
  it('says nothing for routes without a rules 6 record', () => {
    expect(explainRoute(base)).toEqual([])
  })

  it('names the market, the share, spill on a sold-out route and the biggest flying cost', () => {
    const lines = explainRoute({ ...base, lastLoadFactorBp: 9800,
      lastMarket: { demand: 20000, carried: 15000, own: 9000, unserved: 5000, full: true },
      lastCostParts: { fuel: 600, fees: 100, flightPay: 100, service: 200 } })
    expect(lines[0]).toContain('20,000 travellers wanted JFK–ORD')
    expect(lines[0]).toContain('9,000 of them nonstop (60%)')
    expect(lines.some((l) => l.includes('the other 6,000'))).toBe(true)
    expect(lines.some((l) => l.startsWith('Sold out: 5,000'))).toBe(true)
    expect(lines.at(-1)).toContain('fuel is the largest at 60% of $1,000k')
  })

  it('credits discounts that grew the market and blames price or schedule when seats were free', () => {
    const grown = explainRoute({ ...base, lastMarket: { demand: 10000, carried: 11500, own: 11500, unserved: 0, full: false },
      lastCostParts: { fuel: 1, fees: 0, flightPay: 0, service: 0 } })
    expect(grown.some((l) => l.includes('1,500 extra travellers'))).toBe(true)
    expect(grown.some((l) => l.includes('Rivals'))).toBe(false)
    const empty = explainRoute({ ...base, lastMarket: { demand: 10000, carried: 6000, own: 6000, unserved: 4000, full: false },
      lastCostParts: { fuel: 1, fees: 0, flightPay: 0, service: 0 } })
    expect(empty.some((l) => l.startsWith('4,000 travellers stayed home'))).toBe(true)
  })
})
