// The map claims to be the real world. These tests hold it to that.
//
// Two failure modes are worth guarding against, and both have bitten real
// projects: the geometry drifting from the projection that places the cities
// (so airports float in the sea), and a generator regression quietly dropping
// or mangling continents. Everything here is checked against published
// coordinates, not against a previous render.

import { describe, expect, it } from 'vitest'
import { CITIES, getCity } from '../../data/cities'
import {
  BORDERS_PATH,
  MAP_H,
  MAP_LAT_MAX,
  MAP_LAT_MIN,
  MAP_W,
  ISLETS_PATH,
  ISLET_CITIES,
  WORLD_PATH,
  WORLD_PATH_FINE,
  WORLD_RINGS,
  projectLat,
  projectLon,
} from '../../data/worldmap.gen'

// Parse "M x,y L x,y ... Z" subpaths back into rings of points.
function ringsFromPath(d: string): [number, number][][] {
  const rings: [number, number][][] = []
  for (const chunk of d.split('M').slice(1)) {
    const pts = chunk
      .replace(/Z$/, '')
      .split('L')
      .map((pair) => pair.split(',').map(Number) as [number, number])
      .filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))
    if (pts.length >= 3) rings.push(pts)
  }
  return rings
}

const landRings = ringsFromPath(WORLD_PATH_FINE)

// Even-odd point-in-polygon across every ring: land is the union of rings, and
// a point inside an odd number of them is on land.
function insideLand(px: number, py: number): boolean {
  for (const ring of landRings) {
    let inside = false
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]!
      const [xj, yj] = ring[j]!
      if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
    }
    if (inside) return true
  }
  return false
}

// How far (in projected px) the nearest coastline vertex is.
function distanceToCoast(px: number, py: number): number {
  let best = Infinity
  for (const ring of landRings) {
    for (const [vx, vy] of ring) {
      const d = Math.hypot(vx - px, vy - py)
      if (d < best) best = d
    }
  }
  return best
}

describe('the projection', () => {
  it('is equirectangular over the cropped latitude band', () => {
    // Corners of the frame, by definition.
    expect(projectLon(-180)).toBeCloseTo(0, 6)
    expect(projectLon(180)).toBeCloseTo(MAP_W, 6)
    expect(projectLat(MAP_LAT_MAX)).toBeCloseTo(0, 6)
    expect(projectLat(MAP_LAT_MIN)).toBeCloseTo(MAP_H, 6)
    // Greenwich and the equator land where a schoolroom map puts them.
    expect(projectLon(0)).toBeCloseTo(MAP_W / 2, 6)
    expect(projectLat(0)).toBeCloseTo((MAP_LAT_MAX / (MAP_LAT_MAX - MAP_LAT_MIN)) * MAP_H, 6)
    // Linear and monotonic: no hidden Mercator stretch.
    const dLat = projectLat(10) - projectLat(20)
    expect(projectLat(50) - projectLat(60)).toBeCloseTo(dLat, 6)
    expect(projectLat(-30) - projectLat(-20)).toBeCloseTo(dLat, 6)
  })

  it('keeps degrees square, so continents are not stretched', () => {
    // One degree of longitude and one of latitude must measure the same in
    // pixels, or Africa comes out tall and Russia comes out squat.
    const pxPerLon = projectLon(1) - projectLon(0)
    const pxPerLat = projectLat(0) - projectLat(1)
    expect(pxPerLat).toBeCloseTo(pxPerLon, 2)
  })

  it('frames every city with room to spare', () => {
    for (const c of CITIES) {
      expect(c.lat, `${c.id} inside the northern crop`).toBeLessThan(MAP_LAT_MAX - 2)
      expect(c.lat, `${c.id} inside the southern crop`).toBeGreaterThan(MAP_LAT_MIN + 2)
      const px = projectLon(c.lon)
      const py = projectLat(c.lat)
      expect(px).toBeGreaterThanOrEqual(0)
      expect(px).toBeLessThanOrEqual(MAP_W)
      expect(py).toBeGreaterThanOrEqual(0)
      expect(py).toBeLessThanOrEqual(MAP_H)
    }
  })
})

describe('the landmass is the real world', () => {
  it('puts known landmarks on land and known ocean in the sea', () => {
    // Interior points, comfortably away from any coast.
    const onLand: [string, number, number][] = [
      ['central Australia', 133, -24],
      ['the Sahara', 10, 24],
      ['Siberia', 90, 62],
      ['the Amazon basin', -62, -5],
      ['the Great Plains', -100, 41],
      ['the Deccan', 77, 19],
      ['Kazakhstan', 67, 48],
      ['the Congo', 22, -2],
    ]
    for (const [name, lon, lat] of onLand) {
      expect(insideLand(projectLon(lon), projectLat(lat)), name).toBe(true)
    }
    const atSea: [string, number, number][] = [
      ['the mid-Atlantic', -30, 25],
      ['the central Pacific', -150, 0],
      ['the southern Indian Ocean', 80, -40],
      ['the Bay of Bengal', 88, 14],
      ['the Gulf of Guinea', 0, 0],
      ['the Tasman Sea', 160, -40],
    ]
    for (const [name, lon, lat] of atSea) {
      expect(insideLand(projectLon(lon), projectLat(lat)), name).toBe(false)
    }
  })

  it('lands every airport on or beside its own coastline', () => {
    // Cities are real airports at real coordinates; the coastline is Natural
    // Earth at 1:50m. An airport more than a few pixels out to sea means the
    // geometry and the projection have come apart.
    const strays: string[] = []
    for (const c of CITIES) {
      const px = projectLon(c.lon)
      const py = projectLat(c.lat)
      if (insideLand(px, py)) continue
      // Islands below the dataset's resolution get an isle drawn for them.
      if (ISLET_CITIES.includes(c.id)) continue
      const d = distanceToCoast(px, py)
      if (d > 4) strays.push(`${c.id} (${c.name}) ${d.toFixed(1)}px offshore`)
    }
    expect(strays, 'airports adrift from the coastline').toEqual([])
  })

  it('draws an island under every airport the coastline is too coarse to carry', () => {
    // The islet list is derived, not hand-kept: every city it names must be a
    // city, and each one must actually get geometry drawn for it.
    for (const id of ISLET_CITIES) expect(CITIES.some((c) => c.id === id), id).toBe(true)
    expect(ISLETS_PATH.split('M').length - 1).toBe(ISLET_CITIES.length)
  })

  it('spans the whole world without a seam artefact', () => {
    const xs = landRings.flatMap((r) => r.map(([px]) => px))
    const ys = landRings.flatMap((r) => r.map(([, py]) => py))
    expect(Math.min(...xs)).toBeLessThan(4) // the Aleutians reach the left edge
    expect(Math.max(...xs)).toBeGreaterThan(MAP_W - 4) // and the right
    expect(Math.min(...ys)).toBeLessThan(4)
    expect(Math.max(...ys)).toBeGreaterThan(MAP_H - 40)
    // Nothing may run more than half the world in one straight hop: that is
    // the signature of a ring crossing the antimeridian unsplit, which used to
    // paint a band across the Pacific.
    for (const ring of landRings) {
      for (let i = 1; i < ring.length; i++) {
        expect(Math.abs(ring[i]![0] - ring[i - 1]![0])).toBeLessThan(MAP_W / 2)
      }
    }
  })

  it('carries two levels of detail and separate borders', () => {
    const coarse = ringsFromPath(WORLD_PATH)
    expect(coarse.length).toBeGreaterThan(30)
    expect(landRings.length).toBeGreaterThan(coarse.length)
    const coarsePoints = coarse.reduce((n, r) => n + r.length, 0)
    const finePoints = landRings.reduce((n, r) => n + r.length, 0)
    expect(finePoints).toBeGreaterThan(coarsePoints * 2)
    // Borders are a separate mesh of open lines, never closed rings — if they
    // were coastline copies they would come back closed.
    expect(BORDERS_PATH.length).toBeGreaterThan(1000)
    expect(BORDERS_PATH).not.toContain('Z')
  })

  it('keeps the globe rings in lon/lat, poles included', () => {
    const lats = WORLD_RINGS.flatMap((r) => r.map(([, lat]) => lat))
    const lons = WORLD_RINGS.flatMap((r) => r.map(([lon]) => lon))
    expect(Math.min(...lats)).toBeLessThan(-70) // a sphere has Antarctica
    expect(Math.max(...lats)).toBeGreaterThan(75)
    expect(Math.min(...lons)).toBeGreaterThanOrEqual(-180)
    expect(Math.max(...lons)).toBeLessThanOrEqual(180)
  })
})

describe('city coordinates', () => {
  it('agree with published airport positions', () => {
    // Spot-checks against real airport coordinates: a transposed sign or a
    // swapped lat/lon shows up here long before anyone notices on screen.
    const known: [string, number, number][] = [
      ['JFK', 40.64, -73.78],
      ['LHR', 51.47, -0.45],
      ['HND', 35.55, 139.78],
      ['SYD', -33.94, 151.18],
      ['GRU', -23.43, -46.47],
      ['JNB', -26.13, 28.24],
      ['LAX', 33.94, -118.4],
      ['DXB', 25.25, 55.36],
    ]
    for (const [id, lat, lon] of known) {
      const c = getCity(id)
      expect(Math.abs(c.lat - lat), `${id} latitude`).toBeLessThan(0.6)
      expect(Math.abs(c.lon - lon), `${id} longitude`).toBeLessThan(0.6)
    }
  })
})
