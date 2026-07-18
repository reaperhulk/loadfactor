// Celebration toasts: the reward channel for game moments. Toasts are derived
// from GameEvents in the session (the engine stays presentation-free) and
// auto-dismiss; animations respect prefers-reduced-motion via CSS.

import { useEffect, useRef, useState } from 'react'
import { getAircraftType } from '../data/aircraft'
import type { GameEvent } from '../engine'

export interface Toast {
  id: number
  kind: 'route' | 'delivery' | 'slots' | 'event' | 'victory' | 'defeat' | 'error'
  icon: string
  text: string
}

const EVENT_ICONS: Record<string, string> = {
  recession: '📉',
  boom: '📈',
  oil_shock: '🛢️',
  olympics: '🏅',
  expo: '🎡',
  conflict: '⚠️',
  tourism_wave: '🏖️',
}

const EVENT_NAMES: Record<string, string> = {
  recession: 'Global recession',
  boom: 'Economic boom',
  oil_shock: 'Oil shock',
  olympics: 'Olympic Games',
  expo: "World's Fair",
  conflict: 'Regional conflict',
  tourism_wave: 'Tourism wave',
}

// Which events earn a toast, and how they read. Player-only for the personal
// ones; world events always show.
export function toastsFor(events: GameEvent[]): Omit<Toast, 'id'>[] {
  const out: Omit<Toast, 'id'>[] = []
  for (const e of events) {
    switch (e.type) {
      case 'command_rejected':
        // Immediate feedback beats a silent no-op — but only for the player's
        // own clicks (rival rejections are engine-internal noise).
        if (e.airline === 0) out.push({ kind: 'error', icon: '⚠️', text: e.reason })
        break
      case 'route_opened':
        if (e.airline === 0) out.push({ kind: 'route', icon: '✈️', text: `Route opened: ${e.from} – ${e.to}` })
        break
      case 'aircraft_delivered':
        if (e.airline === 0)
          out.push({ kind: 'delivery', icon: '🛬', text: `${getAircraftType(e.aircraftType).name} delivered` })
        break
      case 'slots_granted':
        if (e.airline === 0) out.push({ kind: 'slots', icon: '🤝', text: `Won ${e.slots} slots at ${e.city}` })
        break
      case 'world_event_started': {
        const where = e.city ? ` — ${e.city}` : e.region ? ` — ${e.region.toUpperCase()}` : ''
        out.push({
          kind: 'event',
          icon: EVENT_ICONS[e.eventId] ?? '🌍',
          text: `${EVENT_NAMES[e.eventId] ?? e.eventId}${where}`,
        })
        break
      }
      case 'game_over':
        out.push(
          e.result === 'won'
            ? { kind: 'victory', icon: '🏆', text: `Victory — ${e.reason}` }
            : { kind: 'defeat', icon: '🕯️', text: `Defeat — ${e.reason}` },
        )
        break
      default:
        break
    }
  }
  return out
}

const TOAST_MS = 4200

export function ToastStack({ events }: { events: GameEvent[] }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)
  const seen = useRef<GameEvent[] | null>(null)

  useEffect(() => {
    if (seen.current === events) return // only react to a new engine result
    seen.current = events
    const fresh = toastsFor(events)
    if (fresh.length === 0) return
    const stamped = fresh.map((t) => ({ ...t, id: nextId.current++ }))
    setToasts((prev) => [...prev, ...stamped].slice(-4)) // keep the stack short
    const ids = new Set(stamped.map((t) => t.id))
    const timer = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => !ids.has(t.id)))
    }, TOAST_MS)
    return () => clearTimeout(timer)
  }, [events])

  if (toasts.length === 0) return null
  return (
    <div className="toast-stack" data-testid="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          <span className="toast-icon">{t.icon}</span>
          {t.text}
        </div>
      ))}
    </div>
  )
}
