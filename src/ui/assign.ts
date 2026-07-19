// Assigning an airframe to a route should make it fly. The engine schedules
// min(requested frequency, what the assigned fleet can fly), so a bare
// assign_aircraft changes nothing until the schedule is raised too — this
// helper does both in one player intent.

import { getAircraftType } from '../data/aircraft'
import { distanceKm } from '../data/cities'
import type { GameState } from '../engine'
import { maxRouteFrequency, roundTripsPerWeek } from '../engine/queries'
import { dispatch } from './session'

export function assignAndSchedule(state: GameState, aircraftId: number, routeId: number): void {
  const player = state.airlines[0]!
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
