// The shared what-if estimator must follow the engine's resolution order:
// share split → fare elasticity → spool-up attach → capacity cap. These are
// property tests against the engine's own primitives, so an engine change
// that breaks the mirror shows up here.

import { describe, expect, it } from 'vitest'
import { DEMAND_NOISE_SPREAD_BP, ROUTE_SPOOL_BP } from '../../data/constants'
import { applyCommand, newGame } from '../../engine'
import { routeWeeklyCapacity } from '../../engine/queries'
import { estimateWeeklyPax, tooCloseToCall } from '../estimate'

function withRoute() {
  const fresh = newGame('jet_age', 'estimate-seed')
  const idle = fresh.airlines[0]!.fleet.find((a) => a.routeId === null)!
  const { state } = applyCommand(fresh, {
    type: 'open_route',
    from: 'JFK',
    to: 'ORD',
    aircraftId: idle.id,
    frequency: 8,
  })
  return state
}

describe('estimateWeeklyPax', () => {
  it('applies the first-quarter spool-up to a brand-new route', () => {
    const state = withRoute()
    const route = state.airlines[0]!.routes[0]!
    const ramping = estimateWeeklyPax(state, route)
    expect(ramping.spoolBp).toBe(ROUTE_SPOOL_BP[0])
    // The same route, pretended established: attach share goes to 100% and
    // the estimate scales by exactly the spool factor (unless capacity-capped).
    const established = { ...route, history: [{}, {}, {}] as typeof route.history }
    const full = estimateWeeklyPax(state, established)
    expect(full.spoolBp).toBe(10000)
    const cap = routeWeeklyCapacity(state.airlines[0]!, route)
    if (full.pax < cap) {
      expect(ramping.pax).toBe(Math.floor((full.pax * ROUTE_SPOOL_BP[0]!) / 10000))
    } else {
      expect(ramping.pax).toBeLessThanOrEqual(full.pax)
    }
  })

  it('never estimates beyond the schedule capacity', () => {
    const state = withRoute()
    const route = state.airlines[0]!.routes[0]!
    for (const fareLevel of [-2, -1, 0, 1, 2]) {
      const { pax } = estimateWeeklyPax(state, { ...route, fareLevel })
      expect(pax).toBeLessThanOrEqual(routeWeeklyCapacity(state.airlines[0]!, route))
      expect(pax).toBeGreaterThanOrEqual(0)
    }
  })

  it('a rival on the pair costs share; cutting fares wins pax back', () => {
    const state = withRoute()
    const route = state.airlines[0]!.routes[0]!
    const solo = estimateWeeklyPax(state, { ...route, history: [{}, {}, {}] as typeof route.history })
    // Plant a rival flying the same pair with an overwhelming schedule, so
    // the player's share falls well below the capacity cap and the split is
    // visible in the pax number, not just the percentage.
    const rival = state.airlines[1]!
    const rivalRoute = {
      ...route,
      id: rival.nextId++,
      fareLevel: 0,
      frequency: 20,
    }
    rival.routes.push(rivalRoute)
    for (const plane of rival.fleet) plane.routeId = rivalRoute.id
    const contested = estimateWeeklyPax(state, { ...route, history: [{}, {}, {}] as typeof route.history })
    expect(contested.sharePct).toBeLessThan(100)
    expect(contested.pax).toBeLessThan(solo.pax)
    // Discounting below the rival buys share back (elasticity + weight).
    const discounted = estimateWeeklyPax(state, {
      ...route,
      fareLevel: -2,
      history: [{}, {}, {}] as typeof route.history,
    })
    expect(discounted.pax).toBeGreaterThan(contested.pax)
  })

  // The band is the honest part of the estimate: demand noise is per-pair and
  // unknowable in advance, so every preview reports a range the midpoint sits
  // inside, and no preview may promise more than the schedule can carry.
  it('brackets the midpoint with the demand-noise band, still capped by capacity', () => {
    const state = withRoute()
    const route = state.airlines[0]!.routes[0]!
    const cap = routeWeeklyCapacity(state.airlines[0]!, route)
    for (const fareLevel of [-2, -1, 0, 1, 2]) {
      const est = estimateWeeklyPax(state, { ...route, fareLevel })
      expect(est.low).toBeLessThanOrEqual(est.pax)
      expect(est.pax).toBeLessThanOrEqual(est.high)
      expect(est.high).toBeLessThanOrEqual(cap)
      // Clear of the cap, the band is exactly the noise spread either side.
      // Against the cap it flattens on the upside only — a lucky quarter can't
      // fill seats that were never scheduled, but an unlucky one still empties
      // them — so the exact form is only claimed when nothing is clipped.
      if (est.high < cap) {
        expect(est.high).toBe(Math.floor((est.pax * (10000 + DEMAND_NOISE_SPREAD_BP)) / 10000))
        expect(est.low).toBe(Math.floor((est.pax * (10000 - DEMAND_NOISE_SPREAD_BP)) / 10000))
      }
    }
  })

  it('calls a contest too close when the bands overlap and decisive when they do not', () => {
    const state = withRoute()
    const route = state.airlines[0]!.routes[0]!
    // Plant a rival so the player's share sits well below the capacity cap —
    // against the cap every fare posture reads the same number and there is
    // nothing to distinguish.
    const rival = state.airlines[1]!
    const rivalRoute = { ...route, id: rival.nextId++, fareLevel: 0, frequency: 20 }
    rival.routes.push(rivalRoute)
    for (const plane of rival.fleet) plane.routeId = rivalRoute.id
    const established = { ...route, history: [{}, {}, {}] as typeof route.history }
    const here = estimateWeeklyPax(state, established)
    // A posture is never distinguishable from itself.
    expect(tooCloseToCall(here, here)).toBe(true)
    // Two fare levels apart clears the noise band in either direction, so the
    // table is entitled to name a winner.
    const cheap = estimateWeeklyPax(state, { ...established, fareLevel: -2 })
    const dear = estimateWeeklyPax(state, { ...established, fareLevel: 2 })
    expect(cheap.pax).toBeGreaterThan(dear.pax)
    expect(tooCloseToCall(cheap, dear)).toBe(cheap.low <= dear.high)
    // And the relation is symmetric whichever way it lands.
    expect(tooCloseToCall(dear, cheap)).toBe(tooCloseToCall(cheap, dear))
  })
})
