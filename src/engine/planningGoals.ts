import { getScenario } from '../data/scenarios'
import type { GameState } from './types'
import type { forecastQuarter } from './forecast'

export type PlanningGoal = 'scenario' | 'profit' | 'pax' | 'transfer' | 'loadFactor' | 'resilience'
export interface PlanningPreference { goal: PlanningGoal; minCash: number }
export const GOAL_LABELS: Record<PlanningGoal, string> = { scenario: 'Scenario objective', profit: 'Company profit', pax: 'Passenger growth', transfer: 'Connecting traffic', loadFactor: 'Seat efficiency', resilience: 'Reliable service' }
export function resolvedGoal(state: GameState, goal: PlanningGoal): Exclude<PlanningGoal, 'scenario'> {
  const kind = goal === 'scenario' ? getScenario(state.scenario).objective.kind : goal
  return kind === 'netWorth' ? 'profit' : kind as Exclude<PlanningGoal, 'scenario'>
}
export function planningValue(state: GameState, seat: number, forecast: ReturnType<typeof forecastQuarter>, goal: PlanningGoal): number {
  const kind = resolvedGoal(state, goal)
  if (kind === 'profit') return forecast.profit
  if (kind === 'resilience') return -(forecast.operations?.cancelledTrips ?? 0)
  if (kind === 'pax') return forecast.routes.reduce((n,r) => n+r.lastPax, 0)
  if (kind === 'transfer') return forecast.routes.reduce((n,r) => n+r.lastTransferPax, 0)
  const history = state.airlines[seat]!.history
  const pax = history.reduce((n,q)=>n+q.pax,0)+forecast.routes.reduce((n,r)=>n+r.lastPax,0)
  const capacity = history.reduce((n,q)=>n+(q.capacity ?? 0),0)+forecast.routes.reduce((n,r)=>n+r.lastCapacity,0)
  return capacity ? Math.floor(pax*10000/capacity) : 0
}
