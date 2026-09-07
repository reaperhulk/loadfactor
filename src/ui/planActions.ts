import type { Command, GameState } from '../engine'
import { createForecastPlanner } from '../engine/forecast'
import { dispatchBatch, getSession, viewSeat } from './session'
import { clearPlanningDraft, getPlanningCommands, mergePlanningCommands } from './planningDrafts'

// A planner belongs to one immutable state. Repeated edits share dispatch and
// the baseline market result without retaining previous career snapshots.
const planners = new WeakMap<GameState, Map<number, ReturnType<typeof createForecastPlanner>>>()
export function planEvaluator(state: GameState, seat: number) {
  let seats = planners.get(state)
  if (!seats) { seats = new Map(); planners.set(state, seats) }
  let evaluate = seats.get(seat)
  if (!evaluate) { evaluate = createForecastPlanner(state, seat); seats.set(seat, evaluate) }
  return evaluate
}
export function applyPlanningDraft(extra: readonly Command[] = []): boolean {
  const session = getSession()
  if (!session || session.state.phase !== 'planning' || session.mp?.awaiting) return false
  const commands = mergePlanningCommands(getPlanningCommands(), extra)
  if (!commands.length || planEvaluator(session.state, viewSeat())(commands).errors.length) return false
  dispatchBatch(commands)
  clearPlanningDraft()
  return true
}
