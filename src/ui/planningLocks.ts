import { useEffect, useState } from 'react'
import type { GameState } from '../engine'
import type { PlanningLocks, RouteSetting } from '../engine/planning'
const EMPTY: PlanningLocks = {}
const KEY = 'loadfactor:planning-locks:v1'
function read(): Record<string, PlanningLocks> {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {}
    return Object.fromEntries(Object.entries(saved).slice(-12).map(([career, locks]) => [career,
      Object.fromEntries(Object.entries(locks && typeof locks === 'object' ? locks : {}).filter(([id]) => /^\d+$/.test(id)).map(([id, settings]) => [id,
        Array.isArray(settings) ? settings.filter((x): x is RouteSetting => ['fare','service','frequency'].includes(x)) : []]))]))
  } catch { return {} }
}
export function usePlanningLocks(state: GameState, seat: number) {
  const [saved, setSaved] = useState(read)
  const career = `${state.scenario}:${state.seed}:${seat}:${state.airlines[seat]!.hq}:${state.airlines[seat]!.name}`
  const locks = saved[career] ?? EMPTY
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(saved)) } catch { /* Keep session locks. */ } }, [saved])
  const toggle = (routeId: number, setting: RouteSetting) => setSaved(current => {
    const existing = current[career] ?? {}, fields = existing[routeId] ?? []
    const next = { ...existing, [routeId]: fields.includes(setting) ? fields.filter(s => s !== setting) : [...fields, setting] }
    return Object.fromEntries([...Object.entries(current).filter(([key]) => key !== career).slice(-11), [career, next]])
  })
  return { locks, toggle }
}
