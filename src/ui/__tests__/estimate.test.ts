// The shared what-if estimator must follow the engine's resolution order:
// share split → fare elasticity → spool-up attach → capacity cap. These are
// property tests against the engine's own primitives, so an engine change
// that breaks the mirror shows up here.

import { describe, expect, it } from 'vitest'
import { ROUTE_SPOOL_BP } from '../../data/constants'
import { applyCommand, newGame } from '../../engine'
import { routeWeeklyCapacity } from '../../engine/queries'
import { estimateWeeklyPax } from '../estimate'

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
})
