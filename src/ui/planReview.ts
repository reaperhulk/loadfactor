// Approved expectations are presentation metadata, never simulation/replay input.
import type { CostBreakdown, GameEvent, GameState, QuarterStats } from '../engine'
import { planningForecast } from './forecast'

export interface ApprovedPlan {
  turn: number
  seat: number
  profit: number
  cashAfter: number
  revenue: number
  breakdown: CostBreakdown
  cancelledTrips: number
  routes: { id: number; from: string; to: string; contribution: number; pax: number }[]
}
export function capturePlan(state: GameState, seat: number): ApprovedPlan {
  const f = planningForecast(state, seat)
  return { turn: state.turn, seat, profit: f.profit, cashAfter: f.cashAfter,
    revenue: f.revenue, breakdown: { ...f.breakdown }, cancelledTrips: f.operations?.cancelledTrips ?? 0,
    routes: f.routes.map(r => ({ id: r.id, from: r.from, to: r.to,
      contribution: r.lastRevenue - r.lastCost, pax: r.lastPax })) }
}

export function comparePlan(plan: ApprovedPlan, actual: QuarterStats, events: GameEvent[]) {
  const movements = [{ key: 'revenue', delta: actual.revenue - plan.revenue },
    ...Object.keys(actual.breakdown).map(key => ({ key, delta: plan.breakdown[key as keyof CostBreakdown] - actual.breakdown[key as keyof CostBreakdown] }))]
    .filter(row => row.delta !== 0).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.key.localeCompare(b.key))
  const results = events.filter((e): e is Extract<GameEvent, { type: 'route_result' }> => e.type === 'route_result' && e.airline === plan.seat)
  const routes = results.map(r => {
    const expected = plan.routes.find(p => p.id === r.routeId)
    return { id: r.routeId, name: expected ? `${expected.from}–${expected.to}` : `New route #${r.routeId}`,
      delta: r.revenue - r.cost - (expected?.contribution ?? 0), paxDelta: r.pax - (expected?.pax ?? 0) }
  }).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.id - b.id)
  return { profitDelta: actual.profit - plan.profit, cashDelta: actual.cash - plan.cashAfter, movements, routes }
}

// Save sidecars are untrusted input; malformed metadata must never prevent a
// valid career from loading. Keep only bounded numeric records for human seats.
export function readApprovedPlans(value: unknown): ApprovedPlan[] {
  if (!Array.isArray(value)) return []
  const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
  return value.slice(-400).filter((p): p is ApprovedPlan => {
    if (!p || typeof p !== 'object' || !Number.isInteger(p.turn) || p.turn < 0 || !Number.isInteger(p.seat) || p.seat < 0 || p.seat > 3) return false
    if (![p.profit, p.cashAfter, p.revenue, p.cancelledTrips].every(finite) || !p.breakdown) return false
    if (!['fuel','fees','flightPay','service','salaries','ownership','maintenance','admin','slots','overhead','marketing','interest'].every(k => finite(p.breakdown[k]))) return false
    return Array.isArray(p.routes) && p.routes.length <= 1000 && p.routes.every((r: ApprovedPlan['routes'][number]) => r && Number.isInteger(r.id) && typeof r.from === 'string' && r.from.length <= 10 && typeof r.to === 'string' && r.to.length <= 10 && finite(r.contribution) && finite(r.pax))
  })
}
