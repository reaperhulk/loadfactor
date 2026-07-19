import { describe, expect, it } from 'vitest'
import { applyCommand, newGame } from '../index'
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
    expect(events.filter((e) => e.type === 'quarter_report')).toHaveLength(3)
  })

  it('the accounting reconciles: cash delta equals reported profit', () => {
    // No planning commands → the only player cash movement during resolution
    // is the quarterly P&L (PLAN.md §3.3 step 6).
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
    for (let q = 0; q < 8; q++) {
      const before = state.airlines[0]!.cash
      const { state: after, events } = applyCommand(state, { type: 'end_quarter' })
      const report = playerReport(events)
      expect(report.profit).toBe(report.revenue - report.costs)
      expect(after.airlines[0]!.cash - before).toBe(report.profit)
      expect(report.cash).toBe(after.airlines[0]!.cash)
      state = after
    }
  })

  it('orders age and deliver on schedule', () => {
    let r = applyCommand(newGame('jet_age', 'delivery-seed'), {
      type: 'order_aircraft',
      aircraftType: 'meridian80', // deliveryQuarters: 2
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

  it('idle slots are reclaimed after four consecutive idle quarters, HQ exempt', () => {
    let state: GameState = newGame('jet_age', 'slot-decay-seed')
    // ORD starts with 4 slots and no routes: ≥2 free every quarter. The HQ
    // (JFK, 8 free) is exempt no matter how idle it sits.
    const hq = state.airlines[0]!.hq
    const hqSlotsBefore = state.airlines[0]!.slots[hq]!
    let lost: string[] = []
    for (let q = 0; q < 4; q++) {
      const r = applyCommand(state, { type: 'end_quarter' })
      state = r.state
      lost = lost.concat(
        r.events.filter((e) => e.type === 'slot_lost' && e.airline === 0).map((e) => (e.type === 'slot_lost' ? e.city : '')),
      )
    }
    expect(lost).toContain('ORD')
    expect(lost).not.toContain(hq)
    expect(state.airlines[0]!.slots['ORD']).toBe(3)
    expect(state.airlines[0]!.slots[hq]).toBe(hqSlotsBefore)
    // The counter resets after a loss — nothing else goes for another 3 quarters.
    expect(state.airlines[0]!.slotIdle['ORD']).toBeUndefined()
  })

  it('using slots resets the idle counter', () => {
    let state: GameState = newGame('jet_age', 'slot-use-seed')
    // Two idle quarters at MIA (2 slots, none used), then a route drops the
    // free count below the threshold — the counter clears and stays clear.
    for (let q = 0; q < 2; q++) state = applyCommand(state, { type: 'end_quarter' }).state
    expect(state.airlines[0]!.slotIdle['MIA']).toBe(2)
    state = applyCommand(state, {
      type: 'open_route',
      from: 'JFK',
      to: 'MIA',
      aircraftId: 1,
      frequency: 10,
    }).state
    for (let q = 0; q < 4; q++) {
      const r = applyCommand(state, { type: 'end_quarter' })
      state = r.state
      expect(r.events.some((e) => e.type === 'slot_lost' && e.airline === 0 && e.city === 'MIA')).toBe(false)
    }
    expect(state.airlines[0]!.slotIdle['MIA']).toBeUndefined()
    expect(state.airlines[0]!.slots['MIA']).toBe(2)
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
