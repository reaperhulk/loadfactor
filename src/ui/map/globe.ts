// Orthographic ("globe") projection math and the geography paths drawn on
// it. Pure functions of a GlobeView; presentation-only floats — the engine
// never sees any of this.

import { getCity } from '../../data/cities'
import { MAP_H, MAP_W } from '../../data/worldmap.gen'
import { polylineLeg, type TrafficLeg } from '../traffic'
import { MAX_SCALE } from './camera'

const W = MAP_W
const H = MAP_H

// ---- Globe (orthographic) projection ----------------------------------
// The map can render as a rotatable globe: drag spins it, wheel zooms it,
// routes follow real great circles, and the back hemisphere is culled.

export interface GlobeView {
  cLon: number // longitude at the center of the disc
  cLat: number // latitude at the center of the disc
  s: number // zoom, 1..MAX_SCALE
}

export const GLOBE_HOME: GlobeView = { cLon: -40, cLat: 30, s: 1 } // the Atlantic, gently tilted north
export const GLOBE_R = 160 // disc radius at s = 1, sized to the cropped viewport

export interface GlobePoint {
  X: number
  Y: number
  vis: boolean
}

export function globeProjectFull(
  g: GlobeView,
  lonDeg: number,
  latDeg: number,
): { X: number; Y: number; cosc: number } {
  const R = GLOBE_R * g.s
  const lam = ((lonDeg - g.cLon) * Math.PI) / 180
  const phi = (latDeg * Math.PI) / 180
  const phi0 = (g.cLat * Math.PI) / 180
  const cosc = Math.sin(phi0) * Math.sin(phi) + Math.cos(phi0) * Math.cos(phi) * Math.cos(lam)
  return {
    X: W / 2 + R * Math.cos(phi) * Math.sin(lam),
    Y: H / 2 - R * (Math.cos(phi0) * Math.sin(phi) - Math.sin(phi0) * Math.cos(phi) * Math.cos(lam)),
    cosc,
  }
}

export function globeProject(g: GlobeView, lonDeg: number, latDeg: number): GlobePoint {
  const p = globeProjectFull(g, lonDeg, latDeg)
  return { X: p.X, Y: p.Y, vis: p.cosc > 0.001 }
}

// Inverse orthographic: which lon/lat sits under a viewBox point — null when
// the point is off the disc. Lets wheel zoom anchor on the terrain under the
// cursor instead of the disc center.
export function globeUnproject(g: GlobeView, X: number, Y: number): { lon: number; lat: number } | null {
  const R = GLOBE_R * g.s
  const x = (X - W / 2) / R
  const y = -(Y - H / 2) / R
  const rho = Math.sqrt(x * x + y * y)
  if (rho > 1) return null
  const c = Math.asin(rho)
  const phi0 = (g.cLat * Math.PI) / 180
  const sinc = Math.sin(c)
  const cosc = Math.cos(c)
  const lat = rho === 0 ? g.cLat : (Math.asin(cosc * Math.sin(phi0) + (y * sinc * Math.cos(phi0)) / rho) * 180) / Math.PI
  const lon =
    rho === 0
      ? g.cLon
      : g.cLon + (Math.atan2(x * sinc, rho * Math.cos(phi0) * cosc - y * Math.sin(phi0) * sinc) * 180) / Math.PI
  return { lon, lat }
}

// Landmass on the sphere. Hidden points clamp to the limb along their
// azimuth so coastlines hug the horizon — with two guards that keep the
// silhouette honest: points near the ANTIPODE are dropped (their projected
// azimuth is numerically meaningless and used to fling chords across the
// disc), and consecutive limb points bridge along the limb ARC in short
// steps instead of a straight chord.
//
// Rotation re-runs this every frame over the whole coastline, so the per-vertex
// trigonometry is paid once: each ring's vertices are cached as
// (cos lat, sin lat, cos lon, sin lon), and a view only needs the four trig
// values of its own centre — every vertex is then a handful of multiplies
// (angle-difference identities) instead of five transcendental calls.
export type Rings = readonly (readonly (readonly [number, number])[])[]
const ringTrig = new WeakMap<Rings, Float64Array[]>()
export function ringTrigTables(rings: Rings): Float64Array[] {
  let tables = ringTrig.get(rings)
  if (tables === undefined) {
    tables = rings.map((ring) => {
      const t = new Float64Array(ring.length * 4)
      ring.forEach(([lon, lat], i) => {
        const lam = (lon * Math.PI) / 180
        const phi = (lat * Math.PI) / 180
        t[i * 4] = Math.cos(phi)
        t[i * 4 + 1] = Math.sin(phi)
        t[i * 4 + 2] = Math.cos(lam)
        t[i * 4 + 3] = Math.sin(lam)
      })
      return t
    })
    ringTrig.set(rings, tables)
  }
  return tables
}

// Per-call scratch for the projected ring, reused so a rotation frame does not
// allocate an object per coastline vertex.
let scratchX = new Float64Array(0)
let scratchY = new Float64Array(0)
let scratchC = new Float64Array(0)

export function globeLandPath(g: GlobeView, rings: Rings): string {
  const R = GLOBE_R * g.s
  const cx = W / 2
  const cy = H / 2
  const c0 = Math.cos((g.cLon * Math.PI) / 180)
  const s0 = Math.sin((g.cLon * Math.PI) / 180)
  const sinPhi0 = Math.sin((g.cLat * Math.PI) / 180)
  const cosPhi0 = Math.cos((g.cLat * Math.PI) / 180)
  const parts: string[] = []
  const tables = ringTrigTables(rings)
  for (const t of tables) {
    const n = t.length / 4
    if (scratchX.length < n) {
      scratchX = new Float64Array(n * 2)
      scratchY = new Float64Array(n * 2)
      scratchC = new Float64Array(n * 2)
    }
    const PX = scratchX
    const PY = scratchY
    const PC = scratchC
    let start = -1
    for (let i = 0; i < n; i++) {
      const cosLat = t[i * 4]!
      const sinLat = t[i * 4 + 1]!
      // lam = lon - cLon, by the angle-difference identities.
      const cosLam = t[i * 4 + 2]! * c0 + t[i * 4 + 3]! * s0
      const sinLam = t[i * 4 + 3]! * c0 - t[i * 4 + 2]! * s0
      const cosc = sinPhi0 * sinLat + cosPhi0 * cosLat * cosLam
      PX[i] = cx + R * cosLat * sinLam
      PY[i] = cy - R * (cosPhi0 * sinLat - sinPhi0 * cosLat * cosLam)
      PC[i] = cosc
      if (start < 0 && cosc > 0.001) start = i
    }
    if (start < 0) continue
    // A ring has no privileged first vertex. Start on the visible coastline
    // so every hidden run (including one spanning the stored ring's seam)
    // goes through the limb-arc bridge below. Otherwise SVG's closing Z
    // joins two limb points with a chord and fills a wedge of ocean.
    let d = ''
    let prevLimbAz: number | null = null
    // A tenth of a unit, as toFixed(1) printed it, at a fraction of the cost.
    const emit = (px: number, py: number): void => {
      d += `${d === '' ? 'M' : 'L'}${Math.round(px * 10) / 10} ${Math.round(py * 10) / 10}`
    }
    for (let k = 0; k < n; k++) {
      const i = (start + k) % n
      if (PC[i]! > 0.001) {
        emit(PX[i]!, PY[i]!)
        prevLimbAz = null
        continue
      }
      if (PC[i]! < -0.55) continue // antipode zone: azimuth is noise
      const az = Math.atan2(PY[i]! - cy, PX[i]! - cx)
      if (prevLimbAz !== null) {
        // Bridge along the limb, shorter way round, in ≤12° steps.
        let delta = az - prevLimbAz
        while (delta > Math.PI) delta -= 2 * Math.PI
        while (delta < -Math.PI) delta += 2 * Math.PI
        const steps = Math.floor(Math.abs(delta) / 0.2)
        for (let s = 1; s <= steps; s++) {
          const a = prevLimbAz + (delta * s) / (steps + 1)
          emit(cx + R * Math.cos(a), cy + R * Math.sin(a))
        }
      }
      emit(cx + R * Math.cos(az), cy + R * Math.sin(az))
      prevLimbAz = az
    }
    parts.push(d + 'Z')
  }
  return parts.join('')
}

// Subtle meridians and parallels every 30° — the globe reads as a globe even
// over open ocean. Same pen-down visibility walk the routes use.
// Open polylines (borders) on the sphere: project what faces us and lift the
// pen wherever the line rolls behind the limb — a stroke needs no bridge.
export function globeLinesPath(
  g: GlobeView,
  lines: readonly (readonly (readonly [number, number])[])[],
): string {
  let out = ''
  for (const line of lines) {
    let pen = false
    for (const [lon, lat] of line) {
      const p = globeProjectFull(g, lon!, lat!)
      if (p.cosc > 0.001) {
        out += `${pen ? 'L' : 'M'}${p.X.toFixed(1)} ${p.Y.toFixed(1)}`
        pen = true
      } else {
        pen = false
      }
    }
  }
  return out
}

export function globeGraticule(g: GlobeView): string {
  let d = ''
  const line = (points: [number, number][]): void => {
    let penDown = false
    for (const [lon, lat] of points) {
      const p = globeProject(g, lon, lat)
      if (!p.vis) {
        penDown = false
        continue
      }
      d += `${penDown ? 'L' : 'M'}${p.X.toFixed(1)} ${p.Y.toFixed(1)}`
      penDown = true
    }
  }
  for (let lon = -180; lon < 180; lon += 30) {
    line(Array.from({ length: 37 }, (_, i) => [lon, -90 + i * 5] as [number, number]))
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    line(Array.from({ length: 73 }, (_, i) => [-180 + i * 5, lat] as [number, number]))
  }
  return d
}

// Sample the great circle between two cities as lon/lat waypoints (slerp on
// the unit sphere).
function greatCircle(fromId: string, toId: string, n = 24): [number, number][] {
  const a = getCity(fromId)
  const b = getCity(toId)
  const toXYZ = (lonDeg: number, latDeg: number): [number, number, number] => {
    const lon = (lonDeg * Math.PI) / 180
    const lat = (latDeg * Math.PI) / 180
    return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)]
  }
  const va = toXYZ(a.lon, a.lat)
  const vb = toXYZ(b.lon, b.lat)
  const dot = Math.min(1, Math.max(-1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2]))
  const om = Math.acos(dot)
  const so = Math.sin(om) || 1e-9
  const out: [number, number][] = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const k1 = Math.sin((1 - t) * om) / so
    const k2 = Math.sin(t * om) / so
    const vx = k1 * va[0] + k2 * vb[0]
    const vy = k1 * va[1] + k2 * vb[1]
    const vz = k1 * va[2] + k2 * vb[2]
    out.push([
      (Math.atan2(vy, vx) * 180) / Math.PI,
      (Math.asin(Math.max(-1, Math.min(1, vz))) * 180) / Math.PI,
    ])
  }
  return out
}

// Visible runs of the great circle as subpaths ('' when fully hidden).
export function globeRoutePath(g: GlobeView, fromId: string, toId: string): string {
  let d = ''
  let penDown = false
  for (const [lon, lat] of greatCircle(fromId, toId)) {
    const p = globeProject(g, lon, lat)
    if (!p.vis) {
      penDown = false
      continue
    }
    d += `${penDown ? 'L' : 'M'}${p.X.toFixed(1)} ${p.Y.toFixed(1)}`
    penDown = true
  }
  return d
}

// The great circle for the traffic shuttle — only when the whole leg faces
// the viewer (a plane vanishing mid-flight reads as a glitch).
export function globeTripLeg(g: GlobeView, fromId: string, toId: string): TrafficLeg | null {
  const pts = greatCircle(fromId, toId).map(([lon, lat]) => globeProject(g, lon, lat))
  if (pts.some((p) => !p.vis)) return null
  const flat = new Float64Array(pts.length * 2)
  pts.forEach((p, i) => {
    flat[i * 2] = p.X
    flat[i * 2 + 1] = p.Y
  })
  return polylineLeg(flat)
}

// Keep a globe view legal: longitude wraps, latitude stops short of the
// poles, zoom stays in range.
export function clampGlobe(g: GlobeView): GlobeView {
  return {
    cLon: ((g.cLon + 540) % 360) - 180,
    cLat: Math.min(80, Math.max(-80, g.cLat)),
    s: Math.min(MAX_SCALE, Math.max(1, g.s)),
  }
}
