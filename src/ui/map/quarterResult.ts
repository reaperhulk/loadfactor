// The quarter's result, told on the map: after the report closes, each of the
// player's routes flashes by how its profit moved against the quarter before.
// Pure over the route's own recorded history, so the map, the tests and any
// later caption all agree on what "better" meant.

import type { Route } from '../../engine'

export type RouteTrend = 'up' | 'down' | 'flat'

// A change smaller than this ($k, or 2% of the quarter's revenue if larger)
// is noise, not news.
const MIN_SWING_K = 10

export function routeProfitTrend(route: Route, turn: number): RouteTrend {
  const last = route.history.at(-1)
  // Only a route flown in the quarter that just resolved has a result.
  if (last === undefined || last.turn !== turn - 1) return 'flat'
  const profit = last.revenue - last.cost
  const prev = route.history.at(-2)
  // A route's first quarter is judged on whether it made money at all.
  const delta = prev === undefined || prev.turn !== last.turn - 1 ? profit : profit - (prev.revenue - prev.cost)
  const swing = Math.max(MIN_SWING_K, Math.floor(last.revenue / 50))
  return delta >= swing ? 'up' : delta <= -swing ? 'down' : 'flat'
}

export function quarterTrends(routes: readonly Route[], turn: number): { byRoute: ReadonlyMap<number, RouteTrend>; up: number; down: number } {
  const byRoute = new Map<number, RouteTrend>()
  let up = 0
  let down = 0
  for (const r of routes) {
    const t = routeProfitTrend(r, turn)
    byRoute.set(r.id, t)
    if (t === 'up') up++
    else if (t === 'down') down++
  }
  return { byRoute, up, down }
}

// How long the map holds the result before it fades back to the network.
export const QUARTER_RESULT_MS = 4500
