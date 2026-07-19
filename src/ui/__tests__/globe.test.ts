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
