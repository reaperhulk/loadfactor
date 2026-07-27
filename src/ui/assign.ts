// Assigning an airframe to a route should make it fly. The engine schedules
// min(requested frequency, what the assigned fleet can fly), so a bare
// assign_aircraft changes nothing until the schedule is raised too — this
// helper does both in one player intent.

import { getAircraftType } from '../data/aircraft'
import { distanceKm } from '../data/cities'
import type { GameState } from '../engine'
import { pairWeeklyDemand } from '../engine/market'
import { maxRouteFrequency, roundTripsPerWeek, routeWeeklyCapacity } from '../engine/queries'
import { viewSeat, dispatch, getSession } from './session'

export function assignAndSchedule(state: GameState, aircraftId: number, routeId: number): void {
  const player = state.airlines[viewSeat()]!
  const aircraft = player.fleet.find((a) => a.id === aircraftId)
  const route = player.routes.find((r) => r.id === routeId)
  if (!aircraft || !route) return
  const km = distanceKm(route.from, route.to)
  dispatch({ type: 'assign_aircraft', aircraftId, routeId })
  // Out of range → the engine already rejected the assign with a toast;
  // don't stack a second rejection on the schedule bump.
  if (getAircraftType(aircraft.type).rangeKm < km) return
  const trips = roundTripsPerWeek(aircraft.type, km)
  // maxRouteFrequency is computed pre-assign, so the new plane's trips are
  // added by hand; the requested schedule grows by what the plane can fly.
  const target = Math.min(maxRouteFrequency(player, route) + trips, route.frequency + trips)
  if (target > route.frequency) {
    dispatch({ type: 'set_frequency', routeId, frequency: target })
  }
}

// Put every idle airframe to work: a greedy pass, one plane at a time
// against LIVE session state so each assignment sees the capacity the
// previous one just added. The guard bounds a pathological loop.
export function assignAllIdle(): void {
  for (let guard = 0; guard < 50; guard++) {
    const s = getSession()?.state
    if (!s) return
    const p = s.airlines[viewSeat()]!
    const idle = p.fleet.find((a) => a.routeId === null)
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
