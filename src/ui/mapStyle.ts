import type { City } from '../data/cities'

export function cityMass(city: City): number {
  return city.pop * 4 + city.biz * 3 + city.tour * 2
}

// One color per rival, everywhere it appears (map arcs, panel chips).
export const RIVAL_COLORS = ['#d0636e', '#9d7bd8', '#d8a052'] as const

export function rivalColorClass(airlineId: number): string {
  return `rival-c${(airlineId - 1) % RIVAL_COLORS.length}`
}

// Level of detail: majors always visible, regionals from mid zoom, small
// fields only up close — plus anything the player has a stake in.
export function cityTier(city: City): 1 | 2 | 3 {
  const mass = cityMass(city)
  return mass >= 62 ? 1 : mass >= 45 ? 2 : 3
}
