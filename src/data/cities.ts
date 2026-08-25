import citiesJson from './cities.json'
import { DISTANCES_KM } from './distances.gen'

export type Region = 'na' | 'sa' | 'eu' | 'me' | 'af' | 'as' | 'oc'

export const REGIONS: readonly Region[] = ['na', 'sa', 'eu', 'me', 'af', 'as', 'oc']

export interface City {
  id: string
  name: string
  region: Region
  lat: number // projection is presentation-only (no trig in engine, PLAN.md §3.2); the SIGN feeds hemisphere seasonality
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
const indexById = new Map(CITY_IDS.map((id, index) => [id, index]))

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
  let i = indexById.get(a)
  let j = indexById.get(b)
  if (i === undefined || j === undefined || i === j) throw new Error(`no distance for ${a}-${b}`)
  if (i > j) [i, j] = [j, i]
  const offset = (i * (2 * CITY_IDS.length - i - 1)) / 2
  const distance = DISTANCES_KM[offset + j - i - 1]
  if (distance === undefined) throw new Error(`no distance for ${a}-${b}`)
  return distance
}
