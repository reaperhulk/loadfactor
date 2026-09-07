import { CITIES, distanceKm, pairKey } from '../data/cities'
import { getAircraftType } from '../data/aircraft'
import { getScenario } from '../data/scenarios'
import { CONNECT_DETOUR_MAX_BP, MIN_ROUTE_KM } from '../data/constants'
import { baseFare, estimateAircraftQuarterCost, pairWeeklyDemand, seasonalBp } from './market'
import { cabinSeats, isGrounded, networkCities, roundTripsPerWeek, slotsFree } from './queries'
import { nextExpansion, slotsRemaining } from './slots'
import { createForecastPlanner } from './forecast'
import type { Command, GameState } from './types'

export interface ExpansionOption {
  from: string; to: string; aircraftId: number; aircraftType: string; frequency: number
  command: Command; profitDelta: number; cashAfter: number; cashRequired: number
  objectiveDelta: number; connectionsDelta: number; loadFactorBp: number; risks: string[]
}
export function objectiveForecastValue(state: GameState, seat: number, forecast: ReturnType<ReturnType<typeof createForecastPlanner>>): number {
  const kind = getScenario(state.scenario).objective.kind
  if (kind === 'profit' || kind === 'netWorth') return forecast.profit
  if (kind === 'pax') return forecast.routes.reduce((n, r) => n + r.lastPax, 0)
  if (kind === 'transfer') return forecast.routes.reduce((n, r) => n + r.lastTransferPax, 0)
  const history = state.airlines[seat]!.history
  const pax = history.reduce((n, q) => n + q.pax, 0) + forecast.routes.reduce((n, r) => n + r.lastPax, 0)
  const capacity = history.reduce((n, q) => n + (q.capacity ?? 0), 0) + forecast.routes.reduce((n, r) => n + r.lastCapacity, 0)
  return capacity ? Math.floor(pax * 10000 / capacity) : 0
}

export function expansionOptions(state: GameState, seat: number) {
  const airline = state.airlines[seat]!, network = [...networkCities(airline)].sort()
  const served = new Set(airline.routes.map(r => pairKey(r.from, r.to)))
  const idle = airline.fleet.filter(ac => ac.routeId === null && !ac.reserve && !isGrounded(ac, state.turn))
  const preliminary: { from: string; to: string; demand: number; score: number; blockers: string[]; km: number }[] = []
  const seen = new Set<string>()
  // Scan network-to-world pairs once. Cheap demand and operating-cost estimates
  // shortlist six feasible markets before any full-network comparison.
  for (const from of network) for (const city of CITIES) {
    const to = city.id, key = pairKey(from, to)
    if (from === to || served.has(key) || seen.has(key)) continue
    seen.add(key)
    const km = distanceKm(from, to)
    if (km < MIN_ROUTE_KM) continue
    const demand = pairWeeklyDemand(state, from, to)
    const capable = idle.filter(ac => getAircraftType(ac.type).rangeKm >= km)
    const cost = capable.length ? Math.min(...capable.map(ac => estimateAircraftQuarterCost(state, ac.type, km))) : 0
    // Complementary spokes earn a place in the shortlist even when their
    // direct market is smaller. Final rankings use the actual itinerary model.
    let feederDemand = 0
    for (const route of airline.routes) if (route.from === from || route.to === from) {
      const other = route.from === from ? route.to : route.from
      if (other !== to && (km + distanceKm(from, other)) * 10000 <= distanceKm(to, other) * CONNECT_DETOUR_MAX_BP) feederDemand += pairWeeklyDemand(state, to, other)
    }
    const blockers: string[] = []
    if (slotsFree(airline, from) <= 0) blockers.push(`Need slots at ${from}`)
    if (slotsFree(airline, to) <= 0) blockers.push(`Need slots at ${to}`)
    if (!capable.length) blockers.push('Need an idle aircraft with enough range')
    const score = Math.floor((demand + Math.floor(feederDemand / 4)) * baseFare(km) * 13 / 1000) - cost
    preliminary.push({ from, to, km, demand, score, blockers })
  }
  preliminary.sort((a, b) => b.score - a.score || pairKey(a.from, a.to).localeCompare(pairKey(b.from, b.to)))
  const evaluate = createForecastPlanner(state, seat), before = evaluate()
  const objectiveBefore = objectiveForecastValue(state, seat, before)
  const connectionsBefore = before.routes.reduce((n, r) => n + r.lastTransferPax, 0)
  const options: ExpansionOption[] = []
  for (const pair of preliminary.filter(p => !p.blockers.length).slice(0, 6)) {
    const groups = new Set<string>()
    const aircraft = idle.filter(ac => getAircraftType(ac.type).rangeKm >= pair.km)
      .sort((a, b) => estimateAircraftQuarterCost(state, a.type, pair.km) - estimateAircraftQuarterCost(state, b.type, pair.km) || a.id - b.id)
      .filter(ac => { const key = `${ac.type}:${ac.cabin}`; if (groups.has(key)) return false; groups.add(key); return true }).slice(0, 2)
    let best: ExpansionOption | undefined
    for (const ac of aircraft) {
      const max = roundTripsPerWeek(ac.type, pair.km, airline.operationsPolicy?.reserveBp)
      const sized = Math.max(1, Math.min(max, Math.ceil(pair.demand * 0.7 / (cabinSeats(ac.type, ac.cabin) * 2))))
      for (const frequency of [...new Set([sized, Math.max(1, Math.floor(sized * 0.7)), Math.min(max, sized + 2)])]) {
        const command: Command = { type: 'open_route', from: pair.from, to: pair.to, aircraftId: ac.id, frequency, fareLevel: 0, serviceLevel: 2 }
        const after = evaluate([command])
        if (after.errors.length) continue
        const route = after.routes.find(r => !served.has(pairKey(r.from, r.to)))!
        const objectiveDelta = objectiveForecastValue(state, seat, after) - objectiveBefore
        const profitDelta = after.profit - before.profit
        if (best && (objectiveDelta < best.objectiveDelta || (objectiveDelta === best.objectiveDelta && profitDelta <= best.profitDelta))) continue
        const rivals = state.airlines.filter(a => a.id !== seat && !a.bankrupt && a.routes.some(r => pairKey(r.from, r.to) === pairKey(pair.from, pair.to))).length
        const season = Math.floor(seasonalBp(pair.from, state.turn) * seasonalBp(pair.to, state.turn) / 10000)
        const gaps = after.operations?.routes.find(r => r.routeId === route.id)?.cancelled ?? 0
        best = { from: pair.from, to: pair.to, aircraftId: ac.id, aircraftType: ac.type, frequency, command,
          profitDelta, objectiveDelta, cashAfter: after.cashAfter, cashRequired: after.cashRequired,
          connectionsDelta: after.routes.reduce((n, r) => n + r.lastTransferPax, 0) - connectionsBefore,
          loadFactorBp: route.lastLoadFactorBp, risks: [
            'First-quarter forecast; new routes build demand over three quarters',
            ...(rivals ? [`${rivals} direct competitors, plus connecting alternatives`] : []),
            ...(season > 10250 ? ['Peak season; demand will fall back'] : season < 9750 ? ['Off season; demand may recover'] : []),
            ...(after.cashAfter < 0 ? ['Forecast ends with negative cash'] : []),
            ...(gaps ? [`${gaps} round trips lack cover`] : []),
          ] }
      }
    }
    if (best) options.push(best)
  }
  options.sort((a, b) => b.objectiveDelta - a.objectiveDelta || b.profitDelta - a.profitDelta)
  const blocked = preliminary.filter(p => p.blockers.length).slice(0, 3).map(p => ({ ...p,
    airport: slotsFree(airline, p.to) <= 0 ? p.to : p.from,
    wait: (() => { const airport = slotsFree(airline, p.to) <= 0 ? p.to : p.from; return slotsRemaining(state, airport) <= 0 ? nextExpansion(state, airport).quartersAway : 1 })() }))
  return { options, blocked }
}
