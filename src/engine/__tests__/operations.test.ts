import { describe, expect, it } from 'vitest'
import { getAircraftType } from '../../data/aircraft'
import { distanceKm } from '../../data/cities'
import { WEEKLY_BLOCK_MINUTES } from '../../data/constants'
import { applyCommand, newGame } from '../index'
import { allocateTrips, objectiveQualified, routeWeeklyCapacity } from '../queries'
import { checkInvariants } from '../invariants'

function network() {
  let s = newGame('jet_age', 'operations', undefined, undefined, 2)
  s = applyCommand(s, { type: 'open_route', from: 'JFK', to: 'ORD', aircraftId: 1, frequency: 8 }).state
  s = applyCommand(s, { type: 'open_route', from: 'JFK', to: 'MIA', aircraftId: 2, frequency: 8 }).state
  return s
}
describe('fleet operations', () => {
  it('shares one aircraft without exceeding its weekly hour budget', () => {
    let s = network()
    const [primary, second] = s.airlines[0]!.routes
    s = applyCommand(s, { type: 'assign_aircraft', aircraftId: 2, routeId: null }).state
    s = applyCommand(s, { type: 'set_rotation', aircraftId: 1, secondaryRouteId: second!.id }).state
    const a = s.airlines[0]!
    let minutes = 0
    for (const route of [primary!, second!]) {
      route.frequency = 9999
      for (const alloc of allocateTrips(a, route, s.turn)) {
        const type = getAircraftType(alloc.type)
        minutes += alloc.trips * 2 * (Math.floor(distanceKm(route.from, route.to) * 60 / type.speedKmh) + type.turnaroundMin)
      }
    }
    expect(minutes).toBeLessThanOrEqual(WEEKLY_BLOCK_MINUTES)
    expect(routeWeeklyCapacity(a, second!, s.turn)).toBeGreaterThan(0)
    checkInvariants(s)
  })
  it('a reserve covers only one grounding and maintenance buys finite protection', () => {
    let s = network()
    const a = s.airlines[0]!
    a.fleet.push({ ...a.fleet[0]!, id: a.nextId++, routeId: null, reserve: true })
    s = applyCommand(s, { type: 'plan_maintenance', aircraftId: 1 }).state
    expect(s.airlines[0]!.fleet[0]!.maintainedUntil).toBe(9)
    s = applyCommand(s, { type: 'plan_maintenance', aircraftId: 2 }).state
    const capacities = s.airlines[0]!.routes.map((r) => routeWeeklyCapacity(s.airlines[0]!, r, s.turn))
    expect(capacities.filter((c) => c > 0)).toHaveLength(1)
    expect(applyCommand(s, { type: 'plan_maintenance', aircraftId: 1 }).events[0]!.type).toBe('command_rejected')
  })
  it('a leased replacement retires its predecessor only on delivery', () => {
    const s = network()
    const ordered = applyCommand(s, { type: 'order_replacement', aircraftId: 1, aircraftType: 'caravelle', leased: true })
    expect(ordered.state.airlines[0]!.fleet.some((a) => a.id === 1)).toBe(true)
    const arrived = applyCommand(ordered.state, { type: 'end_quarter' })
    expect(arrived.state.airlines[0]!.fleet.some((a) => a.id === 1)).toBe(false)
    expect(arrived.state.airlines[0]!.fleet.some((a) => a.leased && a.routeId === s.airlines[0]!.routes[0]!.id)).toBe(true)
    checkInvariants(arrived.state)
  })
  it('legacy rules reject new operations and token airlines cannot qualify for an efficiency win', () => {
    const legacy = newGame('jet_age', 'legacy', undefined, undefined, 1)
    expect(applyCommand(legacy, { type: 'set_hub_mode', mode: 'banked' }).events[0]!.type).toBe('command_rejected')
    const efficiency = newGame('lcc_wars', 'scale')
    expect(objectiveQualified(efficiency, efficiency.airlines[0]!)).toBe(false)
  })
})
