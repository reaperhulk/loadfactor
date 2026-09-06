import { describe, expect, it } from 'vitest'
import { applyCommand, applyCommandBatch, newGame, runReplay } from '../index'
import { recurringFinancials } from '../accounting'
import { forecastQuarter } from '../forecast'
import { resolveMarket } from '../market'
import { checkInvariants } from '../invariants'
import {
  aircraftOperations,
  checkDueIn,
  QUARTER_MINUTES,
  resolveOperations,
  WEEK_MINUTES,
} from '../operations'
import type { Command, GameState } from '../types'

function network(spares = 0) {
  let s = newGame('jet_age', 'operations-v3')
  s = applyCommand(s, { type: 'open_route', from: 'JFK', to: 'ORD', aircraftId: 1, frequency: 16 }).state
  const a = s.airlines[0]!
  a.fleet = a.fleet.slice(0, 1)
  for (let i = 0; i < spares; i++)
    a.fleet.push({ ...structuredClone(a.fleet[0]!), id: a.nextId++, routeId: null, reserve: true })
  return s
}
const repair = (s: GameState, id = 1, days = 3) => ({
  aircraftId: id,
  start: s.turn * QUARTER_MINUTES + 4 * WEEK_MINUTES,
  end: s.turn * QUARTER_MINUTES + 4 * WEEK_MINUTES + days * 1440,
  cost: 50,
})

describe('fractional operations', () => {
  it('a short repair loses a few trips, not a quarter, and next quarter restores the schedule', () => {
    const s = network(),
      a = s.airlines[0]!
    const r = resolveOperations(s, a, 'actual', [repair(s)])
    expect(r.summary.cancelledTrips).toBeGreaterThan(0)
    expect(r.summary.cancelledTrips).toBeLessThan(12)
    expect(r.summary.completedTrips + r.summary.cancelledTrips).toBe(16 * 13)
    expect(r.summary.availabilityBp).toBeGreaterThan(9600)
    a.fleet[0]!.operations = r.aircraft.get(1)!
    s.turn++
    const next = resolveOperations(s, a, 'actual', [])
    expect(next.summary.cancelledTrips).toBe(0)
    expect(next.summary.completedTrips).toBe(16 * 13)
    expect(a.fleet[0]!.routeId).toBe(a.routes[0]!.id)
  })
  it('compatible standby fully covers a repair, records its wear, and leaves assignments intact', () => {
    const s = network(1),
      a = s.airlines[0]!,
      before = structuredClone(s)
    const r = resolveOperations(s, a, 'actual', [repair(s)])
    expect(r.summary.coveredTrips).toBeGreaterThan(0)
    expect(r.summary.cancelledTrips).toBe(0)
    expect(r.aircraft.get(a.fleet[1]!.id)!.cycles).toBe(r.summary.coveredTrips * 2)
    expect(s).toEqual(before)
    const result = resolveMarket(structuredClone(s), [], new Map([[0, r]]))[0]!
    expect(result.operations!.affectedPassengers).toBe(0)
  })
  it('reputation responds to uncovered passenger disruption, not a covered repair', () => {
    const covered = network(1),
      uncovered = network()
    for (const s of [covered, uncovered]) s.airlines[0]!.fleet[0]!.operations!.repairUntil = 3 * 1440
    const good = applyCommand(covered, { type: 'end_quarter' }).state.airlines[0]!
    const bad = applyCommand(uncovered, { type: 'end_quarter' }).state.airlines[0]!
    expect(good.history.at(-1)!.operations!.coveredTrips).toBeGreaterThan(0)
    expect(good.reputationBp).toBe(10000)
    expect(bad.history.at(-1)!.operations!.affectedPassengers).toBeGreaterThan(0)
    expect(bad.reputationBp).toBeLessThan(10000)
  })
  it('a smaller compatible replacement reports displaced passengers even when every trip flies', () => {
    const s = network(1),
      a = s.airlines[0]!
    a.fleet[0]!.type = 'b747_200'
    a.fleet[1]!.type = 'b747_100'
    const r = resolveOperations(s, a, 'actual', [repair(s)])
    expect(r.summary.cancelledTrips).toBe(0)
    expect(r.summary.routes[0]!.unservedSeats).toBeGreaterThan(0)
    const t = resolveMarket(s, [], new Map([[0, r]]))[0]!
    expect(t.operations!.affectedPassengers).toBeGreaterThan(0)
  })
  it('spare hours cover trips without buying a whole standby aircraft', () => {
    const s = network(1),
      a = s.airlines[0]!
    a.fleet[1]!.reserve = false
    a.fleet[1]!.routeId = a.routes[0]!.id
    const r = resolveOperations(s, a, 'actual', [repair(s)])
    expect(r.summary.coveredTrips).toBeGreaterThan(0)
    expect(r.summary.cancelledTrips).toBe(0)
  })
  it.each(['wrong crew', 'remote base', 'standby in check'])('%s cannot cover a disruption', (reason) => {
    const s = network(1),
      a = s.airlines[0]!,
      spare = a.fleet[1]!
    if (reason === 'wrong crew') spare.type = 'b727'
    if (reason === 'remote base') spare.operations!.base = 'HND'
    if (reason === 'standby in check') {
      spare.operations!.checkStart = repair(s).start
      spare.operations!.checkEnd = repair(s).end
    }
    const r = resolveOperations(s, a, 'actual', [repair(s)])
    expect(r.summary.coveredTrips).toBe(0)
    expect(r.summary.cancelledTrips).toBeGreaterThan(0)
  })
  it('one spare cannot fly two overlapping recoveries or exceed its weekly block hours', () => {
    const s = network(2),
      a = s.airlines[0]!
    a.fleet[1]!.reserve = false
    a.fleet[1]!.routeId = a.routes[0]!.id
    a.routes[0]!.frequency = 32
    const r = resolveOperations(s, a, 'actual', [repair(s, 1, 7), repair(s, a.fleet[1]!.id, 7)])
    expect(r.summary.coveredTrips).toBeGreaterThan(0)
    expect(r.summary.cancelledTrips).toBeGreaterThan(0)
    for (const ac of r.summary.aircraft) expect(ac.flightMinutes).toBeLessThanOrEqual(6000 * 13)
    expect(r.summary.completedTrips + r.summary.cancelledTrips).toBe(r.summary.scheduledTrips)
  })
  it('paid recovery has a hard cap and charges a premium', () => {
    const s = network(),
      a = s.airlines[0]!
    a.operationsPolicy!.recovery = true
    const r = resolveOperations(s, a, 'actual', [{ aircraftId: 1, start: 0, end: QUARTER_MINUTES, cost: 50 }])
    expect(r.summary.charterTrips).toBe(Math.floor((16 * 13) / 10))
    expect(r.summary.recoveryCost).toBeGreaterThan(0)
    expect(r.summary.cancelledTrips).toBeGreaterThan(0)
  })
  it('a late widebody check crosses the boundary, charges once and resets wear on completion', () => {
    let s = network()
    s.airlines[0]!.fleet[0]!.type = 'b747_100'
    s = applyCommand(s, { type: 'plan_maintenance', aircraftId: 1, startWeek: 12 }).state
    const a = s.airlines[0]!,
      r = resolveOperations(s, a, 'actual', [])
    expect(r.summary.checkCost).toBeGreaterThan(0)
    expect(r.aircraft.get(1)!.checkEnd).toBeGreaterThan(QUARTER_MINUTES)
    a.fleet[0]!.operations = r.aircraft.get(1)!
    s.turn++
    const next = resolveOperations(s, a, 'actual', [])
    expect(next.summary.checkCost).toBe(0)
    expect(next.summary.aircraft[0]!.unavailableMinutes).toBe(3 * 1440)
    expect(next.aircraft.get(1)!.checkEnd).toBeUndefined()
    expect(next.aircraft.get(1)!.checkedTurn).toBe(1)
    expect(next.summary.completedTrips).toBeGreaterThan(0)
  })
  it('market capacity and the ledger reconcile to actual whole trips', () => {
    const s = network(1),
      a = s.airlines[0]!
    a.operationsPolicy!.recovery = true
    const r = resolveOperations(s, a, 'actual', [repair(s)])
    const t = resolveMarket(s, [], new Map([[0, r]]))[0]!
    const seats = [...r.allocations.values()].flat().reduce((n, trip) => n + trip.seats * trip.trips * 2, 0)
    expect(t.capacity).toBe(seats)
    expect(t.pax).toBeLessThanOrEqual(t.capacity)
    const ledger = recurringFinancials(s, a, t)
    expect(Object.values(ledger.breakdown).reduce((a, b) => a + b, 0)).toBe(ledger.costs)
    const without = recurringFinancials(s, a, { ...t, operations: undefined })
    expect(ledger.costs - without.costs).toBe(
      r.summary.repairCost + r.summary.checkCost + r.summary.recoveryCost,
    )
  })
  it('forecasts include known checks and an explicit adverse case without mutating the career', () => {
    const s = network(),
      before = structuredClone(s)
    const normal = forecastQuarter(s, 0)
    const adverse = forecastQuarter(s, 0, [], { operations: 'adverse' })
    expect(normal.operations!.repairCost).toBe(0)
    expect(adverse.operations!.cancelledTrips).toBeGreaterThan(normal.operations!.cancelledTrips)
    const checked = forecastQuarter(s, 0, [{ type: 'plan_maintenance', aircraftId: 1, startWeek: 3 }])
    expect(checked.operations!.checkCost).toBeGreaterThan(0)
    expect(checked.operations!.completedTrips).toBeLessThan(normal.operations!.completedTrips)
    expect(s).toEqual(before)
  })
  it('stored aircraft accumulate no flying wear; maintained 20-year-old aircraft remain operational', () => {
    const s = network(1),
      a = s.airlines[0]!,
      old = a.fleet[0]!
    old.ageQuarters = 80
    const r = resolveOperations(s, a, 'actual', [])
    expect(r.summary.completedTrips).toBe(r.summary.scheduledTrips)
    expect(r.aircraft.get(old.id)!.cycles).toBeGreaterThan(old.operations!.cycles)
    expect(r.aircraft.get(a.fleet[1]!.id)!.flightMinutes).toBe(a.fleet[1]!.operations!.flightMinutes)
    expect(r.aircraft.get(a.fleet[1]!.id)!.storedQuarters).toBe(1)
    expect(checkDueIn(a, old, 0)).toBe(8)
    old.operations = { ...aircraftOperations(a, old, 0), sinceCheckCycles: 4000 }
    expect(checkDueIn(a, old, 0)).toBe(0)
  })
  it('an explicit upgrade survives replay without rewriting previous quarters', () => {
    const start = newGame('jet_age', 'upgrade', undefined, undefined, 2)
    const commands: Command[] = [
      { type: 'open_route', from: 'JFK', to: 'ORD', aircraftId: 1, frequency: 12 },
      { type: 'end_quarter' },
      { type: 'upgrade_operations' },
      { type: 'plan_maintenance', aircraftId: 1, startWeek: 4 },
      { type: 'end_quarter' },
    ]
    const before = applyCommandBatch(start, commands.slice(0, 2)).state
    const final = applyCommandBatch(start, commands).state
    expect(final.rulesVersion).toBe(2)
    expect(final.airlines[0]!.history[0]).toEqual(before.airlines[0]!.history[0])
    expect(final.airlines[0]!.history[1]!.operations).toBeDefined()
    expect(
      runReplay({ rulesVersion: 2, contentVersion: 1, scenario: 'jet_age', seed: 'upgrade', commands }).state,
    ).toEqual(final)
    checkInvariants(final)
    expect(JSON.parse(JSON.stringify(final))).toEqual(final)
  })
  it('rejects invalid policies and in-progress check changes', () => {
    let s = network()
    for (const command of [
      { type: 'set_operations_policy', reserveBp: 9999, recovery: false },
      { type: 'plan_maintenance', aircraftId: 1, startWeek: -1 },
      { type: 'set_aircraft_base', aircraftId: 1, city: 'HND' },
    ] as Command[])
      expect(applyCommand(s, command).events[0]!.type).toBe('command_rejected')
    s.airlines[0]!.fleet[0]!.operations!.checkStart = 0
    s.airlines[0]!.fleet[0]!.operations!.checkEnd = QUARTER_MINUTES + 1440
    s.turn = 1
    s = applyCommand(s, { type: 'cancel_maintenance', aircraftId: 1 }).state
    expect(s.airlines[0]!.fleet[0]!.operations!.checkEnd).toBe(QUARTER_MINUTES + 1440)
  })
})
