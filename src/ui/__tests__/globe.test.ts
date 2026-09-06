// The globe unprojection must invert the projection on the visible
// hemisphere — cursor-anchored zoom points at the wrong terrain otherwise.

import { describe, expect, it } from 'vitest'
import { globeProjectFull, globeUnproject } from '../MapView'

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

import { globeLandPath } from '../MapView'
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
