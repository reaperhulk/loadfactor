import citiesJson from './cities.json'
import { DISTANCES_KM } from './distances.gen'

export type Region = 'na' | 'sa' | 'eu' | 'me' | 'af' | 'as' | 'oc'

export const REGIONS: readonly Region[] = ['na', 'sa', 'eu', 'me', 'af', 'as', 'oc']

export interface City {
  id: string
  name: string
  region: Region
  lat: number // presentation only — the engine never does trig, see PLAN.md §3.2
  lon: number
  pop: number // 1–10 authored demand ratings
  biz: number
  tour: number
  slotPool: number // total slots grantable across all airlines
}

export const CITIES: readonly City[] = citiesJson as City[]

// Ascending id — the canonical iteration order everywhere in the engine.
export const CITY_IDS: readonly string[] = CITIES.map((c) => c.id).sort()

const byId = new Map(CITIES.map((c) => [c.id, c]))

export function getCity(id: string): City {
  const c = byId.get(id)
  if (!c) throw new Error(`unknown city ${id}`)
  return c
}

export function isCity(id: string): boolean {
  return byId.has(id)
}

// Canonical undirected pair key: lexicographically smaller id first.
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`
}

export function distanceKm(a: string, b: string): number {
  const d = DISTANCES_KM[pairKey(a, b)]
  if (d === undefined) throw new Error(`no distance for ${a}-${b}`)
  return d
}
