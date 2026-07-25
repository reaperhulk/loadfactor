import { describe, expect, it } from 'vitest'
import { SLOTS_PER_GRANT } from '../../data/constants'
import { applyCommand, newGame, type GameEvent, type GameState } from '../index'
import { applyPlanningCommand } from '../commands'
import { currentLoanRateBp } from '../queries'
import { cityPool, resolveSlotRequests, slotFee, slotQueue } from '../slots'

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
    // Sud Caravelle tops out at 22 round trips/week on JFK-ORD.
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
    // Assigning the second Caravelle doubles the ceiling.
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
    // Sud Caravelle range 3000km < JFK-LHR 5541km.
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
    // 1960: Boeing 747-200B (1972+) is not on sale yet.
    expectRejected(applyCommand(fresh(), { type: 'order_aircraft', aircraftType: 'b747_200' }).events, 'not on sale')
    // Two Caravelles are affordable from 18000, the third is not (3 × 6800).
    let r = applyCommand(fresh(), { type: 'order_aircraft', aircraftType: 'caravelle' })
    expect(r.state.airlines[0]!.cash).toBe(18000 - 6800)
    r = applyCommand(r.state, { type: 'order_aircraft', aircraftType: 'caravelle' })
    const third = applyCommand(r.state, { type: 'order_aircraft', aircraftType: 'caravelle' })
    expectRejected(third.events, 'insufficient cash')
  })

  it('enforces the debt ceiling and clamps repayment', () => {
    const state = fresh()
    // Ceiling: 2 × Caravelle resale (6800 × 88% = 5984) × 60% + 20000 = 27180.
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

  it('a slot request charges the fee once and cannot be doubled up', () => {
    const start = fresh().airlines[0]!.cash
    const r = applyCommand(fresh(), { type: 'request_slots', city: 'LHR' })
    expect(r.state.airlines[0]!.cash).toBe(start - slotFee('LHR'))
    expect(r.state.airlines[0]!.slotRequests).toMatchObject([{ city: 'LHR', queuedTurn: 0 }])
    const again = applyCommand(r.state, { type: 'request_slots', city: 'LHR' })
    expectRejected(again.events, 'already queued')
    // Leaving the list returns the fee in full — the cost of a queue that
    // went nowhere is the quarters, never the money.
    const out = applyCommand(r.state, { type: 'cancel_slot_request', city: 'LHR' })
    expect(out.state.airlines[0]!.cash).toBe(start)
    expect(out.state.airlines[0]!.slotRequests).toHaveLength(0)
    expectRejected(applyCommand(out.state, { type: 'cancel_slot_request', city: 'LHR' }).events, 'not queued')
  })

  it('releasing slots stops the rent but never takes slots a route is flying', () => {
    const state = fresh()
    const idle = state.airlines[0]!.fleet.find((a) => a.routeId === null)!
    const flying = applyCommand(state, {
      type: 'open_route',
      from: 'JFK',
      to: 'ORD',
      aircraftId: idle.id,
      frequency: 5,
    }).state
    const held = flying.airlines[0]!.slots['ORD']!
    expectRejected(
      applyCommand(flying, { type: 'release_slots', city: 'ORD', count: held }).events,
      'in use',
    )
    expectRejected(
      applyCommand(flying, { type: 'release_slots', city: flying.airlines[0]!.hq, count: 1 }).events,
      'home base',
    )
    const freed = applyCommand(flying, { type: 'release_slots', city: 'ORD', count: held - 1 })
    expect(freed.state.airlines[0]!.slots['ORD']).toBe(1)
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

  it('routes must connect to the network: HQ or a served city', () => {
    // MIA–YYZ touches neither JFK (HQ) nor any served city — rejected.
    const state = fresh()
    const rejected = applyCommand(state, { type: 'open_route', from: 'MIA', to: 'YYZ', aircraftId: 1, frequency: 5 })
    expectRejected(rejected.events, 'must connect to your network')
    // JFK–MIA touches the HQ; after it, MIA–YYZ touches served MIA — allowed.
    const s = applyCommand(state, { type: 'open_route', from: 'JFK', to: 'MIA', aircraftId: 1, frequency: 5 }).state
    const r2 = applyCommand(s, { type: 'open_route', from: 'MIA', to: 'YYZ', aircraftId: 2, frequency: 5 })
    expect(r2.events[0]).toMatchObject({ type: 'route_opened', from: 'MIA', to: 'YYZ' })
  })

  it('cancelling an order refunds most of the price; leases cancel free', () => {
    let r = applyCommand(fresh(), { type: 'order_aircraft', aircraftType: 'caravelle' })
    const orderId = r.state.airlines[0]!.orders[0]!.id
    expectRejected(applyCommand(r.state, { type: 'cancel_order', orderId: 999 }).events, 'no such order')
    r = applyCommand(r.state, { type: 'cancel_order', orderId })
    expect(r.events[0]).toMatchObject({ type: 'order_cancelled', refund: 5440 }) // 80% of 6800
    expect(r.state.airlines[0]!.orders).toHaveLength(0)
    expect(r.state.airlines[0]!.cash).toBe(18000 - 6800 + 5440)
    // A leased order paid nothing up front and refunds nothing.
    let l = applyCommand(fresh(), { type: 'lease_aircraft', aircraftType: 'caravelle' })
    const leaseId = l.state.airlines[0]!.orders[0]!.id
    l = applyCommand(l.state, { type: 'cancel_order', orderId: leaseId })
    expect(l.events[0]).toMatchObject({ type: 'order_cancelled', refund: 0 })
    expect(l.state.airlines[0]!.cash).toBe(18000)
  })

  it('acquire_rival: only distressed rivals sell, and everything transfers', () => {
    // A healthy equal is not for sale.
    expectRejected(applyCommand(fresh(), { type: 'acquire_rival', target: 1 }).events, 'not for sale')
    expectRejected(applyCommand(fresh(), { type: 'acquire_rival', target: 0 }).events, 'no such rival')

    // Distress the rival and give it an operation worth absorbing.
    const state = fresh()
    const rival = state.airlines[1]!
    rival.insolventQuarters = 1
    rival.slots['FRA'] = 2
    rival.routes.push({
      id: rival.nextId++,
      from: 'FRA',
      to: 'LHR',
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
    rival.fleet[0]!.routeId = rival.routes[0]!.id
    rival.loans.push({ id: rival.nextId++, principal: 4000, annualRateBp: 800 })
    state.airlines[0]!.cash = 60000

    const before = state.airlines[0]!
    const myFleet = before.fleet.length
    const myRoutes = before.routes.length
    const { state: after, events } = applyCommand(state, { type: 'acquire_rival', target: 1 })
    const me = after.airlines[0]!
    const shell = after.airlines[1]!
    expect(events[0]).toMatchObject({ type: 'rival_acquired', target: 1, routes: 1 })
    expect(shell.bankrupt).toBe(true)
    expect(shell.fleet).toHaveLength(0)
    expect(me.fleet).toHaveLength(myFleet + 2) // rival starter fleet came along
    expect(me.routes).toHaveLength(myRoutes + 1)
    expect(me.slots['FRA']).toBeGreaterThanOrEqual(2)
    expect(me.loans.some((l) => l.principal === 4000)).toBe(true) // the debt came too
    if (events[0]?.type === 'rival_acquired') {
      expect(me.cash).toBe(60000 - events[0].price)
    }
    // Transferred metal points at the TRANSFERRED route id, not the old one.
    const movedRoute = me.routes[me.routes.length - 1]!
    const movedPlane = me.fleet.find((a) => a.routeId === movedRoute.id)
    expect(movedPlane).toBeDefined()
    // All ids stay unique within the acquirer.
    const ids = [...me.fleet.map((a) => a.id), ...me.routes.map((r) => r.id), ...me.loans.map((l) => l.id)]
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('acquire_rival: the player is never for sale, even when distressed', () => {
    const state = fresh()
    state.airlines[0]!.insolventQuarters = 2
    state.airlines[0]!.cash = 0
    state.airlines[1]!.cash = 999_999
    const { events } = applyPlanningCommand(state, 1, { type: 'acquire_rival', target: 0 })
    expectRejected(events, 'cannot be acquired')
    expect(state.airlines[0]!.bankrupt).toBe(false)
  })

  it('the waiting list is served in order, and holds its place when the pool is full', () => {
    const state = fresh()
    // Fill LHR to the brim, then queue three carriers behind it.
    const pool = cityPool(state, 'LHR')
    state.airlines[1]!.slots['LHR'] = pool - (state.airlines[0]!.slots['LHR'] ?? 0)
    state.airlines[0]!.slotRequests.push({ city: 'LHR', fee: slotFee('LHR'), queuedTurn: 0 })
    state.airlines[2]!.slotRequests.push({ city: 'LHR', fee: slotFee('LHR'), queuedTurn: 0 })
    state.turn = 2
    const events: GameEvent[] = []
    resolveSlotRequests(state, events)
    // Nobody is served and nobody is thrown off: capacity simply is not there.
    expect(events).toHaveLength(0)
    expect(state.airlines[0]!.slotRequests).toHaveLength(1)
    expect(slotQueue(state, 'LHR').map((q) => q.airline)).toEqual([0, 2])

    // The authority builds. The earliest place in line takes the capacity.
    state.airlines[1]!.slots['LHR'] -= SLOTS_PER_GRANT
    resolveSlotRequests(state, events)
    expect(events.filter((e) => e.type === 'slots_granted')).toMatchObject([
      { airline: 0, city: 'LHR', slots: SLOTS_PER_GRANT, waited: 2 },
    ])
    expect(slotQueue(state, 'LHR').map((q) => q.airline)).toEqual([2])
  })

  it('a request waits a full quarter before the list will look at it', () => {
    const state = fresh()
    state.airlines[0]!.slotRequests.push({ city: 'LHR', fee: slotFee('LHR'), queuedTurn: 0 })
    const events: GameEvent[] = []
    resolveSlotRequests(state, events) // same quarter it was placed
    expect(events).toHaveLength(0)
    state.turn = 1
    resolveSlotRequests(state, events)
    expect(events).toMatchObject([{ type: 'slots_granted', airline: 0, city: 'LHR' }])
  })

  it('loan rates follow the economy: booms borrow cheaper than busts', () => {
    const state = fresh()
    const boom = structuredClone(state)
    boom.world.economyBp = 11000
    const bust = structuredClone(state)
    bust.world.economyBp = 9000
    expect(currentLoanRateBp(boom)).toBeLessThan(currentLoanRateBp(bust))
    // The quoted rate is exactly what take_loan books.
    const { state: after, events } = applyCommand(bust, { type: 'take_loan', amount: 2000 })
    const quoted = currentLoanRateBp(bust)
    expect(events[0]).toMatchObject({ type: 'loan_taken', annualRateBp: quoted })
    expect(after.airlines[0]!.loans[0]!.annualRateBp).toBe(quoted)
  })

  it('marketing level validates 0..3 and sticks on the airline', () => {
    expectRejected(applyCommand(fresh(), { type: 'set_marketing', level: 4 }).events, 'marketing level must be 0..3')
    expectRejected(applyCommand(fresh(), { type: 'set_marketing', level: -1 }).events, 'marketing level')
    expectRejected(applyCommand(fresh(), { type: 'set_marketing', level: 1.5 }).events, 'marketing level')
    const { state, events } = applyCommand(fresh(), { type: 'set_marketing', level: 2 })
    expect(events[0]).toMatchObject({ type: 'marketing_set', level: 2 })
    expect(state.airlines[0]!.marketing).toBe(2)
    // Setting the level costs nothing up front — the spend lands in the
    // quarterly P&L, not at the moment of the decision.
    expect(state.airlines[0]!.cash).toBe(18000)
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

  it('player customization: name, HQ, and derived footholds ride the replay', () => {
    const custom = newGame('jet_age', 'custom-seed', { name: 'Pan Galactic', hq: 'LAX' })
    const me = custom.airlines[0]!
    expect(me.name).toBe('Pan Galactic')
    expect(me.hq).toBe('LAX')
    expect(me.slots['LAX']).toBe(8) // scenario hqSlots follow the new home
    // Footholds derive near the HQ: three cities, strongest gets 4 slots,
    // all clear of the ground-competition band.
    const footholds = Object.keys(me.slots).filter((c) => c !== 'LAX')
    expect(footholds).toHaveLength(3)
    expect(Object.values(me.slots).reduce((a, b) => a + b, 0)).toBe(8 + 4 + 2 + 2)
    // Deterministic: the same customization reproduces the same start.
    const again = newGame('jet_age', 'custom-seed', { name: 'Pan Galactic', hq: 'LAX' })
    expect(JSON.stringify(again)).toBe(JSON.stringify(custom))
    // No customization → the authored scenario, untouched.
    expect(newGame('jet_age', 'custom-seed').airlines[0]!.hq).toBe('JFK')
  })

  it('never mutates the input state', () => {
    const state = fresh()
    const snapshot = JSON.stringify(state)
    applyCommand(state, { type: 'open_route', from: 'JFK', to: 'ORD', aircraftId: 1, frequency: 5 })
    applyCommand(state, { type: 'end_quarter' })
    expect(JSON.stringify(state)).toBe(snapshot)
  })
})

describe('world offers (F5)', () => {
  function withOffer(kind: 'capacity_commitment' | 'regulator_slots' | 'fuel_contract'): GameState {
    const state = fresh()
    state.world.offers.push({
      id: 7,
      kind,
      city: kind === 'fuel_contract' ? null : 'LHR',
      expiresTurn: state.turn + 3,
      costK: 1000,
      upkeepK: kind === 'regulator_slots' ? 250 : 0,
      benefitFromTurn: kind === 'capacity_commitment' ? state.turn + 6 : state.turn,
      untilTurn: state.turn + 12,
      slots: kind === 'regulator_slots' ? 3 : 0,
      demandBonusBp: kind === 'capacity_commitment' ? 3500 : 0,
      headline: 'A question',
      detail: 'with a tradeoff',
    })
    return state
  }

  it('accepting pays up front, records the deal, and clears the table', () => {
    const state = withOffer('capacity_commitment')
    const cashBefore = state.airlines[0]!.cash
    const { state: after, events } = applyCommand(state, { type: 'accept_offer', offerId: 7 })
    expect(events[0]).toMatchObject({ type: 'offer_accepted', offerId: 7, costK: 1000 })
    expect(after.airlines[0]!.cash).toBe(cashBefore - 1000)
    expect(after.airlines[0]!.deals).toHaveLength(1)
    expect(after.world.offers).toHaveLength(0) // answered, off the table
  })

  it('regulator slots land immediately and bill every quarter', () => {
    const state = withOffer('regulator_slots')
    const before = state.airlines[0]!.slots['LHR'] ?? 0
    const { state: after, events } = applyCommand(state, { type: 'accept_offer', offerId: 7 })
    expect(after.airlines[0]!.slots['LHR']).toBe(before + 3)
    expect(events.some((e) => e.type === 'slots_granted' && e.city === 'LHR')).toBe(true)
    expect(after.airlines[0]!.deals![0]!.upkeepK).toBe(250)
  })

  it('a fuel contract becomes the running hedge', () => {
    const state = withOffer('fuel_contract')
    const { state: after } = applyCommand(state, { type: 'accept_offer', offerId: 7 })
    expect(after.airlines[0]!.fuelHedge).not.toBeNull()
    expect(after.airlines[0]!.fuelHedge!.quartersLeft).toBe(12)
  })

  it('declining clears the offer without charging, and an answered offer cannot be answered twice', () => {
    const state = withOffer('capacity_commitment')
    const cashBefore = state.airlines[0]!.cash
    const { state: after, events } = applyCommand(state, { type: 'decline_offer', offerId: 7 })
    expect(events[0]).toMatchObject({ type: 'offer_declined', offerId: 7 })
    expect(after.airlines[0]!.cash).toBe(cashBefore)
    expect(after.world.offers).toHaveLength(0)
    expectRejected(applyCommand(after, { type: 'accept_offer', offerId: 7 }).events, 'no longer on the table')
  })

  it('an offer you cannot afford is rejected, not silently half-applied', () => {
    const state = withOffer('capacity_commitment')
    state.airlines[0]!.cash = 10
    const { state: after, events } = applyCommand(state, { type: 'accept_offer', offerId: 7 })
    expectRejected(events, 'not enough cash')
    expect(after.airlines[0]!.cash).toBe(10)
    expect(after.world.offers).toHaveLength(1) // still on the table
  })

  it('an unanswered offer lapses on its deadline', () => {
    let state = withOffer('capacity_commitment')
    let expired = false
    for (let q = 0; q < 4 && !expired; q++) {
      const r = applyCommand(state, { type: 'end_quarter' })
      state = r.state
      expired = r.events.some((e) => e.type === 'offer_expired' && e.offerId === 7)
    }
    expect(expired, 'the world does not wait forever').toBe(true)
    expect(state.world.offers.some((o) => o.id === 7)).toBe(false)
  })
})
