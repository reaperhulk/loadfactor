// Content integrity: the data layer keeps its own promises.

import { describe, expect, it } from 'vitest'
import { AIRCRAFT } from '../../data/aircraft'
import { CITIES, CITY_IDS, distanceKm, getCity } from '../../data/cities'
import { SCENARIOS } from '../../data/scenarios'
import { WORLD_EVENTS } from '../../data/events'

describe('data integrity', () => {
  it('every city pair has a generated distance', () => {
    for (let i = 0; i < CITY_IDS.length; i++) {
      for (let j = i + 1; j < CITY_IDS.length; j++) {
        const d = distanceKm(CITY_IDS[i]!, CITY_IDS[j]!)
        expect(d).toBeGreaterThan(0)
        expect(d).toBeLessThan(20100) // half the Earth's circumference
        expect(distanceKm(CITY_IDS[j]!, CITY_IDS[i]!)).toBe(d) // order-independent
      }
    }
  })

  it('city ratings and slot pools are in range', () => {
    for (const c of CITIES) {
      expect(c.id).toMatch(/^[A-Z]{3}$/)
      for (const rating of [c.pop, c.biz, c.tour]) {
        expect(rating).toBeGreaterThanOrEqual(1)
        expect(rating).toBeLessThanOrEqual(10)
      }
      expect(c.slotPool).toBeGreaterThanOrEqual(8)
    }
  })

  it('aircraft are coherent', () => {
    for (const a of AIRCRAFT) {
      expect(a.seats).toBeGreaterThan(0)
      expect(a.rangeKm).toBeGreaterThan(500)
      expect(a.speedKmh).toBeGreaterThan(300)
      expect(a.price).toBeGreaterThan(0)
      expect(a.deliveryQuarters).toBeGreaterThanOrEqual(1)
      expect(a.availableFrom).toBeLessThan(a.availableTo)
    }
  })

  it('scenarios reference real cities and aircraft, with room to start', () => {
    for (const s of SCENARIOS) {
      for (const setup of [s.player, ...s.rivals]) {
        const hq = getCity(setup.hq)
        expect(setup.hqSlots).toBeLessThanOrEqual(hq.slotPool)
        for (const [city, slots] of Object.entries(setup.extraSlots)) {
          expect(getCity(city)).toBeDefined()
          expect(slots).toBeGreaterThan(0)
        }
        for (const type of setup.starterFleet) {
          expect(AIRCRAFT.some((a) => a.id === type)).toBe(true)
        }
      }
      // The combined starting slot grants must fit each city's pool.
      const allocated = new Map<string, number>()
      for (const setup of [s.player, ...s.rivals]) {
        allocated.set(setup.hq, (allocated.get(setup.hq) ?? 0) + setup.hqSlots)
        for (const [city, slots] of Object.entries(setup.extraSlots)) {
          allocated.set(city, (allocated.get(city) ?? 0) + slots)
        }
      }
      for (const [city, slots] of allocated) {
        expect(slots, `${s.id}: starting slots at ${city} fit the pool`).toBeLessThanOrEqual(
          getCity(city).slotPool,
        )
      }
    }
  })

  it('world events are coherent', () => {
    for (const e of WORLD_EVENTS) {
      expect(e.durationQuarters).toBeGreaterThan(0)
      expect(e.weight).toBeGreaterThan(0)
      if (e.target === 'city' || e.target === 'region') expect(e.demandModBp).toBeDefined()
    }
  })
})
