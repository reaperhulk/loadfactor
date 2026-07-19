import { describe, expect, it } from 'vitest'
import { applyCommand, newGame, type GameEvent, type GameState } from '../index'

function expectRejected(events: GameEvent[], reasonPart: string): void {
  const rejection = events.find((e) => e.type === 'command_rejected')
  expect(rejection, `expected a rejection mentioning "${reasonPart}"`).toBeDefined()
  if (rejection?.type === 'command_rejected') {
    expect(rejection.reason).toContain(reasonPart)
  }
}

function fresh(): GameState {
  return newGame('jet_age', 'test-seed')
}

describe('command validation', () => {
  it('opens a route with a launch aircraft and schedule', () => {
    const { state, events } = applyCommand(fresh(), {
      type: 'open_route',
      from: 'JFK',
      to: 'ORD',
      aircraftId: 1,
      frequency: 10,
    })
    expect(events[0]).toMatchObject({ type: 'route_opened', from: 'JFK', to: 'ORD' })
    expect(state.airlines[0]!.routes[0]).toMatchObject({ frequency: 10 })
    // The launch aircraft is assigned as part of the open.
    expect(state.airlines[0]!.fleet[0]!.routeId).toBe(state.airlines[0]!.routes[0]!.id)
  })

  it('validates the launch schedule against the aircraft', () => {
    // Meridian 80 tops out at 22 round trips/week on JFK-ORD.
    expectRejected(
      applyCommand(fresh(), { type: 'open_route', from: 'JFK', to: 'ORD', aircraftId: 1, frequency: 99 }).events,
      'frequency must be 1..22',
    )
    expectRejected(
      applyCommand(fresh(), { type: 'open_route', from: 'JFK', to: 'ORD', aircraftId: 1, frequency: 0 }).events,
      'frequency',
    )
    // A busy aircraft cannot launch a second route.
    const first = applyCommand(fresh(), { type: 'open_route', from: 'JFK', to: 'ORD', aircraftId: 1, frequency: 5 })
    expectRejected(
      applyCommand(first.state, { type: 'open_route', from: 'JFK', to: 'MIA', aircraftId: 1, frequency: 5 }).events,
      'already assigned',
    )
  })

  it('set_frequency is capped by the assigned fleet', () => {
    let r = applyCommand(fresh(), { type: 'open_route', from: 'JFK', to: 'ORD', aircraftId: 1, frequency: 5 })
    const routeId = r.state.airlines[0]!.routes[0]!.id
    r = applyCommand(r.state, { type: 'set_frequency', routeId, frequency: 22 })
    expect(r.state.airlines[0]!.routes[0]!.frequency).toBe(22)
    expectRejected(
      applyCommand(r.state, { type: 'set_frequency', routeId, frequency: 23 }).events,
      'frequency must be 1..22',
    )
    // Assigning the second Meridian doubles the ceiling.
    r = applyCommand(r.state, { type: 'assign_aircraft', aircraftId: 2, routeId })
    r = applyCommand(r.state, { type: 'set_frequency', routeId, frequency: 44 })
    expect(r.state.airlines[0]!.routes[0]!.frequency).toBe(44)
  })

  it('canonicalizes the pair ordering', () => {
    const { state } = applyCommand(fresh(), {
      type: 'open_route',
      from: 'ORD',
      to: 'JFK',
      aircraftId: 1,
      frequency: 5,
    })
    expect(state.airlines[0]!.routes[0]).toMatchObject({ from: 'JFK', to: 'ORD' })
  })

  it('rejects routes without slots at both ends', () => {
    const { events } = applyCommand(fresh(), {
      type: 'open_route',
      from: 'JFK',
      to: 'LHR',
      aircraftId: 1,
      frequency: 5,
    })
    expectRejected(events, 'no free slots')
  })

  it('rejects duplicate routes', () => {
    const first = applyCommand(fresh(), { type: 'open_route', from: 'JFK', to: 'ORD', aircraftId: 1, frequency: 5 })
    const second = applyCommand(first.state, {
      type: 'open_route',
      from: 'ORD',
      to: 'JFK',
      aircraftId: 2,
      frequency: 5,
    })
    expectRejected(second.events, 'already open')
  })

  it('rejects unknown cities and self-routes', () => {
    expectRejected(
      applyCommand(fresh(), { type: 'open_route', from: 'JFK', to: 'XXX', aircraftId: 1, frequency: 5 }).events,
      'invalid city pair',
    )
    expectRejected(
      applyCommand(fresh(), { type: 'open_route', from: 'JFK', to: 'JFK', aircraftId: 1, frequency: 5 }).events,
      'invalid city pair',
    )
  })

  it('rejects a launch beyond the aircraft range', () => {
    const state = fresh()
    state.airlines[0]!.slots['LHR'] = 2 // grant a transatlantic foothold
    // Meridian 80 range 3000km < JFK-LHR 5541km.
    const opened = applyCommand(state, { type: 'open_route', from: 'JFK', to: 'LHR', aircraftId: 1, frequency: 3 })
    expectRejected(opened.events, 'range')
  })

  it('closing a route unassigns its aircraft', () => {
    let r = applyCommand(fresh(), { type: 'open_route', from: 'JFK', to: 'ORD', aircraftId: 1, frequency: 5 })
    const routeId = r.state.airlines[0]!.routes[0]!.id
    expect(r.state.airlines[0]!.fleet[0]!.routeId).toBe(routeId)
    r = applyCommand(r.state, { type: 'close_route', routeId })
    expect(r.state.airlines[0]!.routes).toHaveLength(0)
    expect(r.state.airlines[0]!.fleet[0]!.routeId).toBeNull()
  })

  it('orders deduct cash and reject when unaffordable or off-sale', () => {
    // 1960: Titan 420 (1972+) is not on sale yet.
    expectRejected(applyCommand(fresh(), { type: 'order_aircraft', aircraftType: 'titan420' }).events, 'not on sale')
    // Two Meridians are affordable from 18000, the third is not (3 × 6800).
    let r = applyCommand(fresh(), { type: 'order_aircraft', aircraftType: 'meridian80' })
    expect(r.state.airlines[0]!.cash).toBe(18000 - 6800)
    r = applyCommand(r.state, { type: 'order_aircraft', aircraftType: 'meridian80' })
    const third = applyCommand(r.state, { type: 'order_aircraft', aircraftType: 'meridian80' })
    expectRejected(third.events, 'insufficient cash')
  })

  it('enforces the debt ceiling and clamps repayment', () => {
    const state = fresh()
    // Ceiling: 2 × Meridian resale (6800 × 88% = 5984) × 60% + 20000 = 27180.
    const over = applyCommand(state, { type: 'take_loan', amount: 29000 })
    expectRejected(over.events, 'debt ceiling')
    let r = applyCommand(state, { type: 'take_loan', amount: 10000 })
    expect(r.state.airlines[0]!.loans).toHaveLength(1)
    expect(r.state.airlines[0]!.cash).toBe(28000)
    const loanId = r.state.airlines[0]!.loans[0]!.id
    // Repay more than the principal: clamps to the principal.
    r = applyCommand(r.state, { type: 'repay_loan', loanId, amount: 15000 })
    expect(r.state.airlines[0]!.loans).toHaveLength(0)
    expect(r.state.airlines[0]!.cash).toBe(18000)
  })

  it('validates negotiation spend and prevents doubling up', () => {
    expectRejected(
      applyCommand(fresh(), { type: 'negotiate_slots', city: 'LHR', spend: 50 }).events,
      'at least',
    )
    const r = applyCommand(fresh(), { type: 'negotiate_slots', city: 'LHR', spend: 1000 })
    expect(r.state.airlines[0]!.cash).toBe(17000)
    const again = applyCommand(r.state, { type: 'negotiate_slots', city: 'LHR', spend: 1000 })
    expectRejected(again.events, 'already negotiating')
  })

  it('selling an aircraft returns its depreciated resale value', () => {
    const state = fresh()
    const aircraftId = state.airlines[0]!.fleet[0]!.id
    const { state: after, events } = applyCommand(state, { type: 'sell_aircraft', aircraftId })
    // Age 0 → 88% of the 6800 list price: planes depreciate on delivery.
    expect(events[0]).toMatchObject({ type: 'aircraft_sold', proceeds: 5984 })
    expect(after.airlines[0]!.fleet).toHaveLength(1)
    expect(after.airlines[0]!.cash).toBe(18000 + 5984)
  })

  it('refitting a cabin validates, charges cash, and sticks', () => {
    const state = fresh()
    expectRejected(applyCommand(state, { type: 'refit_cabin', aircraftId: 1, cabin: 7 }).events, 'cabin must be')
    expectRejected(applyCommand(state, { type: 'refit_cabin', aircraftId: 1, cabin: 2 }).events, 'already in')
    expectRejected(applyCommand(state, { type: 'refit_cabin', aircraftId: 999, cabin: 3 }).events, 'no such aircraft')
    const { state: after, events } = applyCommand(state, { type: 'refit_cabin', aircraftId: 1, cabin: 3 })
    expect(events[0]).toMatchObject({ type: 'cabin_refit', aircraftId: 1, cabin: 3 })
    expect(after.airlines[0]!.fleet[0]!.cabin).toBe(3)
    if (events[0]?.type === 'cabin_refit') {
      expect(events[0].cost).toBeGreaterThan(0)
      expect(after.airlines[0]!.cash).toBe(18000 - events[0].cost)
    }
  })

  it('never mutates the input state', () => {
    const state = fresh()
    const snapshot = JSON.stringify(state)
    applyCommand(state, { type: 'open_route', from: 'JFK', to: 'ORD', aircraftId: 1, frequency: 5 })
    applyCommand(state, { type: 'end_quarter' })
    expect(JSON.stringify(state)).toBe(snapshot)
  })
})
