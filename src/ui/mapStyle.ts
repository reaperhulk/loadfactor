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

// The metric lenses' three buckets, as a colour-blind-safe diverging scale:
// blue for good, a warm near-white neutral, orange for bad — the pair that
// survives every common colour-vision deficiency, where the old green/red
// collapsed into one olive for one reader in twelve. Colour is never the only
// cue: the buckets are also solid, dashed and dotted (see LENS_DASH), and a
// loss draws wider. `none` is a route with no quarter flown yet, grey so it
// cannot pass for any bucket. map.css carries the same values
// (mapStyle.test.ts checks they agree, and the separations under simulated
// deuteranopia, protanopia and tritanopia, and the contrast on the map).
export const LENS_COLORS = {
  good: '#7cb9ff',
  mid: '#e3ddcf',
  bad: '#ff9a3c',
  none: '#6f7f88',
} as const
export type LensBucket = keyof typeof LENS_COLORS
export const LENS_DASH: Readonly<Record<LensBucket, string>> = {
  good: 'none',
  mid: '7 3',
  bad: '2 3.5',
  none: '2 5',
}

// What each bucket means under each metric lens, for the key.
export const LENS_LABELS: Readonly<Record<'load' | 'profit' | 'season', Readonly<Record<'good' | 'mid' | 'bad', string>>>> = {
  load: { good: '≥80% full', mid: '55–79%', bad: '<55%' },
  profit: { good: '≥15% margin', mid: '0–14%', bad: 'Loss' },
  season: { good: 'High season', mid: 'Neutral', bad: 'Low season' },
}

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
