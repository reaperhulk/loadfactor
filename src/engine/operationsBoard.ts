import { aircraftBase, crewFamily, resolveOperations, weeklyPlan, type OperationsWeek } from './operations'
import { distanceKm } from '../data/cities'
import { getAircraftType } from '../data/aircraft'
import type { GameState } from './types'

export function operationsBoard(state: GameState, seat: number) {
  const airline = state.airlines[seat]!, calendar: OperationsWeek[] = []
  const result = resolveOperations(state,airline,'forecast',undefined,calendar)
  const plans = weeklyPlan(airline)
  const gaps = result.summary.routes.filter(r=>r.cancelled>0).map(r=>{
    const route = airline.routes.find(p=>p.id===r.routeId)!, assigned = airline.fleet.filter(ac=>ac.routeId===route.id || ac.secondaryRouteId===route.id)
    const reasons:string[]=[]
    if ((plans.get(route.id) ?? []).reduce((n,p)=>n+p.trips,0)<route.frequency) reasons.push('Assigned aircraft cannot fly the requested weekly frequency')
    const possible = airline.fleet.filter(ac=>!assigned.includes(ac))
    const family = possible.filter(ac=>assigned.some(own=>crewFamily(own.type)===crewFamily(ac.type)))
    const range = family.filter(ac=>getAircraftType(ac.type).rangeKm>=distanceKm(route.from,route.to))
    const local = range.filter(ac=>{
      const base=aircraftBase(airline,ac)
      return base===route.from || base===route.to || Math.min(distanceKm(base,route.from),distanceKm(base,route.to))<=1000
    })
    if (!family.length) reasons.push('No other aircraft has compatible crews')
    else if (!range.length) reasons.push('Compatible aircraft lack route range')
    else if (!local.length) reasons.push('Compatible aircraft are beyond the 1,000 km ferry limit')
    else reasons.push('Nearby compatible aircraft could not fit every affected flight around checks, other flights, weekly hours and ferry time')
    return { ...r, from:route.from,to:route.to,reasons }
  })
  return { calendar, gaps, summary:result.summary }
}
