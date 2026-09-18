import { useCallback, useEffect, useState } from 'react'
import type { GameEvent, GameState } from '../engine/types'
import { getAircraftType } from '../data/aircraft'
import { distanceKm, getCity } from '../data/cities'
import { RunwayAircraft } from './RunwayAircraft'
import { Dialog } from './Dialog'
import { setDisplayPreferences, useDisplayPreferences, useReducedMotion } from './display'
import './celebration.css'

type Milestone = Extract<GameEvent, { type: 'aircraft_delivered' | 'route_opened' }>

// How long a scene plays before the report takes over, and how soon the same
// kind of scene may play again. A mature career takes sixty-odd deliveries;
// the first in a year is the moment, the rest are a toast.
export const CELEBRATION_MS = 2000
const REPEAT_QUARTERS = 4

// Consume each engine event batch once, including batches received while
// disabled. Preferences, rerenders, loading a save and changing seats must
// never replay a previous celebration. No presentation state enters the sim.
export function useCelebration(events: GameEvent[], seat: number, planning: boolean, turn = 0) {
  const preferences = useDisplayPreferences(), reduced = useReducedMotion()
  const enabled = preferences.celebrations && !reduced && planning
  // `shown` is the last turn each kind of scene played for this seat —
  // presentation memory only, carried in state so render stays pure.
  const [observed, setObserved] = useState<{ events: GameEvent[]; seat: number; shown: Record<string, number> }>({ events, seat, shown: {} })
  const [pending, setPending] = useState<Milestone[]>([])
  if (observed.events !== events || observed.seat !== seat) {
    const shown = observed.seat === seat ? { ...observed.shown } : {}
    const fresh = enabled && observed.events !== events ? events.filter((e): e is Milestone =>
      (e.type === 'aircraft_delivered' || e.type === 'route_opened') && e.airline === seat) : []
    const kinds = [...new Set(fresh.map((e) => e.type))].filter((k) => turn - (shown[k] ?? -REPEAT_QUARTERS) >= REPEAT_QUARTERS)
    for (const k of kinds) shown[k] = turn
    setObserved({ events, seat, shown })
    setPending(fresh.filter((e) => kinds.includes(e.type)))
  } else if (!enabled && pending.length) setPending([])
  const dismiss = useCallback(() => setPending([]), [])
  return { milestones: enabled ? pending : [], dismiss }
}

export function Celebration({ milestones, state, onClose }: {
  milestones: Milestone[]; state: GameState; onClose: () => void
}) {
  const event = milestones[0]!
  const airline = state.airlines[event.airline]!
  const delivery = event.type === 'aircraft_delivered'
  const type = delivery ? event.aircraftType : airline.fleet.find((a) => a.routeId === event.routeId)?.type ?? airline.fleet[0]?.type ?? 'caravelle'
  const title = delivery ? `${milestones.length === 1 ? 'Aircraft' : `${milestones.length} aircraft`} delivered` : 'New route opened'
  const detail = delivery
    ? [...new Set(milestones.filter((e) => e.type === 'aircraft_delivered').map((e) => getAircraftType(e.aircraftType).name))].join(' · ')
    : `${getCity(event.from).name} — ${getCity(event.to).name}`
  useEffect(() => {
    const timer = window.setTimeout(onClose, CELEBRATION_MS)
    // Returning to a hidden tab should not strand a modal or restart a flyby.
    const hide = () => { if (document.hidden) onClose() }
    document.addEventListener('visibilitychange', hide)
    return () => { window.clearTimeout(timer); document.removeEventListener('visibilitychange', hide) }
  }, [onClose, milestones])
  return <Dialog label={title} className="celebration-overlay" testId="celebration" onClose={onClose}>
    <section className={`celebration-card ${delivery ? 'delivery' : 'inauguration'}`} onKeyDown={(e) => {
      if (e.key === ' ' && (e.target as HTMLElement).tagName !== 'BUTTON') { e.preventDefault(); onClose() }
    }}>
      <header><span className="eyebrow">{airline.name} · {delivery ? 'Fleet arrival' : 'Network expansion'}</span><button autoFocus onClick={onClose} data-testid="skip-celebration">Skip animation <span aria-hidden="true">↗</span></button></header>
      <div className="celebration-scene" aria-hidden="true">
        <div className="celebration-sun" /><div className="celebration-hills" />
        <div className="celebration-perspective"><div className="celebration-ground"><div className="celebration-runway" /></div></div>
        <div className="celebration-shadow" /><div className="celebration-plane"><RunwayAircraft type={type} approaching={delivery} /></div>
        <span className="celebration-scene-label">{delivery ? 'WELCOME TO THE FLEET' : `${event.from} → ${event.to}`}</span>
      </div>
      <div className="celebration-copy"><span className="eyebrow">{delivery ? 'Ready for your next chapter' : `${distanceKm(event.from, event.to).toLocaleString('en-US')} km · A new connection`}</span><h2>{title}</h2><p>{detail}</p>
        <div className="celebration-footer"><span>{delivery ? 'Your aircraft are ready in Fleet.' : 'Plan aircraft and schedules in Routes.'}</span><button onClick={() => { setDisplayPreferences({ celebrations: false }); onClose() }}>Don’t show these again</button></div>
      </div><div className="celebration-progress" aria-hidden="true" />
    </section>
  </Dialog>
}
