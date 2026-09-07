// Decision support uses the public command validator and full-network forecasts.
// These queries never change simulation policy, save identity or rival behavior.
import { createForecastPlanner } from './forecast'
import { maxRouteFrequency } from './queries'
import { routeSpoolBp, seasonalBp } from './market'
import type { Command, GameState, Route } from './types'

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
}

// A bounded capacity-guided search. Include the present plan, demand-sized
// capacity and nearby values; avoid resolving every integer frequency on every
// route. Full-network evaluation protects feeders and accounts for rivals.
export function frequencyCandidates(route: Route, max: number, projected: Route): number[] {
  const demandSized = Math.ceil(route.frequency * projected.lastLoadFactorBp / 10000)
  return [...new Set([route.frequency, route.frequency - 1, route.frequency + 1,
    demandSized - 1, demandSized, demandSized + 1, Math.ceil(route.frequency * 0.75), max])]
    .filter(n => n >= 1 && n <= max).sort((a, b) => a - b)
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
