// Celebration toasts: the reward channel for game moments. Toasts are derived
// from GameEvents in the session (the engine stays presentation-free) and
// auto-dismiss; animations respect prefers-reduced-motion via CSS.

import { useEffect, useRef, useState } from 'react'
import { AIRCRAFT, getAircraftType } from '../data/aircraft'
import { pairKey } from '../data/cities'
import { ROUTE_SPOOL_BP } from '../data/constants'
import { WORLD_EVENTS_V5 } from '../data/events'
import type { GameEvent, GameState } from '../engine'
import { quarterOf, yearOf } from '../engine/queries'
import { viewSeat } from './session'
import { money } from './format'

export interface Toast {
  id: number
  kind: 'route' | 'delivery' | 'slots' | 'event' | 'victory' | 'defeat' | 'error' | 'achievement'
  icon: string
  text: string
  // When set, clicking the toast opens this route's dossier (the battle card)
  // instead of merely dismissing — alerts should be actionable.
  routeId?: number
}

export const EVENT_ICONS: Record<string, string> = {
  recession: '📉',
  boom: '📈',
  oil_shock: '🛢️',
  olympics: '🏅',
  expo: '🎡',
  conflict: '⚠️',
  tourism_wave: '🏖️',
  travel_slump: '😷',
  alliance_boom: '🤝',
  airport_works: '🚧',
  currency_crisis: '💱',
}

// An offer is answered during planning turns up to and including the turn
// it expires on (it lapses as that quarter resolves).
export function decideWithin(expiresTurn: number, state?: GameState): string {
  if (!state) return 'decide soon'
  const quarters = expiresTurn - state.turn + 1
  return quarters <= 1 ? 'decide this quarter' : `decide within ${quarters} quarters`
}

export const EVENT_NAMES: Record<string, string> = {
  recession: 'Global recession',
  boom: 'Economic boom',
  oil_shock: 'Oil shock',
  olympics: 'Olympic Games',
  expo: "World's Fair",
  conflict: 'Regional conflict',
  tourism_wave: 'Tourism wave',
  travel_slump: 'Travel slump',
  alliance_boom: 'Alliance boom',
  airport_works: 'Runway reconstruction',
  currency_crisis: 'Currency crisis',
}

// What an event does, in a phrase the player can act on: "fuel +75%,
// demand −6%" for an oil shock, "demand ×0.50 there" for a conflict.
export function eventImpact(eventId: string): string {
  const def = WORLD_EVENTS_V5.find((d) => d.id === eventId)
  if (!def) return ''
  const parts: string[] = []
  const pct = (bp: number) => `${bp >= 10000 ? '+' : '−'}${Math.abs(Math.round((bp - 10000) / 100))}%`
  if (def.fuelModBp !== undefined) parts.push(`fuel ${pct(def.fuelModBp)}`)
  if (def.economyModBp !== undefined) parts.push(`demand ${pct(def.economyModBp)}`)
  if (def.demandModBp !== undefined) parts.push(`demand there ${pct(def.demandModBp)}`)
  parts.push(`${def.durationQuarters}q`)
  return parts.join(', ')
}

export function eventWhere(e: { city: string | null; region: string | null }): string {
  return e.city ? ` — ${e.city}` : e.region ? ` — ${e.region.toUpperCase()}` : ''
}

// Which events earn a toast, and how they read. Player-only for the personal
// ones; world events always show. `state` (post-resolution) lets rival moves
// onto the player's own pairs surface as incursion alerts.
export function toastsFor(events: GameEvent[], state?: GameState): Omit<Toast, 'id'>[] {
  const out: Omit<Toast, 'id'>[] = []
  const myPairs = new Set(state?.airlines[viewSeat()]?.routes.map((r) => pairKey(r.from, r.to)) ?? [])
  // A new year begins as a quarter resolves into Q1 — announce airframes
  // hitting the market. Fleet transitions are the era's drumbeat.
  if (state && quarterOf(state) === 1 && events.some((e) => e.type === 'quarter_report')) {
    for (const t of AIRCRAFT) {
      if (t.availableFrom === yearOf(state)) {
        out.push({ kind: 'delivery', icon: '🛒', text: `${t.name} is now on sale — ${t.seats} seats, ${t.rangeKm}km` })
      }
    }
  }
  // A route that just finished its spool-up is now at full market strength.
  if (state && events.some((e) => e.type === 'quarter_report')) {
    for (const r of state.airlines[viewSeat()]?.routes ?? []) {
      if (r.history.length === ROUTE_SPOOL_BP.length && r.lastCapacity > 0) {
        out.push({
          kind: 'route',
          icon: '📈',
          text: `${r.from} – ${r.to} is established — full demand from next quarter`,
          routeId: r.id,
        })
      }
    }
  }
  for (const e of events) {
    switch (e.type) {
      case 'operations_changed':
        out.push({ kind: 'event', icon: '✈', text: e.detail })
        break
      case 'command_rejected':
        // Immediate feedback beats a silent no-op — but only for the player's
        // own clicks (rival rejections are engine-internal noise).
        if (e.airline === viewSeat()) out.push({ kind: 'error', icon: '⚠️', text: e.reason })
        break
      case 'route_opened':
        if (e.airline === viewSeat()) {
          out.push({ kind: 'route', icon: '✈️', text: `Route opened: ${e.from} – ${e.to}` })
        } else if (myPairs.has(pairKey(e.from, e.to))) {
          const rival = state?.airlines[e.airline]?.name ?? 'A rival'
          const mine = state?.airlines[viewSeat()]?.routes.find((r) => pairKey(r.from, r.to) === pairKey(e.from, e.to))
          out.push({
            kind: 'error',
            icon: '⚔️',
            text: `${rival} moved onto ${e.from} – ${e.to}`,
            routeId: mine?.id,
          })
        }
        break
      case 'aircraft_delivered':
        if (e.airline === viewSeat())
          out.push({ kind: 'delivery', icon: '🛬', text: `${getAircraftType(e.aircraftType).name} delivered` })
        break
      case 'slots_granted':
        if (e.airline === viewSeat())
          out.push({
            kind: 'slots',
            icon: '🛬',
            text:
              e.waited > 1
                ? `${e.slots} slots at ${e.city} — ${e.waited}q in line`
                : `${e.slots} slots at ${e.city}`,
          })
        break
      case 'slots_released':
        if (e.airline === viewSeat())
          out.push({ kind: 'slots', icon: '↩️', text: `Handed ${e.slots} slots back at ${e.city}` })
        break
      case 'airport_expanded':
        out.push({ kind: 'slots', icon: '⚙', text: `${e.city} opened +${e.slots} slots` })
        break
      case 'world_event_announced':
        // Rules 6: the warning is the decision window — say what it will do.
        out.push({ kind: 'event', icon: '📡', text: `Next quarter: ${EVENT_NAMES[e.eventId] ?? e.eventId}${eventWhere(e)} (${eventImpact(e.eventId)})` })
        break
      case 'terminal_funded':
        if (e.airline === viewSeat()) out.push({ kind: 'slots', icon: '🏗️', text: `${e.city} programme funded — ${e.slots} slots open next quarter, the first ones yours` })
        break
      case 'airlift_flown':
        if (e.airline === viewSeat()) out.push({ kind: 'event', icon: '🛩️', text: `Airlift from ${e.city}: ${e.trips} round trips flown for the government` })
        break
      case 'world_event_started': {
        const where = eventWhere(e)
        out.push({
          kind: 'event',
          icon: EVENT_ICONS[e.eventId] ?? '🌍',
          text: `${EVENT_NAMES[e.eventId] ?? e.eventId}${where}`,
        })
        break
      }
      case 'rival_acquired': {
        const bought = state?.airlines[e.target]?.name ?? 'a rival'
        if (e.airline === viewSeat()) {
          out.push({
            kind: 'victory',
            icon: '💼',
            text: `Acquired ${bought} — ${e.aircraft} aircraft, ${e.routes} routes, and their debt`,
          })
        } else {
          // Consolidation among the rivals is market news the player should
          // hear: one fewer competitor, one bigger one.
          const buyer = state?.airlines[e.airline]?.name ?? 'A rival'
          out.push({ kind: 'event', icon: '💼', text: `${buyer} absorbed ${bought} — the market consolidates` })
        }
        break
      }
      case 'airline_restructured': {
        const who = state?.airlines[e.airline]?.name ?? 'A rival'
        out.push({
          kind: 'event',
          icon: '⚖️',
          text: `${who} restructured — creditors take a haircut, ${e.routesClosed} routes cut`,
        })
        break
      }
      case 'aircraft_grounded':
        if (e.airline === viewSeat()) {
          out.push({
            kind: 'error',
            icon: '🔧',
            text: `${getAircraftType(e.aircraftType).name} grounded for maintenance — ${e.repairK}k repair, out for ${e.quarters}q`,
          })
        }
        break
      case 'milestone_reached':
        out.push({
          kind: 'victory',
          icon: e.pctOfTarget >= 100 ? '🎯' : '📶',
          text:
            e.pctOfTarget >= 100
              ? `Target reached — ${e.label} bar cleared`
              : `${e.pctOfTarget}% of the ${e.label} target`,
        })
        break
      case 'offer_made':
        out.push({ kind: 'event', icon: '📨', text: `${e.headline} — ${decideWithin(e.expiresTurn, state)}` })
        break
      case 'offer_expired':
        out.push({ kind: 'error', icon: '⌛', text: `Offer lapsed: ${e.headline}` })
        break
      case 'airline_entered':
        out.push({ kind: 'event', icon: e.backed ? '🏛️' : '🚀', text: `${e.name} enters the market from ${e.hq}${e.capitalK ? ` with ${money(e.capitalK)}` : ''}` })
        break
      case 'aircraft_introduced':
        out.push({ kind: 'event', icon: '🆕', text: `${e.name} enters service — new types win extra appeal for two years` })
        break
      case 'strike_hit':
        if (e.airline === viewSeat()) out.push({ kind: 'error', icon: '✊', text: `Strike at ${e.city}: ${e.trips} round trips cancelled this quarter` })
        break
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

// Out-of-band announcements (clipboard confirmations, UI-side notices) ride
// the same toast stack as engine events. Fire-and-forget from anywhere.
type Announcement = Omit<Toast, 'id'>
const announceListeners = new Set<(a: Announcement) => void>()

export function announce(text: string, icon = '⎘', kind: Toast['kind'] = 'slots'): void {
  for (const l of announceListeners) l({ kind, icon, text })
}

export function ToastStack({
  events,
  state,
  unlocks,
  onOpenRoute,
}: {
  events: GameEvent[]
  state?: GameState
  // Achievements unlocked by the same engine call that produced `events` —
  // they ride the same batch so the dedupe key (the events array) covers both.
  unlocks?: { icon: string; name: string }[]
  onOpenRoute?: (routeId: number) => void
}) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)
  const seen = useRef<GameEvent[] | null>(null)
  const timers = useRef<number[]>([])

  const pushBatch = (fresh: Omit<Toast, 'id'>[]): void => {
    if (fresh.length === 0) return
    const stamped = fresh.map((t) => ({ ...t, id: nextId.current++ }))
    setToasts((prev) => [...prev, ...stamped].slice(-2)) // keep the stack short
    const ids = new Set(stamped.map((t) => t.id))
    timers.current.push(
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => !ids.has(t.id)))
      }, TOAST_MS),
    )
  }

  // UI-side announcements arrive outside the engine-event flow.
  useEffect(() => {
    const listener = (a: Announcement): void => pushBatch([a])
    announceListeners.add(listener)
    return () => {
      announceListeners.delete(listener)
    }
  }, [])

  useEffect(() => {
    if (seen.current === events) return // only react to a new engine result
    seen.current = events
    const fresh = toastsFor(events, state)
    if (unlocks?.length === 1) {
      fresh.push({ kind:'achievement',icon:unlocks[0]!.icon,text:`Achievement unlocked — ${unlocks[0]!.name}` })
    } else if (unlocks && unlocks.length > 1) {
      fresh.push({ kind:'achievement',icon:'★',text:`${unlocks.length} achievements unlocked · ${unlocks.map((a)=>a.name).join(' · ')}` })
    }
    if (fresh.length === 0) return
    const stamped = fresh.map((t) => ({ ...t, id: nextId.current++ }))
    setToasts((prev) => [...prev, ...stamped].slice(-2)) // keep the stack short
    const ids = new Set(stamped.map((t) => t.id))
    // Each batch owns its removal timer. Cancelling it when the next batch
    // arrived (the old cleanup) left earlier toasts on screen forever.
    timers.current.push(
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => !ids.has(t.id)))
      }, TOAST_MS),
    )
  }, [events, state, unlocks])

  // Timers are cleared only on unmount, never between batches.
  useEffect(() => {
    const pending = timers.current
    return () => {
      for (const t of pending) clearTimeout(t)
    }
  }, [])

  if (toasts.length === 0) return null
  return (
    <div className="toast-stack" data-testid="toasts" aria-live="polite">
      {toasts.map((t) => (
        <button
          key={t.id}
          className={`toast toast-${t.kind}`}
          title={t.routeId !== undefined && onOpenRoute ? 'open the route dossier' : 'dismiss'}
          data-route-id={t.routeId}
          onClick={() => {
            if (t.routeId !== undefined && onOpenRoute) onOpenRoute(t.routeId)
            setToasts((prev) => prev.filter((x) => x.id !== t.id))
          }}
        >
          <span className="toast-icon">{t.icon}</span>
          {t.text}
          {t.routeId !== undefined && onOpenRoute && <span className="dim"> — view route</span>}
        </button>
      ))}
    </div>
  )
}
