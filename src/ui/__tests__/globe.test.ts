// The globe unprojection must invert the projection on the visible
// hemisphere — cursor-anchored zoom points at the wrong terrain otherwise.

import { describe, expect, it } from 'vitest'
import { getCity } from '../../data/cities'
import { MAP_H, MAP_W } from '../../data/worldmap.gen'
import { GLOBE_R, globeArc, globeArcPath, globeProjectFull, globeRoutePath, globeTripLeg, globeUnproject, type GlobeArcPoint } from '../map/globe'

describe('globe unprojection', () => {
  it('round-trips visible points through project → unproject', () => {
    const views = [
      { cLon: -40, cLat: 30, s: 1 },
      { cLon: 120, cLat: -20, s: 2.5 },
      { cLon: 0, cLat: 0, s: 1.7 },
    ]
    const points = [
      { lon: -73, lat: 40 }, // NYC-ish
      { lon: 2, lat: 48 }, // Paris-ish
      { lon: 139, lat: 35 }, // Tokyo-ish
      { lon: 151, lat: -33 }, // Sydney-ish
      { lon: -43, lat: -22 }, // Rio-ish
    ]
    for (const g of views) {
      for (const p of points) {
        const proj = globeProjectFull(g, p.lon, p.lat)
        if (proj.cosc <= 0.05) continue // back side or grazing the limb
        const back = globeUnproject(g, proj.X, proj.Y)
        expect(back).not.toBeNull()
        // Longitudes compare modulo 360.
        let dLon = back!.lon - p.lon
        while (dLon > 180) dLon -= 360
        while (dLon < -180) dLon += 360
        expect(Math.abs(dLon)).toBeLessThan(0.01)
        expect(Math.abs(back!.lat - p.lat)).toBeLessThan(0.01)
      }
    }
  })

  it('returns null off the disc', () => {
    expect(globeUnproject({ cLon: 0, cLat: 0, s: 1 }, 0, 0)).toBeNull()
  })
})

// SVG uses nonzero winding. Test the rendered footprint, including the implicit
// closing edge of each subpath, rather than only the emitted coastline points.
function filled(path: string, x: number, y: number): boolean {
  let winding = 0
  for (const subpath of path.split('Z')) {
    const points = [...subpath.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => [+m[1]!, +m[2]!] as const)
    for (let i = 0; i < points.length; i++) {
      const a = points[i]!, b = points[(i+1)%points.length]!
      const cross = (b[0]-a[0])*(y-a[1])-(x-a[0])*(b[1]-a[1])
      if (a[1] <= y && b[1] > y && cross > 0) winding++
      if (a[1] > y && b[1] <= y && cross < 0) winding--
    }
  }
  return winding !== 0
}

import { globeLandPath, ringTrigTables } from '../map/globe'
import geometry from '../../data/globemap.gen.json'
import type { GlobeGeometry } from '../globeGeometry'

it('keeps the same land footprint when a coastline ring starts behind the horizon', () => {
  const g = { cLon: 0, cLat: 0, s: 1 }
  const ring = [[0, -30], [100, -30], [110, 0], [100, 30], [0, 30]] as const
  const paths = ring.map((_, i) => globeLandPath(g, [[...ring.slice(i), ...ring.slice(0,i)]]))
  for (let x = 330; x < 640; x += 7) for (let y = 25; y < 335; y += 7) {
    expect(paths.map((path) => filled(path, x, y)), `ring start must not change land at ${x},${y}`)
      .toEqual(paths.map(() => filled(paths[0]!, x, y)))
  }
})

it('keeps Atlantic water clear while Africa rotates across the horizon', () => {
  const data = geometry as unknown as GlobeGeometry
  for (const rings of [data.WORLD_RINGS, data.WORLD_RINGS_FINE]) {
    for (const cLon of [0,10,20,30,40]) for (const cLat of [-30,-20,-10,0,10]) {
      const g = { cLon, cLat, s: 1 }
      const path = globeLandPath(g, rings)
      for (const [lon, lat] of [[-40,30],[-35,15],[-25,0],[-15,-25],[65,-20]]) {
        const p = globeProjectFull(g, lon!, lat!)
        if (p.cosc > .1) expect(filled(path,p.X,p.Y), `ocean ${lon},${lat} viewed from ${cLon},${cLat}`).toBe(false)
      }
      const africa = globeProjectFull(g, 20, 0)
      expect(filled(path,africa.X,africa.Y), 'Africa remains filled').toBe(true)
    }
  }
})

// The land path used to call the full projection (five trig calls) per
// vertex per frame of rotation. It now reads cached per-vertex trig; this is
// the old, direct version, kept as the reference the cache must reproduce.
function referenceLandPath(g: { cLon: number; cLat: number; s: number }, rings: readonly (readonly (readonly [number, number])[])[]): string {
  const R = 160 * g.s
  const cx = 960 / 2
  const cy = 352 / 2
  const parts: string[] = []
  for (const ring of rings) {
    const points = ring.map(([lon, lat]) => globeProjectFull(g, lon, lat))
    const start = points.findIndex((p) => p.cosc > 0.001)
    if (start < 0) continue
    let d = ''
    let prevLimbAz: number | null = null
    const emit = (px: number, py: number): void => { d += `${d === '' ? 'M' : 'L'}${px.toFixed(1)} ${py.toFixed(1)}` }
    for (let i = 0; i < points.length; i++) {
      const p = points[(start + i) % points.length]!
      if (p.cosc > 0.001) { emit(p.X, p.Y); prevLimbAz = null; continue }
      if (p.cosc < -0.55) continue
      const az = Math.atan2(p.Y - cy, p.X - cx)
      if (prevLimbAz !== null) {
        let delta = az - prevLimbAz
        while (delta > Math.PI) delta -= 2 * Math.PI
        while (delta < -Math.PI) delta += 2 * Math.PI
        const steps = Math.floor(Math.abs(delta) / 0.2)
        for (let s = 1; s <= steps; s++) { const a = prevLimbAz + (delta * s) / (steps + 1); emit(cx + R * Math.cos(a), cy + R * Math.sin(a)) }
      }
      emit(cx + R * Math.cos(az), cy + R * Math.sin(az))
      prevLimbAz = az
    }
    parts.push(d + 'Z')
  }
  return parts.join('')
}

it('projects land from cached ring trig, identical to the direct projection', () => {
  const data = geometry as unknown as GlobeGeometry
  // Cached once per ring set, reused by every later view.
  expect(ringTrigTables(data.WORLD_RINGS)).toBe(ringTrigTables(data.WORLD_RINGS))
  for (const g of [{ cLon: -40, cLat: 30, s: 1 }, { cLon: 137.3, cLat: -12.8, s: 2.2 }, { cLon: -179.9, cLat: 79, s: 1.4 }]) {
    const fast = globeLandPath(g, data.WORLD_RINGS)
    const ref = referenceLandPath(g, data.WORLD_RINGS)
    const nums = (d: string) => [...d.matchAll(/-?[\d.]+/g)].map((m) => Number(m[0]))
    const a = nums(fast)
    const b = nums(ref)
    expect(a.length).toBe(b.length)
    // Equal up to the last printed digit (a rounding boundary may flip).
    for (let i = 0; i < a.length; i++) expect(Math.abs(a[i]! - b[i]!)).toBeLessThanOrEqual(0.1 + 1e-9)
  }
})

describe('globe routes', () => {
  const JFK = { lon: -73.8, lat: 40.6 }
  const LHR = { lon: -0.5, lat: 51.5 }
  const MIA = { lon: -80.3, lat: 25.8 }
  const SEA = { lon: -122.3, lat: 47.4 }
  const home = { cLon: -40, cLat: 30, s: 1 }
  // Distance of a point from the chord between the arc's ends, in viewBox units.
  const offChord = (pts: readonly GlobeArcPoint[], p: GlobeArcPoint): number => {
    const a = pts[0]!
    const b = pts.at(-1)!
    const dx = b.X - a.X
    const dy = b.Y - a.Y
    return Math.abs((p.X - a.X) * dy - (p.Y - a.Y) * dx) / Math.hypot(dx, dy)
  }

  it('starts and ends on the airports', () => {
    const pts = globeArc(home, JFK, LHR)
    const a = globeProjectFull(home, JFK.lon, JFK.lat)
    const b = globeProjectFull(home, LHR.lon, LHR.lat)
    expect(pts[0]!.X).toBeCloseTo(a.X, 6)
    expect(pts[0]!.Y).toBeCloseTo(a.Y, 6)
    expect(pts.at(-1)!.X).toBeCloseTo(b.X, 6)
    expect(pts.at(-1)!.Y).toBeCloseTo(b.Y, 6)
  })

  it('bows off the straight chord, more for a longer route', () => {
    // SEA-MIA crosses near the disc's middle, where a bare great circle is
    // nearly a ruler line: the review's "chords across the sphere".
    for (const [from, to] of [[JFK, LHR], [SEA, MIA]] as const) {
      const pts = globeArc(home, from, to)
      expect(pts.length).toBeGreaterThan(8)
      const bow = Math.max(...pts.map((p) => offChord(pts, p)))
      expect(bow, 'a visible curve, not a chord').toBeGreaterThan(4)
    }
    const short = globeArc(home, JFK, MIA)
    const long = globeArc(home, SEA, MIA)
    expect(Math.max(...long.map((p) => offChord(long, p)))).toBeGreaterThan(Math.max(...short.map((p) => offChord(short, p))))
  })

  it('draws a smooth multi-segment path', () => {
    const d = globeRoutePath(home, 'JFK', 'LHR')
    expect(d.startsWith('M')).toBe(true)
    expect((d.match(/L/g) ?? []).length).toBeGreaterThan(8)
  })

  it('hides the part of a route behind the globe', () => {
    // Looking at the Pacific, New York and London are on the far side.
    const pacific = { cLon: 170, cLat: 0, s: 1 }
    const pts = globeArc(pacific, JFK, LHR)
    expect(pts.every((p) => !p.vis)).toBe(true)
    expect(globeArcPath(pts)).toBe('')
    // Straddling the limb: the far end is hidden, the near end drawn, and
    // no hidden sample ever sits inside the disc on the near side.
    const limb = { cLon: -150, cLat: 20, s: 1 }
    const cross = globeArc(limb, SEA, LHR)
    expect(cross[0]!.vis).toBe(true)
    expect(cross.at(-1)!.vis).toBe(false)
    const R = GLOBE_R * limb.s
    for (const p of cross) {
      if (!p.vis) expect(Math.hypot(p.X - MAP_W / 2, p.Y - MAP_H / 2)).toBeLessThanOrEqual(R + 1e-9)
    }
    expect(globeTripLeg(limb, 'SEA', 'LHR')).toBeNull()
  })

  it('gives the shuttle the same curve the arc draws', () => {
    const leg = globeTripLeg(home, 'JFK', 'ORD')!
    const pts = globeArc(home, getCity('JFK'), getCity('ORD'))
    expect(leg.pts.length).toBe(pts.length * 2)
    expect(leg.pts[2]).toBeCloseTo(pts[1]!.X, 9)
  })
})
