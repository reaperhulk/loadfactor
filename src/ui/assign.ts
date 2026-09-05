// Assigning an airframe to a route should make it fly. The engine schedules
// min(requested frequency, what the assigned fleet can fly), so a bare
// assign_aircraft changes nothing until the schedule is raised too — this
// helper does both in one player intent.

import { getAircraftType } from '../data/aircraft'
import { distanceKm } from '../data/cities'
import type { Command, GameState } from '../engine'
import { pairWeeklyDemand } from '../engine/market'
import { isGrounded, maxRouteFrequency, roundTripsPerWeek, routeWeeklyCapacity } from '../engine/queries'
import { forecastDirectRoute } from '../engine/forecast'
import { viewSeat, dispatchBatch, getSession } from './session'

export function assignAndSchedule(state: GameState, aircraftId: number, routeId: number): void {
  const player = state.airlines[viewSeat()]!
  const aircraft = player.fleet.find((a) => a.id === aircraftId)
  const route = player.routes.find((r) => r.id === routeId)
  if (!aircraft || !route) return
  const km = distanceKm(route.from, route.to)
  // Out of range → the engine already rejected the assign with a toast;
  // don't stack a second rejection on the schedule bump.
  if (getAircraftType(aircraft.type).rangeKm < km) {
    dispatchBatch([{ type: 'assign_aircraft', aircraftId, routeId }])
    return
  }
  const trips = roundTripsPerWeek(aircraft.type, km)
  // maxRouteFrequency is computed pre-assign, so the new plane's trips are
  // added by hand; the requested schedule grows by what the plane can fly.
  const target = Math.min(maxRouteFrequency(player, route) + trips, route.frequency + trips)
  const commands: Command[] = [{ type: 'assign_aircraft', aircraftId, routeId }]
  if (target > route.frequency) commands.push({ type: 'set_frequency', routeId, frequency: target })
  dispatchBatch(commands)
}

// Delegate repetitive schedule tuning while keeping network strategy in the
// player's hands. Compare direct-market contribution against competing
// schedules, capped by the fleet actually assigned.
export function balancedScheduleCommands(state: GameState, airlineIdx: number): Command[] {
  const airline = state.airlines[airlineIdx]
  if (!airline) return []
  const commands: Command[] = []
  for (const route of airline.routes) {
    const max = maxRouteFrequency(airline, route)
    if (max < 1) continue
    // Maximize the route's contribution against the actual competing schedules.
    // Bound candidate count for very large fleets, then refine around the winner.
    const step = Math.max(1, Math.ceil(max / 32))
    let frequency = Math.min(route.frequency, max)
    let best = -Infinity
    const consider = (candidate: number) => {
      const result = forecastDirectRoute(state, airlineIdx, { ...route, frequency: candidate })
      const contribution = result.lastRevenue - result.lastCost
      if (contribution > best || (contribution === best && candidate < frequency)) {
        best = contribution
        frequency = candidate
      }
    }
    consider(frequency)
    for (let candidate = 1; candidate <= max; candidate += step) consider(candidate)
    consider(max)
    const center = frequency
    for (let candidate = Math.max(1, center - step); candidate <= Math.min(max, center + step); candidate++) consider(candidate)
    if (frequency !== route.frequency) {
      commands.push({ type: 'set_frequency', routeId: route.id, frequency })
    }
  }
  return commands
}

export function balanceSchedules(state: GameState): void {
  dispatchBatch(balancedScheduleCommands(state, viewSeat()))
}

// Put every idle airframe to work: a greedy pass, one plane at a time
// against LIVE session state so each assignment sees the capacity the
// previous one just added. The guard bounds a pathological loop.
export function assignAllIdle(): void {
  for (let guard = 0; guard < 50; guard++) {
    const s = getSession()?.state
    if (!s) return
    const p = s.airlines[viewSeat()]!
    const idle = p.fleet.find((a) => a.routeId === null && !a.reserve && !isGrounded(a, s.turn))
    if (!idle) return
    const range = getAircraftType(idle.type).rangeKm
    let bestRoute: (typeof p.routes)[number] | null = null
    let bestGap = 0
    for (const r of p.routes) {
      if (distanceKm(r.from, r.to) > range) continue
      const gap = pairWeeklyDemand(s, r.from, r.to) - routeWeeklyCapacity(p, r)
      if (gap > bestGap) {
        bestGap = gap
        bestRoute = r
      }
    }
    if (!bestRoute) return
    assignAndSchedule(s, idle.id, bestRoute.id)
  }
}
