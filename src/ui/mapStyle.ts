import type { City } from '../data/cities'

export function cityMass(city: City): number {
  return city.pop * 4 + city.biz * 3 + city.tour * 2
}

// The map's semantic colors that a rival must never be mistaken for: a
// money-losing route (and the --neg text it pairs with) and a contested arc.
export const LOSS_COLOR = '#d0636e'
export const CONTESTED_COLOR = '#e08a4a'

// One color per rival, everywhere it appears (map arcs, traffic, the ownership
// key, panel chips, the race chart). Violet, chartreuse and orchid: all far
// from the loss red, the contested orange and the event gold, and from the
// default sky-blue livery, so "whose route" never reads as "losing route".
// (src/ui/__tests__/mapStyle.test.ts holds the distances.)
export const RIVAL_COLORS = ['#9a7cf5', '#b8d85c', '#e67ad8'] as const

function rivalIndex(airlineId: number): number {
  return (airlineId + RIVAL_COLORS.length - 1) % RIVAL_COLORS.length
}

export function rivalColor(airlineId: number): string {
  return RIVAL_COLORS[rivalIndex(airlineId)]!
}

export function rivalColorClass(airlineId: number): string {
  return `rival-c${rivalIndex(airlineId)}`
}

// The map's color lenses: who flies it (the default), or a route metric.
export type MapLens = 'none' | 'load' | 'profit' | 'season' | 'demand'

export const REGION_NAMES: Readonly<Record<string, string>> = {
  na: 'North America',
  sa: 'South America',
  eu: 'Europe',
  me: 'Middle East',
  af: 'Africa',
  as: 'Asia',
  oc: 'Oceania',
}

// Level of detail: majors always visible, regionals from mid zoom, small
// fields only up close — plus anything the player has a stake in.
export function cityTier(city: City): 1 | 2 | 3 {
  const mass = cityMass(city)
  // Majors are labeled at world view: the bar sits where the map still reads
  // as a world of named places (about thirty labels) rather than ten capitals
  // and a hundred anonymous dots.
  return mass >= 56 ? 1 : mass >= 40 ? 2 : 3
}
