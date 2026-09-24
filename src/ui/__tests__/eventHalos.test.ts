import { describe, expect, it } from 'vitest'
import { CITIES } from '../../data/cities'
import type { ActiveEvent } from '../../engine'
import { cityMass } from '../mapStyle'
import {
  MAX_CITY_HALOS_PER_EVENT,
  REGION_CITIES,
  REGION_COLLAPSE_BELOW_SCALE,
  REGION_HALO_CORE,
  eventHalos,
  regionHaloShape,
} from '../map/eventHalos'

const tourism: ActiveEvent = { id: 'tourism_wave', quartersLeft: 2, city: null, region: 'na' }
const olympics: ActiveEvent = { id: 'olympics', quartersLeft: 2, city: 'LAX', region: null }
const recession: ActiveEvent = { id: 'recession', quartersLeft: 2, city: null, region: null }

describe('event halos', () => {
  it('indexes every city under its region once, biggest market first', () => {
    let total = 0
    for (const [region, list] of REGION_CITIES) {
      total += list.length
      for (const c of list) expect(c.region).toBe(region)
      for (let i = 1; i < list.length; i++) expect(cityMass(list[i - 1]!)).toBeGreaterThanOrEqual(cityMass(list[i]!))
    }
    expect(total).toBe(CITIES.length)
  })

  it('collapses a region event into one halo at world zoom', () => {
    const h = eventHalos([tourism], 1)
    expect(h.cities).toHaveLength(0)
    expect(h.regions).toHaveLength(1)
    expect(h.regions[0]!.name).toBe('Tourism wave')
    expect(h.regions[0]!.core.length).toBeLessThanOrEqual(REGION_HALO_CORE)
    expect(h.regions[0]!.core[0]!.region).toBe('na')
  })

  it('marks only the biggest markets once zoomed in', () => {
    const h = eventHalos([tourism], REGION_COLLAPSE_BELOW_SCALE)
    expect(h.regions).toHaveLength(0)
    expect(h.cities.length).toBe(Math.min(MAX_CITY_HALOS_PER_EVENT, REGION_CITIES.get('na')!.length))
    expect(new Set(h.cities.map((c) => c.key)).size).toBe(h.cities.length)
  })

  it('rings a city event at any zoom and names every event in the legend', () => {
    for (const scale of [1, 3]) {
      const h = eventHalos([olympics, tourism, recession], scale)
      expect(h.cities.filter((c) => c.city.id === 'LAX' && c.eventId === 'olympics')).toHaveLength(1)
      // The recession moves the economy, not a place: nothing to draw.
      expect(h.legend.map((l) => l.name)).toEqual(['Olympic Games', 'Tourism wave'])
      expect(h.legend.map((l) => l.place)).toEqual(['Los Angeles', 'North America'])
      expect(h.legend.every((l) => l.good && l.pct > 0)).toBe(true)
    }
  })

  it('bounds the ring count however many events stack up', () => {
    const regions = ['na', 'sa', 'eu', 'me', 'af', 'as', 'oc'] as const
    const all = regions.map((region): ActiveEvent => ({ id: 'conflict', quartersLeft: 2, city: null, region }))
    expect(eventHalos(all, 1).cities).toHaveLength(0)
    expect(eventHalos(all, 1).regions).toHaveLength(regions.length)
    expect(eventHalos(all, 4).cities.length).toBeLessThanOrEqual(regions.length * MAX_CITY_HALOS_PER_EVENT)
    expect(eventHalos(all, 1).legend.every((l) => !l.good && l.pct < 0)).toBe(true)
  })

  it('fits the region shape around its core, padded', () => {
    expect(regionHaloShape([], 5)).toBeNull()
    const s = regionHaloShape([{ X: 0, Y: 0 }, { X: 100, Y: 40 }], 5)!
    expect(s).toEqual({ cx: 50, cy: 20, rx: 55, ry: 25 })
  })
})
