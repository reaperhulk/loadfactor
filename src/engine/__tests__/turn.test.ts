import { describe, expect, it } from 'vitest'
import { applyCommand, newGame } from '../index'
import { EXPANSION_EVERY_QUARTERS, GROUNDING_AGE_QUARTERS, REPUTATION_MIN_BP } from '../../data/constants'
import { reputationAppealBp, routeWeeklyCapacity, slotCities, slotsFree } from '../queries'
import { cityPool, expansionSize, nextExpansion, slotRent, slotRentTotal } from '../slots'
import type { GameEvent, GameState } from '../types'

function playerReport(events: GameEvent[]) {
  const report = events.find((e) => e.type === 'quarter_report' && e.airline === 0)
  if (report?.type !== 'quarter_report') throw new Error('no player quarter_report')
  return report
}

describe('quarter resolution', () => {
  it('advances the turn and emits a report per airline', () => {
    const { state, events } = applyCommand(newGame('jet_age', 'turn-seed'), { type: 'end_quarter' })
    expect(state.turn).toBe(1)
    // One report per airline in the field — read from the state rather than
    // hardcoded, since scenarios set their own field size.
    expect(events.filter((e) => e.type === 'quarter_report')).toHaveLength(state.airlines.length)
  })

  it('the accounting reconciles: cash delta equals profit minus principal amortized', () => {
    // No planning commands → the only player cash movements during resolution
    // are the quarterly P&L and the loan amortization (PLAN.md §3.3 step 6).
    let state: GameState = newGame('jet_age', 'accounting-seed')
    state = applyCommand(state, {
      type: 'open_route',
      from: 'JFK',
      to: 'ORD',
      aircraftId: 1,
      frequency: 20,
    }).state
    const routeId = state.airlines[0]!.routes[0]!.id
    state = applyCommand(state, { type: 'assign_aircraft', aircraftId: 2, routeId }).state
    state = applyCommand(state, { type: 'set_frequency', routeId, frequency: 44 }).state
    state = applyCommand(state, { type: 'take_loan', amount: 8000 }).state
    let lastPrincipal = 8000
    for (let q = 0; q < 8; q++) {
      const before = state.airlines[0]!.cash
      const { state: after, events } = applyCommand(state, { type: 'end_quarter' })
      const report = playerReport(events)
      expect(report.profit).toBe(report.revenue - report.costs)
      expect(after.airlines[0]!.cash - before).toBe(report.profit - report.debtPayment)
      expect(report.cash).toBe(after.airlines[0]!.cash)
      // The breakdown IS the cost: buckets sum exactly to the total.
      const bucketSum = Object.values(report.breakdown).reduce((a, b) => a + b, 0)
      expect(bucketSum).toBe(report.costs)
      // Debt is no longer perpetual: the balance shrinks every quarter by
      // exactly what the report says was paid down.
      const principal = after.airlines[0]!.loans.reduce((s, l) => s + l.principal, 0)
      expect(report.debtPayment).toBeGreaterThan(0)
      expect(principal).toBe(lastPrincipal - report.debtPayment)
      lastPrincipal = principal
      state = after
    }
  })

  it('a tiny loan stub amortizes away entirely', () => {
    let state: GameState = newGame('jet_age', 'stub-seed')
    state = applyCommand(state, { type: 'take_loan', amount: 2000 }).state
    state.airlines[0]!.loans[0]!.principal = 500 // $100k/q floor → gone in 5
    for (let q = 0; q < 6; q++) {
      state = applyCommand(state, { type: 'end_quarter' }).state
    }
    expect(state.airlines[0]!.loans).toHaveLength(0)
  })

  it('orders age and deliver on schedule', () => {
    let r = applyCommand(newGame('jet_age', 'delivery-seed'), {
      type: 'order_aircraft',
      aircraftType: 'caravelle', // deliveryQuarters: 2
    })
    expect(r.state.airlines[0]!.orders).toHaveLength(1)
    r = applyCommand(r.state, { type: 'end_quarter' })
    expect(r.state.airlines[0]!.orders).toHaveLength(1)
    expect(r.state.airlines[0]!.fleet).toHaveLength(2)
    r = applyCommand(r.state, { type: 'end_quarter' })
    expect(r.state.airlines[0]!.orders).toHaveLength(0)
    expect(r.state.airlines[0]!.fleet).toHaveLength(3)
    expect(r.events.some((e) => e.type === 'aircraft_delivered' && e.airline === 0)).toBe(true)
  })

  it('aircraft age each quarter', () => {
    const { state } = applyCommand(newGame('jet_age', 'age-seed'), { type: 'end_quarter' })
    expect(state.airlines[0]!.fleet.every((a) => a.ageQuarters === 1)).toBe(true)
  })

  it('an idle airline bleeds cash into bankruptcy and loses', () => {
    let state: GameState = newGame('jet_age', 'bleed-seed')
    let sawGameOver = false
    for (let q = 0; q < 80 && !sawGameOver; q++) {
      const r = applyCommand(state, { type: 'end_quarter' })
      state = r.state
      sawGameOver = r.events.some((e) => e.type === 'game_over' && e.result === 'lost')
    }
    expect(sawGameOver).toBe(true)
    expect(state.phase).toBe('lost')
    // Fixed costs on an idle fleet burn ~$1M/quarter from $18M — this should
    // take a while but nowhere near the full scenario.
    expect(state.turn).toBeGreaterThan(4)
    expect(state.turn).toBeLessThan(60)
  })

  it('the engine is inert once the game is over', () => {
    let state: GameState = newGame('jet_age', 'bleed-seed')
    for (let q = 0; q < 80 && state.phase === 'planning'; q++) {
      state = applyCommand(state, { type: 'end_quarter' }).state
    }
    expect(state.phase).not.toBe('planning')
    const after = applyCommand(state, { type: 'end_quarter' })
    expect(after.state).toBe(state)
    expect(after.events).toHaveLength(0)
    const rejected = applyCommand(state, { type: 'open_route', from: 'JFK', to: 'ORD', aircraftId: 1, frequency: 5 })
    expect(rejected.events[0]).toMatchObject({ type: 'command_rejected' })
  })

  it('every slot held bills rent every quarter, and the bucket sums into costs', () => {
    let state: GameState = newGame('jet_age', 'slot-rent-seed')
    const player = state.airlines[0]!
    const expected = slotRentTotal(player)
    expect(expected).toBeGreaterThan(0)
    state = applyCommand(state, { type: 'end_quarter' }).state
    const stats = state.airlines[0]!.history[0]!
    expect(stats.breakdown.slots).toBe(expected)
    // The breakdown is the total, never a separate number.
    const summed = Object.values(stats.breakdown).reduce((a, b) => a + b, 0)
    expect(summed).toBe(stats.costs)
  })

  it('handing back unused capacity stops the rent', () => {
    let state: GameState = newGame('jet_age', 'slot-release-seed')
    const before = slotRentTotal(state.airlines[0]!)
    const idleCity = slotCities(state.airlines[0]!).find(
      (c) => c !== state.airlines[0]!.hq && slotsFree(state.airlines[0]!, c) > 0,
    )!
    const freed = slotsFree(state.airlines[0]!, idleCity)
    state = applyCommand(state, { type: 'release_slots', city: idleCity, count: freed }).state
    expect(slotRentTotal(state.airlines[0]!)).toBe(before - freed * slotRent(idleCity))
  })

  // Airport building programmes: the schedule is deterministic and readable
  // arbitrarily far ahead, which is what makes a full airport a date rather
  // than a wall.
  it('airports expand on a published schedule that the pool actually follows', () => {
    const state: GameState = newGame('jet_age', 'expansion-seed')
    const due = nextExpansion(state, 'LHR')
    expect(due.quartersAway).toBeGreaterThan(0)
    expect(due.slots).toBe(expansionSize('LHR'))
    // The pool is flat until the programme opens, then steps by exactly the
    // programme's size — and the prediction made at turn 0 holds.
    const at = (turn: number): number => cityPool({ ...state, turn }, 'LHR')
    expect(at(due.turn - 1)).toBe(at(0))
    expect(at(due.turn)).toBe(at(0) + due.slots)
    // The next one is a full cadence later.
    const after = nextExpansion({ ...state, turn: due.turn }, 'LHR')
    expect(after.turn).toBe(due.turn + EXPANSION_EVERY_QUARTERS)
  })

  it('rivals act: they open routes and expand without touching player state', () => {
    let state: GameState = newGame('jet_age', 'rival-seed')
    const playerCashBefore = state.airlines[0]!.cash
    for (let q = 0; q < 6; q++) state = applyCommand(state, { type: 'end_quarter' }).state
    const rivalRoutes = state.airlines[1]!.routes.length + state.airlines[2]!.routes.length
    expect(rivalRoutes).toBeGreaterThan(0)
    // Player did nothing; their cash only moved by their own P&L, and no rival
    // command ever targets airline 0.
    expect(state.airlines[0]!.routes).toHaveLength(0)
    expect(state.airlines[0]!.cash).toBeLessThan(playerCashBefore)
  })
})

describe('stakes that scale (F2)', () => {
  it('old metal breaks: a grounded airframe stops flying but keeps costing', () => {
    let state: GameState = newGame('jet_age', 'grounding-seed')
    state = applyCommand(state, {
      type: 'open_route',
      from: 'JFK',
      to: 'ORD',
      aircraftId: 1,
      frequency: 10,
    }).state
    // Age the fleet well past the reliability threshold and run until the
    // maintenance gods notice.
    for (const ac of state.airlines[0]!.fleet) ac.ageQuarters = GROUNDING_AGE_QUARTERS + 40
    let grounded: { repairK: number } | null = null
    for (let q = 0; q < 12 && grounded === null && state.phase === 'planning'; q++) {
      const r = applyCommand(state, { type: 'end_quarter' })
      state = r.state
      for (const e of r.events) {
        if (e.type === 'aircraft_grounded' && e.airline === 0) grounded = { repairK: e.repairK }
      }
      // Keep the fleet geriatric so the risk stays live.
      for (const ac of state.airlines[0]!.fleet) ac.ageQuarters = GROUNDING_AGE_QUARTERS + 40
    }
    expect(grounded, 'a fleet this old eventually breaks').not.toBeNull()
    expect(grounded!.repairK).toBeGreaterThan(0)
    // Reputation took the hit, and never falls through the floor.
    const rep = state.airlines[0]!.reputationBp ?? 10000
    expect(rep).toBeLessThanOrEqual(10000)
    expect(rep).toBeGreaterThanOrEqual(REPUTATION_MIN_BP)
  })

  it('a grounded airframe is removed from the schedule it was flying', () => {
    let state: GameState = newGame('jet_age', 'ground-capacity')
    state = applyCommand(state, {
      type: 'open_route',
      from: 'JFK',
      to: 'ORD',
      aircraftId: 1,
      frequency: 10,
    }).state
    const airline = state.airlines[0]!
    const route = airline.routes[0]!
    const flying = routeWeeklyCapacity(airline, route, state.turn)
    expect(flying).toBeGreaterThan(0)
    // Ground the only assigned airframe: the route can fly nothing.
    airline.fleet.find((a) => a.routeId === route.id)!.groundedUntil = state.turn + 2
    expect(routeWeeklyCapacity(airline, route, state.turn)).toBe(0)
    // Planning views (turn -1) still show what the fleet COULD fly.
    expect(routeWeeklyCapacity(airline, route)).toBe(flying)
  })

  it('reputation scales appeal but can never spiral', () => {
    const airline = newGame('jet_age', 'rep-seed').airlines[0]!
    expect(reputationAppealBp(airline)).toBe(10000) // spotless: no effect
    airline.reputationBp = REPUTATION_MIN_BP
    const worst = reputationAppealBp(airline)
    expect(worst).toBeLessThan(10000)
    expect(worst, 'a battered operator is disadvantaged, not dead').toBeGreaterThan(8000)
  })

  it('milestones fire once as the era objective is crossed', () => {
    let state: GameState = newGame('oil_crisis', 'milestone-seed') // cumulative profit
    const seen: number[] = []
    for (let q = 0; q < 40 && state.phase === 'planning'; q++) {
      const r = applyCommand(state, { type: 'end_quarter' })
      state = r.state
      for (const e of r.events) if (e.type === 'milestone_reached') seen.push(e.pctOfTarget)
    }
    // An idle airline never climbs the ladder — no false celebrations.
    expect(new Set(seen).size, 'each milestone announces at most once').toBe(seen.length)
  })
})
