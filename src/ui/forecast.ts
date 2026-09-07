import type { GameState } from '../engine'
import { createForecastPlanner } from '../engine/forecast'

// All workspaces share one bounded comparison context per immutable snapshot.
// Weak keys release previous career states when undo and React release them.
const planners=new WeakMap<GameState,Map<number,ReturnType<typeof createForecastPlanner>>>()
export function planningEvaluator(state:GameState,seat:number) {
  let seats=planners.get(state)
  if(!seats) {seats=new Map();planners.set(state,seats)}
  let evaluate=seats.get(seat)
  if(!evaluate) {evaluate=createForecastPlanner(state,seat);seats.set(seat,evaluate)}
  return evaluate
}
export function planningForecast(state:GameState,seat:number) {return planningEvaluator(state,seat)()}
