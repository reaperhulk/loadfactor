// Which world events the map marks, and how. A region-wide event used to put
// a ring on every city in the region — twenty-five unlabeled gold circles over
// North America after the first quarter, with nothing saying what they meant.
// Now a region reads as ONE labeled halo at world zoom, individual cities only
// once you are close enough for them to be separate places (and then only the
// region's biggest markets), and every event gets a legend line.

import { CITIES, getCity, type City, type Region } from '../../data/cities'
import { getEventDef } from '../../data/events'
import type { ActiveEvent } from '../../engine'
import { REGION_NAMES, cityMass } from '../mapStyle'

// Region → its cities, heaviest market first (ties by id). Built once rather
// than filtering the whole catalogue per event per render.
export const REGION_CITIES: ReadonlyMap<Region, readonly City[]> = (() => {
  const out = new Map<Region, City[]>()
  for (const c of CITIES) {
    const list = out.get(c.region) ?? []
    list.push(c)
    out.set(c.region, list)
  }
  for (const list of out.values()) list.sort((a, b) => cityMass(b) - cityMass(a) || (a.id < b.id ? -1 : 1))
  return out
})()

// Below this zoom a region event is one halo; above it, per-city rings.
export const REGION_COLLAPSE_BELOW_SCALE = 1.8
// Close up, a region still marks only its biggest markets.
export const MAX_CITY_HALOS_PER_EVENT = 6
// The region halo is fitted around this many of its biggest markets — the
// core of the region, not its farthest outpost (Honolulu is "Oceania").
export const REGION_HALO_CORE = 6

export interface CityHalo {
  key: string
  eventId: string
  good: boolean
  city: City
}

export interface RegionHalo {
  key: string
  eventId: string
  good: boolean
  name: string
  region: Region
  core: readonly City[]
}

export interface EventLegendEntry {
  key: string
  name: string
  place: string
  good: boolean
  // Demand change at the target, whole percent (+25, -50).
  pct: number
}

export interface EventHalos {
  cities: CityHalo[]
  regions: RegionHalo[]
  legend: EventLegendEntry[]
}

export function eventHalos(events: readonly ActiveEvent[], scale: number): EventHalos {
  const out: EventHalos = { cities: [], regions: [], legend: [] }
  for (const e of events) {
    const def = getEventDef(e.id)
    if (def.demandModBp === undefined) continue
    const good = def.demandModBp >= 10000
    const key = `${e.id}-${e.city ?? e.region ?? 'world'}`
    const pct = Math.round((def.demandModBp - 10000) / 100)
    if (e.city !== null) {
      const city = getCity(e.city)
      out.cities.push({ key, eventId: e.id, good, city })
      out.legend.push({ key, name: def.name, place: city.name, good, pct })
      continue
    }
    if (e.region === null) continue
    const members = REGION_CITIES.get(e.region) ?? []
    if (members.length === 0) continue
    out.legend.push({ key, name: def.name, place: REGION_NAMES[e.region] ?? e.region, good, pct })
    if (scale < REGION_COLLAPSE_BELOW_SCALE) {
      out.regions.push({ key, eventId: e.id, good, name: def.name, region: e.region, core: members.slice(0, REGION_HALO_CORE) })
    } else {
      for (const city of members.slice(0, MAX_CITY_HALOS_PER_EVENT)) {
        out.cities.push({ key: `${key}-${city.id}`, eventId: e.id, good, city })
      }
    }
  }
  return out
}

// An ellipse around a region's core markets as drawn (projected points, so it
// works for the flat map and the globe alike), padded so the markers sit
// inside it. Null when none of the core is on screen.
export function regionHaloShape(
  points: readonly { X: number; Y: number }[],
  pad: number,
): { cx: number; cy: number; rx: number; ry: number } | null {
  if (points.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of points) {
    minX = Math.min(minX, p.X)
    maxX = Math.max(maxX, p.X)
    minY = Math.min(minY, p.Y)
    maxY = Math.max(maxY, p.Y)
  }
  return {
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    rx: (maxX - minX) / 2 + pad,
    ry: (maxY - minY) / 2 + pad,
  }
}
