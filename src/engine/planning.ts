// Decision support uses the public command validator and full-network forecasts.
// These queries never change simulation policy, save identity or rival behavior.
import { createForecastPlanner } from './forecast'
import { maxRouteFrequency } from './queries'
import { frequencyCandidates, directCandidates } from './schedulePlanning'
import { routeSpoolBp, seasonalBp } from './market'
import type { Command, GameState, Route } from './types'
import { planningValue, resolvedGoal, type PlanningPreference } from './planningGoals'

export type ForecastPlanner = ReturnType<typeof createForecastPlanner>
export type RouteSetting = 'fare' | 'service' | 'frequency'
export interface Recommendation {
  routeId: number
  setting: RouteSetting | 'closure'
  commands: Command[]
  title: string
  reason: string
  profitDelta: number
  cashAfter: number
  contributionDelta: number
  goalDelta?: number
}

export function routeRecommendations(state: GameState, seat: number, route: Route, evaluate: ForecastPlanner = createForecastPlanner(state, seat), locked: readonly RouteSetting[] = [], closure = true): Recommendation[] {
  const before = evaluate(), projected = before.routes.find(r => r.id === route.id)!
  const candidates: { setting: Recommendation['setting']; commands: Command[]; title: string }[] = []
  if (!locked.includes('frequency')) for (const frequency of frequencyCandidates(route, maxRouteFrequency(state.airlines[seat]!, route, state.turn), projected)) {
    if (frequency !== route.frequency) candidates.push({ setting: 'frequency', commands: [{ type: 'set_frequency', routeId: route.id, frequency }], title: `Fly ${frequency} round trips/week` })
  }
  if (!locked.includes('fare')) for (const fareLevel of [-2, -1, 0, 1, 2]) {
    if (fareLevel !== route.fareLevel) candidates.push({ setting: 'fare', commands: [{ type: 'set_fare', routeId: route.id, fareLevel }], title: `${fareLevel > route.fareLevel ? 'Raise' : 'Lower'} the fare` })
  }
  if (!locked.includes('service')) for (const serviceLevel of [1, 2, 3]) {
    if (serviceLevel !== route.serviceLevel) candidates.push({ setting: 'service', commands: [{ type: 'set_service', routeId: route.id, serviceLevel }], title: `Offer ${['', 'basic', 'standard', 'premium'][serviceLevel]} service` })
  }
  if (closure) candidates.push({ setting: 'closure', commands: [{ type: 'close_route', routeId: route.id }], title: 'Close this route' })
  const winners = new Map<Recommendation['setting'], Recommendation>()
  for (const candidate of candidates) {
    const after = evaluate(candidate.commands)
    const delta = after.profit - before.profit
    if (after.errors.length || delta <= 0 || delta <= (winners.get(candidate.setting)?.profitDelta ?? 0)) continue
    const leg = after.routes.find(r => r.id === route.id)
    winners.set(candidate.setting, { ...candidate, routeId: route.id, profitDelta: delta, cashAfter: after.cashAfter,
      contributionDelta: (leg ? leg.lastRevenue - leg.lastCost : 0) - (projected.lastRevenue - projected.lastCost),
      reason: candidate.setting === 'frequency' ? 'Capacity and flight costs change; connecting traffic is included.'
        : candidate.setting === 'fare' ? 'Balances passenger volume and revenue per passenger across the network.'
        : candidate.setting === 'service' ? 'Passenger appeal is weighed against service costs.'
        : 'Includes lost connecting traffic. Aircraft become idle and keep their ownership costs.' })
  }
  return [...winners.values()].sort((a, b) => b.profitDelta - a.profitDelta)
}

export function routeSignals(state: GameState, seat: number, route: Route, evaluate: ForecastPlanner = createForecastPlanner(state, seat)) {
  const forecast = evaluate(), projected = forecast.routes.find(r => r.id === route.id)!
  const airline = state.airlines[seat]!
  const signals: { title: string; detail: string }[] = []
  const ops = forecast.operations?.routes.find(r => r.routeId === route.id)
  if (ops?.cancelled) signals.push({ title: 'Known service gaps', detail: `${ops.cancelled} planned round trips lack cover. Review checks, reserve hours or the schedule.` })
  const spool = routeSpoolBp(airline, route, state.turn)
  if (spool < 10000) signals.push({ title: 'Still building an audience', detail: `This route currently attaches ${spool / 100}% of its established demand share.` })
  const season = Math.floor(seasonalBp(route.from, state.turn) * seasonalBp(route.to, state.turn) / 10000)
  if (season < 9750) signals.push({ title: 'Low season', detail: `Seasonality reduces this market's demand by ${Math.round((10000 - season) / 100)}% this quarter.` })
  if (projected.lastLoadFactorBp < 6500 && projected.lastCapacity > 0) signals.push({ title: 'Capacity exceeds expected sales', detail: `${Math.round(projected.lastLoadFactorBp / 100)}% forecast load. Compare a smaller schedule before adding aircraft.` })
  if (projected.lastLoadFactorBp >= 9500) signals.push({ title: 'Little room for more passengers', detail: 'Most seats are forecast to sell. Compare more frequency or a higher fare.' })
  // Direct competition is observable; it does not identify the cause of a loss.
  const rivals = state.airlines.filter(a => a.id !== seat && !a.bankrupt && a.routes.some(r => r.from === route.from && r.to === route.to))
  if (rivals.length) signals.push({ title: 'Direct competition', detail: `${rivals.map(a => a.name).join(', ')} also serve this pair. Their connecting networks compete too.` })
  if (projected.lastTransferPax > 0) signals.push({ title: 'Feeds the network', detail: `${projected.lastTransferPax.toLocaleString('en-US')} forecast connecting boardings. Judge changes by company profit as well as this route's contribution.` })
  if (!signals.length) signals.push({ title: 'Compare the next move', detail: 'Test fares, service and frequency against the whole network before changing the plan.' })
  return signals
}

export type PlanningLocks = Record<number, RouteSetting[]>
// Screen alternatives on their direct markets, then quote the shortlisted
// actions against the full network. This bounds full-network market passes to
// a few actions per route instead of every fare/service/frequency combination.
export function networkRecommendations(state: GameState, seat: number, locks: PlanningLocks = {}, preference: PlanningPreference = { goal: 'profit', minCash: -Infinity }): Recommendation[] {
  const evaluate = createForecastPlanner(state, seat), before = evaluate()
  const suggestions: Recommendation[] = []
  const kind = resolvedGoal(state, preference.goal), baseline = planningValue(state, seat, before, preference.goal)
  for (const route of state.airlines[seat]!.routes) {
    const projected = before.routes.find(r => r.id === route.id)!
    const candidates = directCandidates(state, seat, route, locks[route.id] ?? [], projected)
    // Profit screening alone would discard loss-making but useful feeders.
    // Non-profit objectives also test bounded growth and contraction choices;
    // every candidate is scored by the conserved full-network allocation.
    if (kind !== 'profit') {
      const locked = locks[route.id] ?? []
      if (!locked.includes('frequency')) for (const frequency of [...new Set([Math.max(1,route.frequency-2), Math.min(maxRouteFrequency(state.airlines[seat]!,route,state.turn),route.frequency+2)])]) {
        if (frequency !== route.frequency) candidates.push({ setting:'frequency', command:{ type:'set_frequency',routeId:route.id,frequency }, title:`${route.frequency} → ${frequency} round trips/week`, gain:0 })
      }
      if (!locked.includes('fare')) for (const fareLevel of [-1, 1]) if (fareLevel !== route.fareLevel) candidates.push({setting:'fare',command:{type:'set_fare',routeId:route.id,fareLevel},title:fareLevel < route.fareLevel ? 'Lower the fare' : 'Raise the fare',gain:0})
      if (!locked.includes('service') && route.serviceLevel !== 3) candidates.push({setting:'service',command:{type:'set_service',routeId:route.id,serviceLevel:3},title:'Premium service',gain:0})
    }
    const winners = new Map<RouteSetting, Recommendation>()
    for (const c of candidates) {
      const after = evaluate([c.command]), leg = after.routes.find(r => r.id === route.id)!
      const delta = after.profit - before.profit
      const goalDelta = planningValue(state, seat, after, preference.goal) - baseline
      if (after.errors.length || goalDelta <= 0 || after.cashAfter < preference.minCash || goalDelta <= (winners.get(c.setting)?.goalDelta ?? 0)) continue
      winners.set(c.setting, { routeId: route.id, setting: c.setting, commands: [c.command], goalDelta,
        title: c.title, reason: 'Screened on this market, then checked with connecting traffic and all company costs.',
        profitDelta: delta, cashAfter: after.cashAfter,
        contributionDelta: leg.lastRevenue - leg.lastCost - (projected.lastRevenue - projected.lastCost) })
    }
    suggestions.push(...winners.values())
  }
  return suggestions.sort((a, b) => (b.goalDelta ?? b.profitDelta) - (a.goalDelta ?? a.profitDelta) || b.profitDelta - a.profitDelta || a.routeId - b.routeId)
}
