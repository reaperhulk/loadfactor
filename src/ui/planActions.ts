import type { Command } from '../engine'
import { planningEvaluator as planEvaluator } from './forecast'
export { planningEvaluator as planEvaluator } from './forecast'
import { dispatchBatch, getSession, viewSeat } from './session'
import { clearPlanningDraft, getPlanningCommands, mergePlanningCommands } from './planningDrafts'

export function applyPlanningDraft(extra: readonly Command[] = []): boolean {
  const session = getSession()
  if (!session || session.state.phase !== 'planning' || session.mp?.awaiting) return false
  const commands = mergePlanningCommands(getPlanningCommands(), extra)
  if (!commands.length || planEvaluator(session.state, viewSeat())(commands).errors.length) return false
  dispatchBatch(commands)
  clearPlanningDraft()
  return true
}
