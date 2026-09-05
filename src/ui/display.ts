import { useSyncExternalStore } from 'react'
export interface DisplayPreferences { motion: 'system' | 'reduced' | 'full'; text: number; traffic: 'normal' | 'low' }
const KEY = 'loadfactor:display:v1'
let preferences: DisplayPreferences = { motion: 'system', text: 100, traffic: 'normal' }
try {
  const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<DisplayPreferences>
  if (saved.motion === 'system' || saved.motion === 'reduced' || saved.motion === 'full') preferences.motion = saved.motion
  if (saved.text === 100 || saved.text === 112 || saved.text === 125) preferences.text = saved.text
  if (saved.traffic === 'low') preferences.traffic = 'low'
} catch { /* default display */ }
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
const get = () => preferences
export function reducedMotion(): boolean {
  return preferences.motion === 'reduced' || (preferences.motion === 'system' && typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
}
function apply(): void {
  document.documentElement.dataset.motion = reducedMotion() ? 'reduced' : 'full'
  document.documentElement.style.fontSize = `${preferences.text}%`
}
export function setDisplayPreferences(next: Partial<DisplayPreferences>): void {
  preferences = { ...preferences, ...next }
  try { localStorage.setItem(KEY, JSON.stringify(preferences)) } catch { /* session preference */ }
  apply(); for (const listener of listeners) listener()
}
export function installDisplay(): void {
  apply()
  window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => { apply(); for (const listener of listeners) listener() })
  document.addEventListener('visibilitychange', () => { document.documentElement.dataset.hidden = String(document.hidden) })
}
export function useDisplayPreferences(): DisplayPreferences { return useSyncExternalStore(subscribe, get) }
export function useReducedMotion(): boolean { return useSyncExternalStore(subscribe, reducedMotion) }
