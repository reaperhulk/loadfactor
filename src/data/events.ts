import type { Region } from './cities'

// World event deck (PLAN.md §2.3). Modifiers are basis points (10000 = ×1) and
// are applied at read time while the event is active — the underlying economy
// and fuel walks are never mutated by events.

export type EventTarget = 'global' | 'city' | 'region'

export interface WorldEventDef {
  id: string
  name: string
  target: EventTarget
  durationQuarters: number
  weight: number // relative draw weight when eligible
  fromYear: number
  toYear: number
  economyModBp?: number // multiplier on effective economy index
  fuelModBp?: number // multiplier on effective fuel index
  demandModBp?: number // multiplier on demand at the target city/region
  region?: Region // fixed region, else drawn (target 'region')
}

export const WORLD_EVENTS: readonly WorldEventDef[] = [
  {
    id: 'recession',
    name: 'Global recession',
    target: 'global',
    durationQuarters: 4,
    weight: 20,
    fromYear: 1950,
    toYear: 2100,
    economyModBp: 8600,
  },
  {
    id: 'boom',
    name: 'Economic boom',
    target: 'global',
    durationQuarters: 4,
    weight: 20,
    fromYear: 1950,
    toYear: 2100,
    economyModBp: 11200,
  },
  {
    id: 'oil_shock',
    name: 'Oil shock',
    target: 'global',
    durationQuarters: 6,
    weight: 10,
    fromYear: 1965,
    toYear: 2100,
    fuelModBp: 17500,
    economyModBp: 9400,
  },
  {
    id: 'olympics',
    name: 'Olympic Games',
    target: 'city',
    durationQuarters: 2,
    weight: 16,
    fromYear: 1950,
    toYear: 2100,
    demandModBp: 16000,
  },
  {
    id: 'expo',
    name: "World's Fair",
    target: 'city',
    durationQuarters: 3,
    weight: 12,
    fromYear: 1950,
    toYear: 2100,
    demandModBp: 13000,
  },
  {
    id: 'conflict',
    name: 'Regional conflict',
    target: 'region',
    durationQuarters: 4,
    weight: 12,
    fromYear: 1950,
    toYear: 2100,
    demandModBp: 5000,
  },
  {
    id: 'tourism_wave',
    name: 'Tourism wave',
    target: 'region',
    durationQuarters: 4,
    weight: 14,
    fromYear: 1958,
    toYear: 2100,
    demandModBp: 12500,
  },
]

const byId = new Map(WORLD_EVENTS.map((e) => [e.id, e]))

export function getEventDef(id: string): WorldEventDef {
  const e = byId.get(id)
  if (!e) throw new Error(`unknown world event ${id}`)
  return e
}
