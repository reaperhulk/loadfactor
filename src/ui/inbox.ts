import { useEffect, useState } from 'react'
import type { GameState } from '../engine'
import { isGrounded } from '../engine/queries'
import { idleSlotRent } from '../engine/slots'

const KEY = 'loadfactor:inbox:v1'
type Seen = Record<string, string[]>
function read(): Seen {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    if (value && typeof value === 'object' && !Array.isArray(value)) return Object.fromEntries(
      Object.entries(value).filter((entry): entry is [string, string[]] => Array.isArray(entry[1]) && entry[1].every((x: unknown) => typeof x === 'string')))
  } catch { /* Session-only acknowledgement when storage is unavailable. */ }
  return {}
}

export function inboxItems(state: GameState, seat: number, cashAfter: number): string[] {
  const a = state.airlines[seat]!
  return [
    ...a.fleet.filter((f) => f.routeId === null && !f.reserve && !isGrounded(f, state.turn)).map((f) => `idle-${f.id}`),
    ...a.fleet.filter((f) => isGrounded(f, state.turn)).map((f) => `grounded-${f.id}`),
    ...a.routes.filter((r) => r.lastCapacity > 0 && r.lastRevenue < r.lastCost).map((r) => `loss-${r.id}`),
    ...state.world.offers.filter((o) => (o.airline ?? 0) === seat).map((o) => `offer-${o.id}`),
    ...(cashAfter < 0 ? ['cash'] : []),
    ...(idleSlotRent(a) > 0 ? ['unused-slots'] : []),
    ...(a.fuelHedge?.quartersLeft === 1 ? ['hedge-expiry'] : []),
    ...state.airlines.filter((r) => r.id !== seat && r.campaign).map((r) => `campaign-${r.id}-${r.campaign!.untilTurn}`),
  ].map((id) => `${state.turn}:${id}`)
}

export function useInbox(state: GameState, seat: number, cashAfter: number, open: boolean): number {
  const [seen, setSeen] = useState(read)
  const career = `${state.scenario}:${state.seed}:${seat}`
  const signature = inboxItems(state, seat, cashAfter).sort().join('|')
  const items = signature ? signature.split('|') : []
  if (open && items.some((id) => !seen[career]?.includes(id))) {
    const keys = [...new Set([...(seen[career] ?? []).filter((id) => id.startsWith(`${state.turn}:`)), ...items])]
    setSeen(Object.fromEntries([...Object.entries(seen).filter(([key]) => key !== career).slice(-11), [career, keys]]))
  }
  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(seen)) } catch { /* session state still works */ }
  }, [seen])
  return open ? 0 : items.filter((id) => !seen[career]?.includes(id)).length
}
