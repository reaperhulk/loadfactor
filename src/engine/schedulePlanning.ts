import type { GameState, Route, Command } from './types'
import type { RouteSetting } from './planning'
import { maxRouteFrequency } from './queries'

// A bounded capacity-guided search. Include the present plan, demand-sized
// capacity and nearby values; avoid resolving every integer frequency on every
// route. Full-network evaluation protects feeders and accounts for rivals.
export function frequencyCandidates(route: Route, max: number, projected: Route): number[] {
  const demandSized = Math.ceil(route.frequency * projected.lastLoadFactorBp / 10000)
  return [...new Set([route.frequency, route.frequency - 1, route.frequency + 1,
    demandSized - 1, demandSized, demandSized + 1, Math.ceil(route.frequency * 0.75), max])]
    .filter(n => n >= 1 && n <= max).sort((a, b) => a - b)
}
import { forecastDirectRoute } from './forecast'
export function directCandidates(state: GameState, seat: number, route: Route, locks: readonly RouteSetting[] = [], projected = route) {
  const base = forecastDirectRoute(state, seat, route)
  const baseline = base.lastRevenue - base.lastCost
  const winners: { setting: RouteSetting; command: Command; title: string; gain: number }[] = []
  for (const setting of ['frequency', 'fare', 'service'] as const) {
    if (locks.includes(setting)) continue
    const candidates = setting === 'frequency' ? frequencyCandidates(route, maxRouteFrequency(state.airlines[seat]!, route, state.turn), projected)
      : setting === 'fare' ? [-2, -1, 0, 1, 2] : [1, 2, 3]
    let winner: (typeof winners)[number] | undefined
    for (const value of candidates) {
      const variant = { ...route, [setting === 'frequency' ? 'frequency' : setting === 'fare' ? 'fareLevel' : 'serviceLevel']: value }
      if (variant.frequency === route.frequency && variant.fareLevel === route.fareLevel && variant.serviceLevel === route.serviceLevel) continue
      const result = forecastDirectRoute(state, seat, variant), gain = result.lastRevenue - result.lastCost - baseline
      if (gain <= 0 || gain <= (winner?.gain ?? 0)) continue
      const command: Command = setting === 'frequency' ? { type: 'set_frequency', routeId: route.id, frequency: value }
        : setting === 'fare' ? { type: 'set_fare', routeId: route.id, fareLevel: value } : { type: 'set_service', routeId: route.id, serviceLevel: value }
      winner = { setting, command, gain, title: setting === 'frequency' ? `${route.frequency} → ${value} round trips/week`
        : setting === 'fare' ? `Fare: ${['Deep discount','Discount','Standard','Premium','Top fare'][value + 2]}`
        : `Service: ${['','Basic','Standard','Premium'][value]}` }
    }
    if (winner) winners.push(winner)
  }
  return winners
}
