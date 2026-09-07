import { useState } from 'react'
import type { GameState } from '../engine'
import { GOAL_LABELS, type PlanningPreference } from '../engine/planningGoals'
const KEY = 'loadfactor:planning-preference:v1'
export function usePlanningPreference(state: GameState, seat: number) {
  const key = `${state.scenario}:${state.seed}:${seat}`
  const [preference, setPreference] = useState<PlanningPreference>(() => {
    try {
      const p = JSON.parse(localStorage.getItem(KEY) ?? '{}')[key]
      if (p && Object.hasOwn(GOAL_LABELS,p.goal) && Number.isFinite(p.minCash) && p.minCash>=0) return p
    } catch { /* Defaults for this career. */ }
    return { goal:'scenario', minCash:0 }
  })
  return { preference, update: (next: PlanningPreference) => {
    setPreference(next)
    try { const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}'); localStorage.setItem(KEY,JSON.stringify(Object.fromEntries([...Object.entries(saved).filter(([k])=>k!==key).slice(-11),[key,next]]))) } catch { /* Session preference survives. */ }
  } }
}
