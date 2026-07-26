// SVG world map: real landmass under an equirectangular projection, cities as
// dots with zoom-dependent level of detail, routes as lifted arcs whose look
// tells you short-haul from long-haul at a glance. Presentation-only floats
// are fine here — the engine never sees screen coordinates.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { MouseEvent as ReactMouseEvent, PointerEvent } from 'react'
import { getAircraftType } from '../data/aircraft'
import { CITIES, distanceKm, getCity, pairKey, type City } from '../data/cities'
import { getEventDef } from '../data/events'
import { seasonalBp } from '../engine/market'
import { placeLabels } from './labels'
import {
  BORDERS_PATH,
  ISLETS_PATH,
  MAP_H,
  MAP_LAT_MAX,
  MAP_LAT_MIN,
  MAP_W,
  WORLD_PATH,
  WORLD_PATH_FINE,
  BORDER_LINES,
  ISLET_POINTS,
  WORLD_RINGS,
  WORLD_RINGS_FINE,
  projectLat,
  projectLon,
} from '../data/worldmap.gen'
import type { GameState, Route } from '../engine'
import {
  effectiveFrequency,
  networkCities,
  routeWeeklyCapacity,
  slotsAllocated,
  slotsHeld,
  yearOf,
} from '../engine/queries'
import { cityPool } from '../engine/slots'
import type { Airline } from '../engine'

// Arc weight tells capacity: seats/wk drive stroke width, so the map itself
// shows where an airline's hardware is concentrated. Fed to CSS as a custom
// property so hover/transition rules still win.
function capWidth(airline: Airline, route: Route, thin: boolean): number {
  const cap = routeWeeklyCapacity(airline, route)
  const w = (thin ? 0.4 : 0.7) + Math.sqrt(cap) / (thin ? 90 : 40)
  return Math.min(thin ? 1.4 : 4, Math.max(thin ? 0.4 : 0.9, w))
}

function slotsUsedAt(routes: readonly Route[], city: string): number {
  let used = 0
  for (const r of routes) if (r.from === city || r.to === city) used++
  return used
}

// The projection comes FROM the generated geometry (tools/gen-worldmap.mjs),
// not a copy of it: cities and coastlines are placed by the same functions, so
// an airport can never drift off its own continent.
const W = MAP_W
const H = MAP_H

// How many frames wide the moving layer is. The overhang past each edge is
// (SPAN - 1) / 2 of the frame, and that is the budget a gesture spends before
// the layer runs out of painted world and has to be re-centred — which rewrites
// the viewBox and throws away the cached texture, the one genuinely expensive
// thing a drag can do.
//
// So the layer is sized to hold the WHOLE WORLD whenever that is affordable.
// Zoomed out two steps the world is only 2.25 frames across, so the layer
// covers all of it and a drag of any length re-centres zero times: the
// compositor just slides a texture that already has everywhere on it. Past the
// cap the world no longer fits and re-centres come back, but by then the view
// holds few enough cities that the render behind one is cheap.
// The choice is deliberately all-or-nothing. Either the layer holds the whole
// world, and a drag of any length re-centres zero times, or it takes the
// smallest useful overhang and re-centres often but cheaply. A middle size
// gets the worst of both: re-centres still happen, and the wider cull that a
// wider layer forces drags more cities into every render — at max zoom that
// was 48 of them instead of 12, to remove only two thirds of the re-centres.
const SPAN_MIN = 1.5
const SPAN_WHOLE_WORLD_UP_TO = 2.5
const layerSpan = (viewW: number): number => {
  const whole = W / viewW
  return whole <= SPAN_WHOLE_WORLD_UP_TO ? Math.max(SPAN_MIN, whole) : SPAN_MIN
}

const x = projectLon
const y = projectLat

export function cityMass(c: City): number {
  return c.pop * 4 + c.biz * 3 + c.tour * 2
}

// Top-view airliner silhouette, nose on the +x axis — animateMotion's
// rotate="auto" aligns +x with the direction of travel, so this glyph always
// flies nose-first.
const PLANE_GLYPH =
  'M 7 0 C 6 -0.9 5 -1 4 -1 L 1.2 -1 L -1.8 -5 L -3.6 -5 L -1.9 -1 L -4.6 -1 ' +
  'L -6.2 -2.6 L -6.8 -2.6 L -5.8 0 L -6.8 2.6 L -6.2 2.6 L -4.6 1 L -1.9 1 ' +
  'L -3.6 5 L -1.8 5 L 1.2 1 L 4 1 C 5 1 6 0.9 7 0 Z'

// One color per rival, everywhere it appears (map arcs, panel chips).
export const RIVAL_COLORS = ['#d0636e', '#9d7bd8', '#d8a052'] as const

export function rivalColorClass(airlineId: number): string {
  return `rival-c${(airlineId - 1) % RIVAL_COLORS.length}`
}

// Level of detail: majors always visible, regionals from mid zoom, small
// fields only up close — plus anything the player has a stake in.
export function cityTier(c: City): 1 | 2 | 3 {
  const mass = cityMass(c)
  return mass >= 62 ? 1 : mass >= 45 ? 2 : 3
}

// LOD contract: majors and regionals (tier 1-2) are visible from the world
// view — Aerobiz-style busy map; small fields (tier 3) fade in at 1.8× zoom,
// labels for non-majors at 1.5×. Implemented via lodKey in the render memo.

// Quadratic arc between two cities, lifted perpendicular to the chord — reads
// as a flight path instead of a fence line.
function arcPath(fromId: string, toId: string): string {
  const a = getCity(fromId)
  const b = getCity(toId)
  const x1 = x(a.lon)
  const y1 = y(a.lat)
  const x2 = x(b.lon)
  const y2 = y(b.lat)
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.sqrt(dx * dx + dy * dy) || 1
  const lift = Math.min(40, len * 0.18)
  const mx = (x1 + x2) / 2 + (dy / len) * lift
  const my = (y1 + y2) / 2 - (dx / len) * lift
  return `M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`
}

// The same arc out AND back in one path. Traffic animation uses this so
// rotate="auto" always sees the true direction of travel. Reversing via
// keyPoints instead relies on each engine negating the tangent — WebKit
// (and others) get that wrong and planes flew tail-first on the return
// leg. With the return baked into the geometry, forward-only traversal is
// correct everywhere, even in engines that ignore keyPoints outright.
function roundTripPath(fromId: string, toId: string): string {
  const a = getCity(fromId)
  const b = getCity(toId)
  const x1 = x(a.lon)
  const y1 = y(a.lat)
  const x2 = x(b.lon)
  const y2 = y(b.lat)
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.sqrt(dx * dx + dy * dy) || 1
  const lift = Math.min(40, len * 0.18)
  const mx = (x1 + x2) / 2 + (dy / len) * lift
  const my = (y1 + y2) / 2 - (dx / len) * lift
  return `M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2} Q ${mx} ${my} ${x1} ${y1}`
}

// Meridians and parallels on the flat map. Baked once — the flat projection
// never moves — and drawn faintly: enough to say "this is a globe unrolled",
// not enough to compete with the network drawn on top.
const GRATICULE_PATH = (() => {
  const parts: string[] = []
  for (let lon = -180; lon <= 180; lon += 30) {
    parts.push(`M${x(lon).toFixed(1)},0L${x(lon).toFixed(1)},${H}`)
  }
  for (let lat = -40; lat <= 70; lat += 20) {
    parts.push(`M0,${y(lat).toFixed(1)}L${W},${y(lat).toFixed(1)}`)
  }
  return parts.join('')
})()

function graticulePath(): string {
  return GRATICULE_PATH
}

// The SVG covers its box (preserveAspectRatio="slice"), so viewBox units map
// to CSS pixels by the LARGER of the two ratios with the surplus split either
// side. Every pointer conversion — tap, drag, pinch, zoom-to-cursor — must use
// this, or input lands in the wrong place the moment the element's box stops
// carrying the viewBox's aspect (which is what a phone-height map does).
function viewToCss(rect: { width: number; height: number }, w: number, h: number) {
  const k = Math.max(rect.width / w, rect.height / h)
  return { k, offX: (rect.width - w * k) / 2, offY: (rect.height - h * k) / 2 }
}

// Short hops, medium stages, and long-haul trunks each get their own line
// language (width/dash), on top of the arc lift that grows with distance.
function haulClass(km: number): string {
  return km >= 4500 ? 'route-long' : km >= 1500 ? 'route-medium' : 'route-short'
}

// Module-level path caches. Route/trip paths are pure in (projection,
// endpoints), and the flat projection never moves — so during a zoom ease
// (many renders per second) every path string is a Map hit instead of fresh
// Bézier math. A globe move changes the projection key and flushes the
// globe entries. Presentation-only mutable state; the engine sees none of it.
const routePathCache = new Map<string, string>()
const tripPathCache = new Map<string, string | null>()
let cachedProjKey = 'flat'

function flushOnProjChange(projKey: string): void {
  if (projKey === cachedProjKey) return
  cachedProjKey = projKey
  routePathCache.clear()
  tripPathCache.clear()
}

function cachedRoutePath(projKey: string, globe: GlobeView | null, fromId: string, toId: string): string {
  flushOnProjChange(projKey)
  const k = `${fromId}|${toId}`
  let d = routePathCache.get(k)
  if (d === undefined) {
    d = globe !== null ? globeRoutePath(globe, fromId, toId) : arcPath(fromId, toId)
    routePathCache.set(k, d)
  }
  return d
}

function cachedTripPath(projKey: string, globe: GlobeView | null, fromId: string, toId: string): string | null {
  flushOnProjChange(projKey)
  const k = `${fromId}|${toId}`
  let d = tripPathCache.get(k)
  if (d === undefined) {
    d = globe !== null ? globeTripPath(globe, fromId, toId) : roundTripPath(fromId, toId)
    tripPathCache.set(k, d)
  }
  return d
}

// ---- Globe (orthographic) projection ----------------------------------
// The map can render as a rotatable globe: drag spins it, wheel zooms it,
// routes follow real great circles, and the back hemisphere is culled.

interface GlobeView {
  cLon: number // longitude at the center of the disc
  cLat: number // latitude at the center of the disc
  s: number // zoom, 1..MAX_SCALE
}

const GLOBE_HOME: GlobeView = { cLon: -40, cLat: 30, s: 1 } // the Atlantic, gently tilted north
const GLOBE_R = 160 // disc radius at s = 1, sized to the cropped viewport

interface GlobePoint {
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

function globeProject(g: GlobeView, lonDeg: number, latDeg: number): GlobePoint {
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
function globeLandPath(
  g: GlobeView,
  rings: readonly (readonly (readonly [number, number])[])[],
): string {
  const R = GLOBE_R * g.s
  const cx = W / 2
  const cy = H / 2
  const parts: string[] = []
  for (const ring of rings) {
    let d = ''
    let anyVisible = false
    let prevLimbAz: number | null = null
    const emit = (px: number, py: number): void => {
      d += `${d === '' ? 'M' : 'L'}${px.toFixed(1)} ${py.toFixed(1)}`
    }
    for (const [lon, lat] of ring) {
      const p = globeProjectFull(g, lon, lat)
      if (p.cosc > 0.001) {
        anyVisible = true
        emit(p.X, p.Y)
        prevLimbAz = null
        continue
      }
      if (p.cosc < -0.55) continue // antipode zone: azimuth is noise
      const az = Math.atan2(p.Y - cy, p.X - cx)
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
    if (anyVisible && d !== '') parts.push(d + 'Z')
  }
  return parts.join('')
}

// Subtle meridians and parallels every 30° — the globe reads as a globe even
// over open ocean. Same pen-down visibility walk the routes use.
// Open polylines (borders) on the sphere: project what faces us and lift the
// pen wherever the line rolls behind the limb — a stroke needs no bridge.
function globeLinesPath(
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

function globeGraticule(g: GlobeView): string {
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
function globeRoutePath(g: GlobeView, fromId: string, toId: string): string {
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

// Out-and-back great circle for the traffic shuttle — only when the whole
// leg faces the viewer (a plane vanishing mid-flight reads as a glitch).
function globeTripPath(g: GlobeView, fromId: string, toId: string): string | null {
  const pts = greatCircle(fromId, toId).map(([lon, lat]) => globeProject(g, lon, lat))
  if (pts.some((p) => !p.vis)) return null
  const fwd = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.X.toFixed(1)} ${p.Y.toFixed(1)}`).join('')
  const back = pts
    .slice(0, -1)
    .reverse()
    .map((p) => `L${p.X.toFixed(1)} ${p.Y.toFixed(1)}`)
    .join('')
  return fwd + back
}

interface ViewBox {
  x: number
  y: number
  w: number
  h: number
}

const FULL_VIEW: ViewBox = { x: 0, y: 0, w: W, h: H }
const MAX_SCALE = 6

function clampView(v: ViewBox): ViewBox {
  const w = Math.min(W, Math.max(W / MAX_SCALE, v.w))
  const h = (w / W) * H
  return {
    x: Math.min(W - w, Math.max(0, v.x)),
    y: Math.min(H - h, Math.max(0, v.y)),
    w,
    h,
  }
}

interface MapViewProps {
  state: GameState
  selected: string | null // city shown in the dossier panel
  routeFrom: string | null // armed origin: next city click opens a route
  onCityClick: (city: string) => void
  onRouteClick?: (routeId: number) => void
  newRouteIds: ReadonlySet<number>
  newSlotCities: ReadonlySet<string>
  // Routes that just arrived via a takeover — they flash from rival gold
  // into the player's color so the map narrates the acquisition.
  acquiredRouteIds?: ReadonlySet<number>
}

export function MapView({
  state,
  selected,
  routeFrom,
  onCityClick,
  onRouteClick,
  newRouteIds,
  newSlotCities,
  acquiredRouteIds,
}: MapViewProps) {
  // A phone's map box is nearly square; the world is 2.7:1. Covering that box
  // with the WHOLE world would crop 60% of its width — measured, Chicago
  // rendered at x = -45. So on a narrow screen "home" is the player's own
  // region, not the whole planet: the crop then shows the network you fly.
  // Desktop keeps the full world, where the box already carries the viewBox's
  // aspect and nothing is cropped at all.
  const homeView = (): ViewBox => {
    if (typeof window === 'undefined' || window.innerWidth > 640) return FULL_VIEW
    const hq = getCity(state.airlines[0]!.hq)
    const w = W / 2.2
    const h = (w * H) / W
    return {
      x: Math.max(0, Math.min(W - w, x(hq.lon) - w / 2)),
      y: Math.max(0, Math.min(H - h, y(hq.lat) - h / 2)),
      w,
      h,
    }
  }
  const [view, setView] = useState<ViewBox>(homeView)
  // What the SVG rasters, as opposed to what React knows. `view` is the
  // logical view — taps, cull-adjacent reads, the minimap, data-view — and
  // `anchor` is the viewBox actually written to the DOM. They part ways after
  // a pan: the world at a shifted offset is the same pixels, already painted,
  // so a pan commits into `view` and leaves the layer's transform parked —
  // no viewBox rewrite, no re-raster, nothing. Only a zoom (new resolution)
  // or a re-centre (new world content) moves the anchor, and each is a single
  // raster taken at rest.
  const [anchor, setAnchor] = useState<ViewBox>(homeView)
  const svgRef = useRef<SVGSVGElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ px: number; py: number; moved: boolean } | null>(null)
  // Zoom eases toward targetRef via exponential smoothing in a rAF loop;
  // panning writes through immediately. Wheel/button handlers mutate the
  // TARGET, so rapid inputs compound smoothly instead of stacking jumps.
  const targetRef = useRef<ViewBox>(homeView())
  const rafRef = useRef(0)

  // Projection: the flat overview or a rotatable orthographic globe. The
  // choice persists — planning favors the whole-world view, the globe is the
  // honest picture of what long-haul really flies.
  const [projection, setProjection] = useState<'flat' | 'globe'>(() =>
    localStorage.getItem('loadfactor:projection') === 'globe' ? 'globe' : 'flat',
  )
  const isGlobe = projection === 'globe'

  // A finger drag must track the finger, and moving the map by rewriting the
  // SVG's viewBox does not — not on WebKit. A viewBox change re-resolves the
  // root's coordinate system, so the entire SVG subtree (a couple of thousand
  // nodes here) re-lays-out; do that on every touchmove and the main thread
  // never reaches a paint. It renders when you pause, which is exactly what
  // "it only moves when I stop or let go" is. Chromium optimises the case
  // away, which is why it measures clean on a desktop at 8x CPU throttle.
  //
  // So while a gesture is in flight the viewBox is FROZEN and the world is
  // moved by a transform on one group instead — a paint-time property that
  // does not invalidate layout on any engine. React state is synced once,
  // when the finger lifts, and the transform folds back into the viewBox.
  const gesturing = useRef(false)
  // "Something other than React owns the transform right now" — a gesture or
  // an eased zoom. A ref and not state, deliberately: as state, merely
  // STARTING a drag re-rendered the map, and at zoom 2 that is 164 cities and
  // 164 labels reconciled in the first frame of the gesture — measured at
  // 124ms under a 6x CPU throttle, the single worst frame in a drag. Nothing
  // it does needs a render: the class goes on the wrapper (whose className
  // React never rewrites, so an imperative toggle is safe) and the SMIL pause
  // is a method call.
  // The globe alone re-renders per frame while it turns — rotation changes
  // which hemisphere faces us, so there is no texture to slide. Re-projecting
  // the fine coastline's ~19k points every one of those frames is real money,
  // so the globe drops to the coarse rings while a gesture is turning it and
  // takes the full detail back the moment it rests. State rather than a ref
  // because the render picks rings by it; gated to the globe so starting a
  // FLAT drag still renders nothing (the 124ms lesson).
  const [rotating, setRotating] = useState(false)
  const movingRef = useRef(false)
  const paused = useRef<Animation[]>([])
  const setMoving = (on: boolean): void => {
    if (movingRef.current === on) return
    movingRef.current = on
    const svg = svgRef.current
    if (svg === null) return
    if (on) {
      // Two animation systems, two APIs, and neither is a CSS class. Toggling
      // a class meant a descendant-selector restyle over the whole map to
      // reach two elements that usually are not even there, and it measured
      // ~12ms of the first frame of a drag. These reach exactly what is
      // actually animating and cost no style recalc at all.
      svg.pauseAnimations() // SMIL: the planes, which ignore CSS entirely
      paused.current = svg.getAnimations({ subtree: true }).filter((a) => a.playState === 'running')
      for (const a of paused.current) a.pause() // CSS: selection ring, target blink
    } else {
      svg.unpauseAnimations()
      for (const a of paused.current) a.play()
      paused.current = []
    }
  }
  const layerRef = useRef<HTMLDivElement>(null)
  const minimapRef = useRef<HTMLDivElement>(null)
  // The viewBox actually in the DOM. The transform maps it to the live view.
  const baseRef = useRef<ViewBox>(homeView())
  // The globe equivalents: what is committed to state, and where a zoom-only
  // ease has got to on top of it.
  const [globe, setGlobe] = useState<GlobeView>(GLOBE_HOME)
  const globeBaseRef = useRef<GlobeView>(GLOBE_HOME)
  const globeEase = useRef<GlobeView>(GLOBE_HOME)
  const globeEasing = useRef(false)

  // Move the layer to show view `v` while the SVG underneath still holds the
  // committed one. Everything is in CSS pixels, because a CSS transform on a
  // promoted layer is the whole point: the compositor moves an already-drawn
  // texture and nothing re-rasterises.
  //
  // The layer paints the base viewBox B at k px per unit (`slice`, so k is the
  // larger ratio and the surplus splits either side). Showing v instead means
  // scaling by s = B.w/v.w and sliding by the difference between where a world
  // point sits under B and where it should sit under v. Working that through,
  // with the transform taken about the layer's centre:
  //
  //   T = s*k*(B.x - v.x) - (1 - s)*B.w*k/2
  //
  // which for a pure pan (s = 1) is just k*(B.x - v.x).
  const paintLayer = (tx: number, ty: number, s: number): void => {
    const el = layerRef.current
    if (el === null) return
    if (Math.abs(s - 1) < 1e-9 && Math.abs(tx) < 0.01 && Math.abs(ty) < 0.01) {
      // At rest, hand the pixels back: an identity transform still pins a
      // composited texture in memory for a map nobody is touching.
      el.style.transform = ''
      return
    }
    el.style.transform = `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0) scale(${s.toFixed(6)})`
  }

  // The frame the map is seen through. Measured on the WRAPPER, not the SVG:
  // the SVG rides the layer now, so mid-gesture its bounding box carries the
  // gesture's own transform and every reading would feed back on itself. The
  // wrapper never moves. Cached for the duration of a gesture, because
  // getBoundingClientRect() forces a layout flush and paying for one on every
  // pointermove taxes the frame that has to track the finger.
  const spanRef = useRef<number>(SPAN_MIN)
  const gestureRect = useRef<DOMRect | null>(null)
  const frameRect = (): DOMRect | null => {
    const measure = (): DOMRect | null => wrapRef.current?.getBoundingClientRect() ?? null
    if (!gesturing.current) return measure()
    if (gestureRect.current === null) gestureRect.current = measure()
    return gestureRect.current
  }

  // Where the layer has to sit to show `v`, and whether it still covers the
  // frame when it gets there. Scale eats the overhang: at s = 1 there is a
  // quarter-frame of slack each way, and a zoom-out shrinks the layer toward
  // the frame's own size until there is none.
  const layerFor = (v: ViewBox, rect: DOMRect): { tx: number; ty: number; s: number; covers: boolean } => {
    const b = baseRef.current
    const s = b.w / v.w
    const k = viewToCss(rect, b.w, b.h).k
    const tx = s * k * (b.x - v.x) - ((1 - s) * b.w * k) / 2
    const ty = s * k * (b.y - v.y) - ((1 - s) * b.h * k) / 2
    // The layer's edges have to stay outside the frame. Scale eats into the
    // margin: a zoom-out shrinks the layer toward the frame's own size.
    const slack = (s * spanRef.current - 1) / 2
    return {
      tx,
      ty,
      s,
      covers: Math.abs(tx) <= rect.width * slack && Math.abs(ty) <= rect.height * slack,
    }
  }

  // Fold a finished gesture or ease into state. The raster-free path is the
  // point: a pure pan whose target the layer still covers changes nothing the
  // SVG renders — same viewBox, same cull — so the only DOM the commit touches
  // is outside the layer, and the compositor keeps carrying the texture it
  // already has. Everything else re-anchors: one raster, taken at rest.
  const commitView = (t: ViewBox): void => {
    setView(t)
    const rect = frameRect()
    const panOnly = Math.abs(t.w - baseRef.current.w) < 1e-6
    if (!panOnly || rect === null || !layerFor(t, rect).covers) setAnchor(t)
  }

  // The layer has run out of world. Re-render at the new view so it is centred
  // again and the transform can start over from identity. Synchronously,
  // because the transform we paint next assumes the viewBox already moved.
  // A long drag pays this once per quarter-frame of travel instead of a
  // re-raster per frame, which is the whole trade.
  const recentre = (v: ViewBox): void => {
    flushSync(() => {
      setView(v)
      setAnchor(v)
    })
    const rect = frameRect()
    if (rect === null) return
    const t = layerFor(v, rect)
    paintLayer(t.tx, t.ty, t.s)
  }

  // The flat view most recently painted to the DOM — where a new ease starts
  // from, now that the committed view and the rastered anchor can differ.
  const paintedRef = useRef<ViewBox>(homeView())

  const paintView = (v: ViewBox): void => {
    const rect = frameRect()
    if (rect === null) return
    if (!isGlobe) paintedRef.current = v
    if (isGlobe) {
      // The flat map's view means nothing here — the globe has a fixed viewBox
      // and re-projects its own geometry. But a globe ZOOM is a pure scale
      // about the centre: every projected point is centre + R*f(lon,lat) with
      // R = GLOBE_R*s, and which hemisphere is visible does not depend on R at
      // all. So a zoom-only ease rides the same layer transform as a flat pan,
      // instead of re-projecting the whole world once per frame.
      const s = !globeEasing.current ? 1 : globeEase.current.s / globeBaseRef.current.s
      // A pure scale about the frame's centre, and the layer's centre IS the
      // frame's centre — so there is nothing to translate. (The flat map's
      // shift term exists because zooming there also moves the view's corner;
      // applying it here pushed the globe off to one side.)
      if ((s * spanRef.current - 1) / 2 < 0) {
        // Shrunk past its own overhang: the layer no longer covers the frame,
        // so commit the zoom and let the globe re-project at the new size.
        const g = globeEase.current
        globeEasing.current = false
        flushSync(() => setGlobe(g))
        paintLayer(0, 0, 1)
        return
      }
      paintLayer(0, 0, s)
      return
    }
    const t = layerFor(v, rect)
    // Called from the layout effect too, where the base has just been set to
    // `v` — so the transform is identity, it always covers, and this never
    // re-enters React from inside an effect.
    if (!t.covers) recentre(v)
    else paintLayer(t.tx, t.ty, t.s)
    // The minimap marker tracks a pan and sits out a zoom. A CSS transform,
    // not the SVG `transform` attribute — the attribute is part of SVG layout,
    // so writing it relaid out the minimap every frame. Even as a CSS
    // transform, though, changing the SCALE makes the engine recompute the
    // marker's non-scaling stroke: measured over one zoom step at max zoom,
    // keeping it live cost 57 repaints against 9, and two thirds of the
    // zoom's entire raster bill. Panning only moves it, which is free, and
    // the committed render puts the new size on when the zoom lands.
    const mm = minimapRef.current
    if (mm !== null && Math.abs(v.w - baseRef.current.w) < 0.5) {
      mm.style.transform = `translate3d(${(v.x / v.w) * 100}%, ${(v.y / v.h) * 100}%, 0)`
    }
  }

  // React has just written `anchor` as the viewBox, so that is the base the
  // transform is derived against. After a pan commit the two differ and the
  // transform stays parked; after a zoom or re-centre they coincide and it
  // resolves to identity — before paint, so the handoff never shows a frame
  // of either alone.
  useLayoutEffect(() => {
    baseRef.current = anchor
    globeBaseRef.current = globe
    spanRef.current = isGlobe ? SPAN_MIN : layerSpan(anchor.w)
    // A render can land mid-ease — starting one drops detail, and a quarter
    // can resolve underneath it. The ease repaints the transform from its own
    // rAF every frame, so this effect must not paint the committed view over
    // it. Nothing is lost by skipping: `view` cannot change while an ease
    // runs, since only the ease's final commit moves it.
    // On the flat map the gesture or ease paints the transform itself, so
    // this must not paint over it. The globe re-projects from state instead,
    // and paintView is what takes the ease's leftover transform back off —
    // skip it there and a grab mid-ease leaves the zoom applied twice.
    if (!isGlobe && (gesturing.current || rafRef.current !== 0)) return
    paintView(view)
  })

  // Where an eased view has got to, and whether one is in flight. When it is
  // not, the committed `view` is the truth.
  const easeRef = useRef<ViewBox>(homeView())
  const easing = useRef(false)
  const stopEase = (): void => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
    }
    easing.current = false
  }

  // A zoom step eases exactly the way a drag tracks a finger: transform to the
  // DOM per frame, one React render at the end. It used to call setView on
  // every frame of the ease, so a 130ms animation asked React to reconcile the
  // whole map thirty times over. On a fast engine that is invisible; on a slow
  // one each render outlasts its frame, the next frame is already behind, and
  // one zoom step takes seconds to land.
  const settleView = (): void => {
    const t = targetRef.current
    const v = easing.current ? easeRef.current : baseRef.current
    const k = 0.25 // smoothing per frame ≈ 130ms to settle at 60fps
    const next = {
      x: v.x + (t.x - v.x) * k,
      y: v.y + (t.y - v.y) * k,
      w: v.w + (t.w - v.w) * k,
      h: v.h + (t.h - v.h) * k,
    }
    const done = Math.abs(next.w - t.w) < 0.5 && Math.abs(next.x - t.x) < 0.5 && Math.abs(next.y - t.y) < 0.5
    if (done) {
      // The one render: it commits the target and brings the detail back.
      rafRef.current = 0
      easing.current = false
      setMoving(false)
      commitView(t)
      return
    }
    easeRef.current = next
    paintView(next)
    rafRef.current = requestAnimationFrame(settleView)
  }

  const applyView = (target: ViewBox, immediate: boolean): void => {
    targetRef.current = clampView(target)
    if (gesturing.current) {
      // Mid-gesture: straight to the DOM, no render, no media query. A pinch
      // changes the width and pays the same scaling bill as an eased zoom.
      stopEase()
      paintView(targetRef.current)
      return
    }
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (immediate || reduced) {
      stopEase()
      setMoving(false)
      commitView(targetRef.current)
      return
    }
    if (!rafRef.current) {
      easeRef.current = paintedRef.current
      easing.current = true
      setMoving(true)
      rafRef.current = requestAnimationFrame(settleView)
    }
  }

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      // Unmounting mid-gesture must not leave the page permanently
      // unselectable.
      document.documentElement.classList.remove('map-gesture')
    }
  }, [])

  // The globe used to write every zoom straight to state. Continuous inputs
  // (wheel, pinch) hide that — they arrive as many small deltas — but a
  // discrete 1.5x step from a button or a double click landed in one frame
  // while the flat map eased. Same treatment for both now: discrete steps
  // ease toward a target, continuous gestures still write through so they
  // cannot lag a finger.
  const globeTarget = useRef<GlobeView>(GLOBE_HOME)
  const globeRaf = useRef(0)

  const stopGlobeEase = (): void => {
    if (globeRaf.current) {
      cancelAnimationFrame(globeRaf.current)
      globeRaf.current = 0
    }
    globeEasing.current = false
  }

  const settleGlobe = (): void => {
    const t = globeTarget.current
    const b = globeBaseRef.current
    const g = globeEasing.current ? globeEase.current : b
    const k = 0.25
    // Longitude wraps: ease the SHORT way round, or spinning past the
    // antimeridian takes the scenic route.
    let dLon = t.cLon - g.cLon
    while (dLon > 180) dLon -= 360
    while (dLon < -180) dLon += 360
    const next = {
      cLon: g.cLon + dLon * k,
      cLat: g.cLat + (t.cLat - g.cLat) * k,
      s: g.s + (t.s - g.s) * k,
    }
    const done =
      Math.abs(next.s - t.s) < 0.002 && Math.abs(dLon) < 0.15 && Math.abs(t.cLat - next.cLat) < 0.15
    if (done) {
      globeRaf.current = 0
      globeEasing.current = false
      setMoving(false)
      setGlobe(t)
      return
    }
    // Turning the globe changes which hemisphere faces us, so it has to be
    // re-projected and cannot be a transform. Zooming can — and zooming is
    // what every zoom control produces.
    const turns = Math.abs(t.cLon - b.cLon) > 1e-6 || Math.abs(t.cLat - b.cLat) > 1e-6
    if (turns) {
      globeEasing.current = false
      setGlobe(next)
    } else {
      globeEase.current = next
      paintView(baseRef.current)
    }
    globeRaf.current = requestAnimationFrame(settleGlobe)
  }

  const applyGlobe = (next: GlobeView, immediate: boolean): void => {
    globeTarget.current = clampGlobe(next)
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (immediate || reduced) {
      stopGlobeEase()
      if (!gesturing.current) setMoving(false)
      setGlobe(globeTarget.current)
      return
    }
    if (!globeRaf.current) {
      globeEase.current = globeBaseRef.current
      globeEasing.current = true
      setMoving(true)
      globeRaf.current = requestAnimationFrame(settleGlobe)
    }
  }
  // 'g' flips the projection from anywhere (except form fields).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'g' && e.key !== 'G') return
      const target = e.target as HTMLElement | null
      if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return
      setProjection((p) => {
        const next = p === 'globe' ? 'flat' : 'globe'
        localStorage.setItem('loadfactor:projection', next)
        return next
      })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const clampGlobe = (g: GlobeView): GlobeView => ({
    cLon: ((g.cLon + 540) % 360) - 180,
    cLat: Math.min(80, Math.max(-80, g.cLat)),
    s: Math.min(MAX_SCALE, Math.max(1, g.s)),
  })

  const player = state.airlines[0]!
  const scale = isGlobe ? globe.s : W / view.w
  // Screen-size compensation. On the flat map the viewBox shrinks as you
  // zoom, so sizes divide by scale to stay constant on screen. The globe
  // keeps a FIXED viewBox and grows R instead — dividing there would shrink
  // labels and dots as you zoom in.
  const uiScale = isGlobe ? 1 : scale
  // One projection call for every feature on the map.
  const pt = (lon: number, lat: number): GlobePoint =>
    isGlobe ? globeProject(globe, lon, lat) : { X: x(lon), Y: y(lat), vis: true }
  const cityPt = (cityId: string): GlobePoint => {
    const c = getCity(cityId)
    return pt(c.lon, c.lat)
  }
  // Route path strings are pure in (projection, endpoints) — served from the
  // module-level caches keyed by projKey, so the 60fps zoom ease stops
  // rebuilding hundreds of Bézier strings per frame. projKey also names the
  // projection for the layer memos below.
  const projKey = isGlobe ? `g:${globe.cLon}:${globe.cLat}:${globe.s}` : 'flat'
  const routePathFor = (fromId: string, toId: string): string =>
    cachedRoutePath(projKey, isGlobe ? globe : null, fromId, toId)
  const tripPathFor = (fromId: string, toId: string): string | null =>
    cachedTripPath(projKey, isGlobe ? globe : null, fromId, toId)
  const flownRoutes = player.routes.filter((r) => player.fleet.some((a) => a.routeId === r.id))
  const network = networkCities(player)
  // How full each airport is, 0..1 — the slot model's scarcity, made visible
  // on the board where expansion decisions are actually taken.
  const pressure = (cityId: string): number => {
    const pool = cityPool(state, cityId)
    return pool <= 0 ? 1 : slotsAllocated(state, cityId) / pool
  }
  // Launching needs an idle airframe with the legs — targets beyond every
  // idle aircraft's range shouldn't light up at all.
  let idleReachKm = 0
  for (const a of player.fleet) {
    if (a.routeId === null) idleReachKm = Math.max(idleReachKm, getAircraftType(a.type).rangeKm)
  }
  const [showRivals, setShowRivals] = useState(true)
  // Hub glow: each route's connecting pax land on both endpoints, so the
  // transfer hub — riding two legs — naturally counts double and glows
  // brightest. Makes the network's actual hub structure visible.
  const hubVolume = new Map<string, number>()
  for (const r of player.routes) {
    for (const c of [r.from, r.to]) hubVolume.set(c, (hubVolume.get(c) ?? 0) + r.lastTransferPax)
  }
  // Data lens: recolor your arcs by an operational metric so the network's
  // health reads at a glance.
  const [lens, setLens] = useState<'none' | 'load' | 'profit' | 'season'>('none')
  const lensClass = (r: Route): string => {
    if (lens === 'season') {
      // The calendar's lean on this pair right now (tourism seasonality).
      const bp = Math.floor((seasonalBp(r.from, state.turn) * seasonalBp(r.to, state.turn)) / 10000)
      return bp > 10100 ? ' lens-good' : bp < 9900 ? ' lens-bad' : ''
    }
    if (lens === 'none' || r.lastCapacity === 0) return ''
    if (lens === 'load') {
      return r.lastLoadFactorBp >= 8000 ? ' lens-good' : r.lastLoadFactorBp >= 5500 ? ' lens-mid' : ' lens-bad'
    }
    const marginBp = r.lastRevenue > 0 ? Math.floor(((r.lastRevenue - r.lastCost) * 10000) / r.lastRevenue) : -1
    return marginBp >= 1500 ? ' lens-good' : marginBp >= 0 ? ' lens-mid' : ' lens-bad'
  }
  // Every pair any rival serves — player arcs on these run contested-hot.
  const rivalPairs = new Set(
    state.airlines.slice(1).flatMap((a) => a.routes.map((r) => pairKey(r.from, r.to))),
  )

  // Set when a drag/pinch gesture ends so the click that follows it is
  // swallowed instead of selecting whatever the pointer happened to be over.
  const suppressClick = useRef(false)

  // Layer memoization: the arc and traffic layers are the map's node-count
  // heavyweights, and none of them depend on the flat viewBox — so they
  // rebuild only when the data or the projection moves, not on every frame
  // of a zoom ease or an unrelated interaction (selection, planning mode).
  // Decorative glyph sizes quantize to quarter steps for the same reason.
  const glyphUi = Math.max(0.25, Math.round(uiScale * 4) / 4)
  const pulseUi = newRouteIds.size > 0 ? uiScale : 1
  const rivalArcsLayer = useMemo(() => {
    if (!showRivals) return null
    return state.airlines.slice(1).map((airline) =>
      airline.routes.map((r) => {
        const d = routePathFor(r.from, r.to)
        if (d === '') return null
        return (
          <path
            key={`${airline.id}-${r.id}`}
            d={d}
            className={`route-rival ${rivalColorClass(airline.id)}`}
            style={{ '--cap-w': capWidth(airline, r, true) } as React.CSSProperties}
          />
        )
      }),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, showRivals, isGlobe, globe, projKey])

  const playerArcsLayer = useMemo(() => {
    return player.routes.map((r) => {
      const km = distanceKm(r.from, r.to)
      const isNew = newRouteIds.has(r.id)
      const isAcquired = acquiredRouteIds?.has(r.id) ?? false
      const contested = rivalPairs.has(pairKey(r.from, r.to))
      const d = routePathFor(r.from, r.to)
      if (d === '') return null
      return (
        <g key={r.id}>
          <path
            d={d}
            pathLength={1}
            data-acquired={isAcquired || undefined}
            className={`route-player ${haulClass(km)}${isNew ? ' route-new' : ''}${isAcquired ? ' route-acquired' : ''}${contested ? ' route-contested' : ''}${lensClass(r)}`}
            style={
              {
                '--cap-w': capWidth(player, r, false),
                // Two more facts ride the same line: how full it flies (opacity
                // — a limp route is literally faint) and whether it earns (a
                // losing arc goes red). Width was already seats/wk, so an arc
                // now says size, fullness and health at once.
                '--load-o': (0.34 + (0.62 * r.lastLoadFactorBp) / 10000).toFixed(3),
              } as React.CSSProperties
            }
            data-losing={r.lastCapacity > 0 && r.lastRevenue < r.lastCost ? '' : undefined}
            data-testid={isNew ? 'route-line-new' : undefined}
            onClick={(e) => {
              e.stopPropagation() // an arc click must not select a nearby city
              if (suppressClick.current) {
                suppressClick.current = false
                return
              }
              onRouteClick?.(r.id)
            }}
          />
          {isNew &&
            [r.from, r.to].map((cityId) => {
              const p = cityPt(cityId)
              if (!p.vis) return null
              return <circle key={cityId} cx={p.X} cy={p.Y} r={10 / pulseUi} className="endpoint-pulse" />
            })}
        </g>
      )
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, isGlobe, globe, projKey, newRouteIds, acquiredRouteIds, lens, pulseUi, onRouteClick])

  const playerPlanesLayer = useMemo(() => {
    return flownRoutes.flatMap((r) => {
      const km = distanceKm(r.from, r.to)
      const freq = effectiveFrequency(player, r)
      const planes = Math.max(1, Math.min(4, Math.round(freq / 8)))
      const path = tripPathFor(r.from, r.to)
      if (path === null) return [] // route crosses the horizon — no shuttle
      // The glyph wears the metal: widebodies render visibly larger than
      // regional jets, and fast airframes visibly outrun the fleet
      // (Concorde zips). Biggest/fastest airframe assigned to the route.
      let biggestSeats = 100
      let fastestKmh = 850
      for (const ac of player.fleet) {
        if (ac.routeId !== r.id) continue
        const t = getAircraftType(ac.type)
        biggestSeats = Math.max(biggestSeats, t.seats)
        fastestKmh = Math.max(fastestKmh, t.speedKmh)
      }
      const glyphScale = (0.62 + Math.min(0.5, biggestSeats / 800)) / glyphUi
      const dur = (4 + Math.min(14, km / 900)) * (850 / fastestKmh)
      return Array.from({ length: planes }, (_, i) => (
        <g key={`plane-${r.id}-${i}`} className="plane" data-testid={i === 0 ? `plane-${r.id}` : undefined}>
          {/* A silhouette whose nose points along +x: rotate="auto" then
              keeps it flying nose-first on BOTH legs of the shuttle — the
              ✈ text glyph points 45° off-axis and read as flying
              backwards on the return leg. */}
          <path d={PLANE_GLYPH} transform={`scale(${glyphScale.toFixed(3)})`} />
          {/* The path itself runs out AND back, traversed forward only —
              brief dwells at each end, correct nose-first orientation on
              both legs in every engine (keyPoints reversal breaks
              rotate="auto" in WebKit; if an engine ignores keyPoints the
              shuttle still reads correctly, just without the dwells). */}
          <animateMotion
            dur={`${dur.toFixed(1)}s`}
            begin={`${(-((r.id * 13) % 60) / 10 - (i * dur) / planes).toFixed(1)}s`}
            repeatCount="indefinite"
            keyPoints="0;0.5;0.5;1;1"
            keyTimes="0;0.45;0.5;0.95;1"
            calcMode="linear"
            rotate="auto"
            path={path}
          />
        </g>
      ))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, isGlobe, globe, projKey, glyphUi])

  const rivalPlanesLayer = useMemo(() => {
    if (!showRivals) return null
    return state.airlines
      .slice(1)
      .flatMap((airline) => airline.routes.map((r) => ({ airline, r })))
      .slice(0, 12)
      .map(({ airline, r }) => {
        const path = tripPathFor(r.from, r.to)
        if (path === null) return null
        const km = distanceKm(r.from, r.to)
        const dur = 5 + Math.min(15, km / 900)
        return (
          <g key={`rplane-${airline.id}-${r.id}`} className={`plane plane-rival ${rivalColorClass(airline.id)}`}>
            <path d={PLANE_GLYPH} transform={`scale(${0.55 / glyphUi})`} />
            <animateMotion
              dur={`${dur.toFixed(1)}s`}
              begin={`${(-((r.id * 17 + airline.id * 7) % 70) / 10).toFixed(1)}s`}
              repeatCount="indefinite"
              keyPoints="0;0.5;0.5;1;1"
              keyTimes="0;0.45;0.5;0.95;1"
              calcMode="linear"
              rotate="auto"
              path={path}
            />
          </g>
        )
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, showRivals, isGlobe, globe, projKey, glyphUi])

  // Visibility only changes when the game state, selection, an LOD threshold
  // crossing, or the visible window changes — not on every animation frame of
  // a zoom, and not while a gesture is moving the layer (which does not touch
  // `view` at all).
  const lodKey = (scale >= 1.8 ? 2 : 0) | (scale >= 1.5 ? 1 : 0)
  const globeLand = useMemo(
    () =>
      isGlobe
        ? globeLandPath(globe, globe.s >= 1.8 && !rotating ? WORLD_RINGS_FINE : WORLD_RINGS)
        : '',
    [isGlobe, globe, rotating],
  )

  // Culling follows the ANCHOR — the window the layer is actually painted
  // around — not the logical view. A pan commit moves only the view; if it
  // moved the cull too, the city set would change and invalidate the raster
  // the pan-commit path exists to keep.
  const cull = anchor
  // The globe re-projects rather than panning, so it needs no overhang.
  const span = isGlobe ? SPAN_MIN : layerSpan(anchor.w)
  const { visible, labeled } = useMemo(() => {
    // Cities the player has a stake in stay visible at any zoom.
    const stakes = new Set<string>()
    for (const r of player.routes) {
      stakes.add(r.from)
      stakes.add(r.to)
    }
    for (const c of CITIES) if (slotsHeld(player, c.id) > 0) stakes.add(c.id)
    for (const e of state.world.events) if (e.city !== null) stakes.add(e.city)
    if (selected !== null) stakes.add(selected)
    const byTier = CITIES.filter((c) => (lodKey >= 2 ? true : cityTier(c) < 3) || stakes.has(c.id))
    // ...and then only the ones that can actually be seen. At world view that
    // is all of them; at 6x it is a couple of dozen out of 165, and the
    // difference is not just markup. The label pass below tests every label
    // against every label already placed, so rendering the whole world at
    // max zoom cost ~54k rectangle intersections to position a dozen labels
    // — paid again on every re-centre mid-drag. The pad covers the layer's
    // whole overhang with room to spare, so nothing culled here can be
    // revealed by a gesture before the layer re-centres and this runs again.
    // The globe does its own culling, by hemisphere.
    const pad = (layerSpan(cull.w) - 1) / 2 + 0.1
    const inFrame = (c: City): boolean =>
      isGlobe ||
      (x(c.lon) >= cull.x - cull.w * pad &&
        x(c.lon) <= cull.x + cull.w * (1 + pad) &&
        y(c.lat) >= cull.y - cull.h * pad &&
        y(c.lat) <= cull.y + cull.h * (1 + pad))
    const vis = byTier.filter(inFrame)
    return {
      visible: vis,
      labeled: new Set(vis.filter((c) => cityTier(c) === 1 || lodKey >= 1 || stakes.has(c.id)).map((c) => c.id)),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, selected, lodKey, isGlobe, cull.x, cull.y, cull.w, cull.h])

  // Cursor-anchored zoom, computed in TARGET space so consecutive wheel
  // events compound on where the view is heading, not where it is.
  const zoomAt = (
    clientX: number | null,
    clientY: number | null,
    factor: number,
    immediate = false,
  ): void => {
    const t = targetRef.current
    let mx = t.x + t.w / 2
    let my = t.y + t.h / 2
    const rect = clientX !== null && clientY !== null ? frameRect() : null
    if (clientX !== null && clientY !== null && rect !== null) {
      const m = viewToCss(rect, t.w, t.h)
      mx = t.x + (clientX - rect.left - m.offX) / m.k
      my = t.y + (clientY - rect.top - m.offY) / m.k
    }
    // Clamp the scale BEFORE anchoring: at the zoom limit the width stops
    // changing, and anchoring with an unclamped width would keep shifting
    // x/y toward the cursor — the "scrolls at an angle" bug.
    const w = Math.min(W, Math.max(W / MAX_SCALE, t.w / factor))
    if (w === t.w) return
    const h = (w / W) * H
    applyView({ x: mx - ((mx - t.x) / t.w) * w, y: my - ((my - t.y) / t.h) * h, w, h }, immediate)
  }

  // Wheel zoom must be a NATIVE non-passive listener: React registers onWheel
  // passively, so preventDefault() is ignored there and the page scrolls
  // underneath the map while it zooms. The handler lives in a ref (refreshed
  // every render) so the once-attached listener always sees current state.
  const wheelRef = useRef<(e: globalThis.WheelEvent) => void>(() => {})
  useEffect(() => {
    wheelRef.current = (e: globalThis.WheelEvent) => {
      e.preventDefault()
      // Proportional to scroll delta: gentle on trackpads (many small
      // deltas), one comfortable step per mouse-wheel notch, hard-clamped.
      const factor = Math.min(1.6, Math.max(0.625, Math.pow(1.0018, -e.deltaY)))
      if (isGlobe) {
        // Zoom toward the terrain under the cursor: drift the globe center a
        // share of the way to the cursor's geo point as the scale grows, so
        // what you point at is what you approach.
        const rect = frameRect()
        const g = globeTarget.current
        const next = { ...g, s: g.s * factor }
        if (rect && factor > 1) {
          const sx = ((e.clientX - rect.left) / rect.width) * W
          const sy = ((e.clientY - rect.top) / rect.height) * H
          const geo = globeUnproject(g, sx, sy)
          if (geo) {
            const t = 1 - 1 / factor
            let dLon = geo.lon - g.cLon
            while (dLon > 180) dLon -= 360
            while (dLon < -180) dLon += 360
            next.cLon = g.cLon + dLon * t
            next.cLat = g.cLat + (geo.lat - g.cLat) * t
          }
        }
        applyGlobe(next, true)
      } else zoomAt(e.clientX, e.clientY, factor)
    }
  })
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const handler = (e: globalThis.WheelEvent): void => wheelRef.current(e)
    el.addEventListener('wheel', handler, { passive: false })
    // `touch-action: none` should be enough to stop the browser claiming a
    // touch as a scroll — but it is honoured inconsistently on SVG elements,
    // and a browser that thinks a scroll may be starting stops painting the
    // page until the finger lifts, which is exactly "the map only moves when
    // I let go". Cancelling the default outright leaves nothing to decide.
    // React registers onTouchMove passively, so this has to be native.
    const swallow = (e: TouchEvent): void => {
      if (e.cancelable) e.preventDefault()
    }
    el.addEventListener('touchmove', swallow, { passive: false })
    return () => {
      el.removeEventListener('wheel', handler)
      el.removeEventListener('touchmove', swallow)
    }
  }, [])

  // Touch pinch: two active pointers zoom about their midpoint and pan with
  // it, writing through immediately (easing would fight fingers).
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ dist: number; midX: number; midY: number } | null>(null)
  // Explicit capture is best-effort. Touch pointers are captured implicitly by
  // the spec already, and SVG capture has been unreliable enough in the wild
  // that a throw here must never be allowed to abort the drag it was meant to
  // make smoother.
  const tryCapture = (el: SVGSVGElement, pointerId: number, type: string): void => {
    if (type === 'touch') return
    try {
      el.setPointerCapture(pointerId)
    } catch {
      /* the gesture works without it */
    }
  }

  const beginGesture = (): void => {
    gesturing.current = true
    setMoving(true)
    if (isGlobe) setRotating(true)
    // While the map is being dragged nothing on the PAGE may be selected
    // either — Safari can arm a text selection at press and extend it into
    // the content around the map once the pointer leaves it. The canceled
    // mousedown (on the svg) should prevent that, but some WebKit versions
    // arm it anyway, so selection is switched off document-wide for the
    // gesture and anything that slipped through is dropped.
    document.documentElement.classList.add('map-gesture')
    const sel = window.getSelection()
    if (sel !== null && !sel.isCollapsed) sel.removeAllRanges()
    // Grabbing something mid-animation stops it where it is. Gestures compute
    // from the TARGET so rapid inputs compound smoothly, which means a finger
    // landing while an eased zoom is still running would otherwise take the
    // globe (or the map) straight to wherever that zoom was heading — one
    // touch, and it jumps a whole zoom step and re-centres.
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
    }
    // "Where it is" is the eased position if one is in flight, not the last
    // committed view — the ease paints the DOM without going through state.
    targetRef.current = easing.current ? easeRef.current : view
    easing.current = false
    globeTarget.current = globeEasing.current ? globeEase.current : globe
    stopGlobeEase()
  }

  const endGesture = (): void => {
    if (!gesturing.current) return
    gesturing.current = false
    setMoving(false)
    setRotating(false)
    document.documentElement.classList.remove('map-gesture')
    gestureRect.current = null
    // Hand the live view back to React in one commit — which, for the pan
    // this almost always is, rewrites nothing the SVG rasters.
    commitView(targetRef.current)
  }

  const pinchGeometry = (): { dist: number; midX: number; midY: number } | null => {
    if (pointers.current.size < 2) return null
    const [a, b] = [...pointers.current.values()]
    return {
      dist: Math.hypot(b!.x - a!.x, b!.y - a!.y) || 1,
      midX: (a!.x + b!.x) / 2,
      midY: (a!.y + b!.y) / 2,
    }
  }

  const onPointerDown = (e: PointerEvent<SVGSVGElement>): void => {
    // A fresh gesture wipes any stale suppression. When a drag ends over
    // empty map, no click handler consumes the flag — without this, the NEXT
    // city click gets eaten and selection needs two clicks.
    suppressClick.current = false
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2) {
      pinch.current = pinchGeometry()
      drag.current = null
      suppressClick.current = true
      beginGesture()
      tryCapture(e.currentTarget, e.pointerId, e.pointerType)
    } else if (pointers.current.size === 1) {
      drag.current = { px: e.clientX, py: e.clientY, moved: false }
    }
  }

  const onPointerMove = (e: PointerEvent<SVGSVGElement>): void => {
    if (pointers.current.has(e.pointerId)) {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    }
    if (pinch.current) {
      const now = pinchGeometry()
      const rect = frameRect()
      if (!now || rect === null) return
      if (isGlobe) {
        const ratio = now.dist / pinch.current.dist
        const dmx = now.midX - pinch.current.midX
        const dmy = now.midY - pinch.current.midY
        const g = globeTarget.current
        const deg = 57.3 / (GLOBE_R * g.s * (rect.width / W))
        applyGlobe({ cLon: g.cLon - dmx * deg, cLat: g.cLat + dmy * deg, s: g.s * ratio }, true)
        pinch.current = now
        return
      }
      // Zoom about the midpoint, then follow the midpoint's travel.
      zoomAt(now.midX, now.midY, now.dist / pinch.current.dist, true)
      const t = targetRef.current
      applyView(
        {
          ...t,
          x: t.x - (now.midX - pinch.current.midX) / viewToCss(rect, t.w, t.h).k,
          y: t.y - (now.midY - pinch.current.midY) / viewToCss(rect, t.w, t.h).k,
        },
        true,
      )
      pinch.current = now
      return
    }
    if (!drag.current) return
    const dx = e.clientX - drag.current.px
    const dy = e.clientY - drag.current.py
    if (!drag.current.moved && Math.hypot(dx, dy) < 5) return
    if (!drag.current.moved) {
      // Capture only once a real drag starts — capturing on pointerdown would
      // steal the click from the city dots.
      drag.current.moved = true
      beginGesture()
      tryCapture(e.currentTarget, e.pointerId, e.pointerType)
    }
    const rect = frameRect()
    if (rect === null) return
    if (isGlobe) {
      // Trackball: the terrain follows the pointer. Degrees per pixel shrink
      // as the globe grows.
      const g = globeTarget.current
      const deg = 57.3 / (GLOBE_R * g.s * (rect.width / W))
      applyGlobe({ ...g, cLon: g.cLon - dx * deg, cLat: g.cLat + dy * deg }, true)
    } else {
      const t = targetRef.current
      const m = viewToCss(rect, t.w, t.h)
      applyView({ ...t, x: t.x - dx / m.k, y: t.y - dy / m.k }, true)
    }
    drag.current.px = e.clientX
    drag.current.py = e.clientY
  }

  // Double click / double tap zooms one level toward the point you aimed at —
  // the same 1.5x step the + button applies, so the two agree.
  const zoomInAt = (clientX: number, clientY: number): void => {
    if (isGlobe) applyGlobe({ ...globeTarget.current, s: globeTarget.current.s * 1.5 }, false)
    else zoomAt(clientX, clientY, 1.5)
  }

  // Touch has no dblclick, so the second tap is detected by hand: close in
  // time AND in space, or a quick pan-and-tap would zoom by accident.
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null)

  const onPointerUp = (e: PointerEvent<SVGSVGElement>): void => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinch.current = null
    // Keep `moved` readable by the click handlers that fire right after.
    const wasDrag = drag.current?.moved ?? false
    drag.current = null
    if (wasDrag) suppressClick.current = true
    if (pointers.current.size === 0) endGesture()
    if (e.pointerType === 'touch' && !wasDrag && pointers.current.size === 0) {
      const prev = lastTap.current
      const now = e.timeStamp
      if (prev !== null && now - prev.t < 320 && Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < 32) {
        lastTap.current = null
        // The second tap zooms instead of re-toggling whatever it landed on.
        suppressClick.current = true
        zoomInAt(e.clientX, e.clientY)
        return
      }
      lastTap.current = { t: now, x: e.clientX, y: e.clientY }
    }
  }

  const handleCityClick = (cityId: string, detail = 1): void => {
    if (detail >= 2) return // the dblclick handler is zooming
    if (suppressClick.current) {
      suppressClick.current = false
      return
    }
    onCityClick(cityId)
  }

  // Fat-finger tap resolution: a tap that misses every dot still selects the
  // nearest visible city within a finger's reach in SCREEN pixels. On a
  // phone the dots render around a single CSS pixel — without this the
  // game's primary verb is mouse-only. Precise dot/arc clicks stopPropagation
  // so they keep their exact behavior.
  const handleMapTap = (e: ReactMouseEvent<SVGSVGElement>): void => {
    if (e.detail >= 2) return // the second click of a double-click zooms
    if (suppressClick.current) {
      suppressClick.current = false
      return
    }
    const rect = frameRect()
    if (!rect) return
    const cssX = e.clientX - rect.left
    const cssY = e.clientY - rect.top
    // viewBox → CSS pixel mapping for the active projection.
    // viewBox → CSS px under preserveAspectRatio="slice": the SVG scales to
    // COVER its box, so the factor is the LARGER of the two ratios and the
    // surplus is split either side. Assuming the width ratio (what "meet"
    // would do) put every tap in the wrong place the moment the map's box
    // stopped matching the viewBox aspect — which is exactly what giving the
    // phone map a real height does.
    const vw = isGlobe ? W : view.w
    const vh = isGlobe ? H : view.h
    const vx = isGlobe ? 0 : view.x
    const vy = isGlobe ? 0 : view.y
    const { k, offX, offY } = viewToCss(rect, vw, vh)
    const toCss = (p: GlobePoint): { x: number; y: number } => ({
      x: (p.X - vx) * k + offX,
      y: (p.Y - vy) * k + offY,
    })
    let best: string | null = null
    let bestD = 28 // max reach in CSS px — a comfortable fingertip
    for (const c of visible) {
      const p = pt(c.lon, c.lat)
      if (!p.vis) continue
      const s = toCss(p)
      const d = Math.hypot(s.x - cssX, s.y - cssY)
      if (d < bestD) {
        bestD = d
        best = c.id
      }
    }
    if (best !== null) onCityClick(best)
  }

  return (
    // The view React has committed. During a gesture the viewBox on the SVG
    // runs ahead of it — written straight to the DOM — and this attribute is
    // how the handoff back at the end of the gesture can be seen: React only
    // rewrites it when the state actually changes.
    <div
      ref={wrapRef}
      className="map-wrap"
      data-testid="map-wrap"
      data-view={`${view.x} ${view.y} ${view.w} ${view.h}`}
      style={{ aspectRatio: `${W} / ${H}` }}
    >
      {/* The element a gesture moves, and the reason it is a div rather than
          the <g> it used to be. Transforming an SVG group re-rasterises every
          path under it on every frame: measured over a 40-frame drag at full
          detail, 876ms of raster. A promoted div with a CSS transform is a
          compositor operation — the same drag rasterises 0ms, identical to
          not moving at all. `contain: paint` and a standing will-change are
          what buy the cached layer; the SVG inside paints past its own box
          (overflow: visible) so the layer holds a frame-and-a-bit of world
          and a drag has real map to reveal instead of a blank edge. */}
      <div
        className="map-layer"
        ref={layerRef}
        data-testid="map-pan"
        style={{
          left: `${-((span - 1) / 2) * 100}%`,
          top: `${-((span - 1) / 2) * 100}%`,
          width: `${span * 100}%`,
          height: `${span * 100}%`,
        }}
      >
      <svg
        ref={svgRef}
        style={{
          left: `${((1 - 1 / span) / 2) * 100}%`,
          top: `${((1 - 1 / span) / 2) * 100}%`,
          width: `${(1 / span) * 100}%`,
          height: `${(1 / span) * 100}%`,
        }}
        viewBox={isGlobe ? `0 0 ${W} ${H}` : `${anchor.x} ${anchor.y} ${anchor.w} ${anchor.h}`}
        preserveAspectRatio="xMidYMid slice"
        className={`map era-${Math.min(2000, Math.max(1960, Math.floor(yearOf(state) / 10) * 10))}`}
        role="img"
        aria-label="World route map"
        data-testid="map"
        onPointerDown={onPointerDown}
        onMouseDown={(e) => {
          // A press on the map is a pan, never the start of a text selection.
          // user-select: none covers the map itself, but Safari arms the
          // selection at mousedown and extends it into the page around the
          // map the moment the pointer leaves it mid-drag. Canceling
          // mousedown keeps it from arming at all; click and dblclick still
          // fire, so taps and double-click zoom are untouched.
          e.preventDefault()
        }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={handleMapTap}
        onDoubleClick={(e) => zoomInAt(e.clientX, e.clientY)}
      >
        <defs>
          {/* Ocean depth: the abyssal plain is darker than the shelves, so the
              continents sit ON something instead of floating in flat black. */}
          {/* Pinned to the world, not to the rect that carries it: the sea
              rect overscans the frame (see below) and a bounding-box gradient
              would stretch and re-centre with it. */}
          <radialGradient
            id="seaDepth"
            gradientUnits="userSpaceOnUse"
            cx={W / 2}
            cy={H * 0.42}
            r={Math.max(W, H) * 0.78}
          >
            <stop offset="0%" className="sea-stop-shallow" />
            <stop offset="100%" className="sea-stop-deep" />
          </radialGradient>
        </defs>
        {/* Everything that pans lives in one group so a gesture can move it
            with a transform instead of a viewBox — see paintView. The
            vignette stays outside, pinned to the frame. */}
        <g className="map-pan">
          {/* The sea overscans a whole frame on every side, for two reasons:
              `slice` scales the viewBox to COVER the element, so a container
              shaped differently from the viewBox — always, on the globe, whose
              viewBox is a fixed W x H — has visible area outside it; and the
              layer now bleeds past the frame so a drag reveals painted world.
              A sea of exactly W x H left both unpainted, and the globe sat in
              a black rectangle narrower than the window. */}
          <rect x={-W} y={-H} width={W * 3} height={H * 3} className="map-sea" fill="url(#seaDepth)" />
          {!isGlobe && <path d={graticulePath()} className="graticule map-graticule" />}
          {isGlobe ? (
            <>
              <defs>
                {/* A soft key light up-left: the disc reads as a sphere. */}
                <radialGradient id="globeShade" cx="38%" cy="32%" r="80%">
                  <stop offset="0%" stopColor="#1b2a45" />
                  <stop offset="70%" stopColor="#111b2e" />
                  <stop offset="100%" stopColor="#0b111e" />
                </radialGradient>
              </defs>
              <circle cx={W / 2} cy={H / 2} r={GLOBE_R * globe.s} fill="url(#globeShade)" className="globe-disc" />
              <path d={globeGraticule(globe)} className="graticule" />
              {/* Same quality ladder as the flat map: coast glow under the
                  land, fine coastline and borders past the same thresholds,
                  islets for the airports whose islands do not survive 1:50m.
                  The one concession is mid-rotation, where every frame is a
                  full re-projection: coarse rings until the globe rests. */}
              <path d={globeLand} className="map-coast-glow" />
              <path d={globeLand} className="map-land" data-testid="globe-land" />
              {globe.s >= 1.35 && !rotating && (
                <path d={globeLinesPath(globe, BORDER_LINES)} className="map-border" />
              )}
              {ISLET_POINTS.map(([lon, lat]) => {
                const p = globeProjectFull(globe, lon, lat)
                if (p.cosc <= 0.001) return null
                // The flat islet is r=1.6 in a map where 360 degrees is 960
                // units; the globe's equator is 2*pi*R, so the same island is
                // scaled by the ratio of the two.
                return (
                  <circle
                    key={`islet-${lon},${lat}`}
                    cx={p.X}
                    cy={p.Y}
                    r={(1.6 * (2 * Math.PI * GLOBE_R * globe.s)) / W}
                    className="map-land map-islet"
                  />
                )
              })}
              <circle cx={W / 2} cy={H / 2} r={GLOBE_R * globe.s} className="globe-limb" />
            </>
          ) : (
            <>
              {/* The coast's glow is GEOMETRY, not a filter: the same path
                  stroked wide underneath, and the land drawn over its inner
                  half leaves a halo. It used to be an SVG drop-shadow, and an
                  SVG filter's region is the bounding box of the whole world —
                  WebKit re-runs that blur on every re-raster of the layer,
                  which measured as the difference between a 186ms and a 46ms
                  worst frame during a drag. A stroke is just another path
                  pass, cheap on every engine, and at 2.5 non-scaling pixels
                  it reads the same. */}
              <path d={scale >= 1.8 ? WORLD_PATH_FINE : WORLD_PATH} className="map-coast-glow" />
              {/* Detail that resolves: the coarse coastline is a smear at 3x,
                  and the fine one is wasted bytes of curve at world view. The
                  swap happens at a committed render, once per threshold
                  crossing — never mid-gesture. */}
              <path d={scale >= 1.8 ? WORLD_PATH_FINE : WORLD_PATH} className="map-land" />
              {/* Country borders come from a separate mesh, so they are the
                  borders themselves and never a second copy of the coast. */}
              {scale >= 1.35 && <path d={BORDERS_PATH} className="map-border" />}
              {/* Islands with an airport but too small to survive 1:50m
                  generalisation — without these, Guam is an airport in open
                  ocean. */}
              <path d={ISLETS_PATH} className="map-land map-islet" />
            </>
          )}
          {/* Transfer hubs glow in proportion to the connecting pax flowing
              over them last quarter. */}
          {[...hubVolume.entries()]
            .filter(([, v]) => v >= 500)
            .map(([cityId, v]) => {
              const p = cityPt(cityId)
              if (!p.vis) return null
              return (
                <circle
                  key={`hub-${cityId}`}
                  cx={p.X}
                  cy={p.Y}
                  r={(5 + Math.min(14, Math.sqrt(v) / 6)) / uiScale}
                  className="hub-glow"
                  data-testid={`hub-glow-${cityId}`}
                >
                  <title>{`${cityId}: ${v.toLocaleString('en-US')} connecting pax last quarter`}</title>
                </circle>
              )
            })}
          {/* Rival networks, thin and color-coded per airline, under the
              player's arcs. Toggleable for decluttering. */}
          {rivalArcsLayer}
          {playerArcsLayer}
          {/* Constant traffic: planes shuttle back and forth on every served
              route — more of them the busier the schedule, and long-haul takes
              visibly longer than a hop. */}
          {playerPlanesLayer}
          {/* Rival traffic: one small plane per rival route (capped) so their
              networks read as alive, in the rival's own color. */}
          {rivalPlanesLayer}
          {/* Fresh slot wins ping gold at the airport. */}
          {[...newSlotCities].sort().map((cityId) => {
            const p = cityPt(cityId)
            if (!p.vis) return null
            return (
              <circle
                key={`slots-${cityId}`}
                cx={p.X}
                cy={p.Y}
                r={11 / uiScale}
                className="slots-ping"
                data-testid={`slots-ping-${cityId}`}
              />
            )
          })}
          {/* Active world events glow on the map: gold halo on boosted cities and
              regions (Olympics, fairs, tourism waves), red on conflict zones. */}
          {state.world.events.map((e) => {
            const def = getEventDef(e.id)
            if (def.demandModBp === undefined) return null
            const good = def.demandModBp >= 10000
            const cities = e.city !== null ? [getCity(e.city)] : CITIES.filter((c) => c.region === e.region)
            return cities.map((c) => {
              const p = pt(c.lon, c.lat)
              if (!p.vis) return null
              return (
                <circle
                  key={`${e.id}-${c.id}`}
                  cx={p.X}
                  cy={p.Y}
                  r={12 / uiScale}
                  className={good ? 'event-halo halo-boom' : 'event-halo halo-bust'}
                  data-testid={`event-halo-${c.id}`}
                />
              )
            })
          })}
          {/* Planning a route: a dashed ring shows how far the longest-legged
              idle airframe can fly from the origin — why a target is (or isn't)
              reachable, drawn instead of guessed. Flat map only; the globe's
              great-circle disc would lie near the poles. */}
          {!isGlobe &&
            routeFrom !== null &&
            idleReachKm > 0 &&
            (() => {
              const origin = getCity(routeFrom)
              const p = pt(origin.lon, origin.lat)
              if (!p.vis) return null
              // Local px-per-km at the origin's latitude (equirectangular).
              const kmPerLonDeg = 111.32 * Math.max(0.2, Math.cos((origin.lat * Math.PI) / 180))
              const rx = (idleReachKm / kmPerLonDeg) * (W / 360)
              const ry = (idleReachKm / 111.32) * (H / (MAP_LAT_MAX - MAP_LAT_MIN)) // px per lat degree, mirrors y()
              return (
                <ellipse
                  cx={p.X}
                  cy={p.Y}
                  rx={rx}
                  ry={ry}
                  className="range-ring"
                  data-testid="range-ring"
                />
              )
            })()}
          {visible.map((c) => {
            const held = slotsHeld(player, c.id)
            // In route-planning mode, legal destinations light up as targets —
            // and a route must touch the network (HQ or a served city).
            const inNetwork = network.has(c.id)
            const isTarget =
              routeFrom !== null &&
              routeFrom !== c.id &&
              (network.has(routeFrom) || inNetwork) &&
              held > slotsUsedAt(player.routes, c.id) &&
              distanceKm(routeFrom, c.id) <= idleReachKm &&
              !player.routes.some(
                (r) =>
                  (r.from === c.id && r.to === routeFrom) || (r.from === routeFrom && r.to === c.id),
              )
            const p = pt(c.lon, c.lat)
            if (!p.vis) return null
            const r = (1.7 + cityMass(c) / 13) / Math.sqrt(uiScale)
            return (
              <g
                key={c.id}
                onClick={(e) => {
                  e.stopPropagation() // precise hit — don't also run the nearest-city resolver
                  handleCityClick(c.id, e.detail)
                }}
                className="city"
              >
                {selected === c.id && (
                  <circle cx={p.X} cy={p.Y} r={r + 5 / uiScale} className="selection-ring" />
                )}
                {player.slotRequests.some((r) => r.city === c.id) && (
                  <circle
                    cx={p.X}
                    cy={p.Y}
                    r={r + 4 / uiScale}
                    className="negotiating-ring"
                    data-testid={`negotiating-${c.id}`}
                  />
                )}
                {/* A rival has announced it will court this authority next
                    quarter. Knowing BEFORE you commit is the difference between
                    a bidding war and an ambush. */}
                {state.airlines.some((a) => a.id !== 0 && !a.bankrupt && a.slotInterest === c.id) && (
                  <circle
                    cx={p.X}
                    cy={p.Y}
                    r={r + 6.5 / uiScale}
                    className="rival-negotiating-ring"
                    data-testid={`rival-negotiating-${c.id}`}
                  />
                )}
                {inNetwork && <circle cx={p.X} cy={p.Y} r={r + 2.5 / uiScale} className="city-network-ring" />}
                {c.id === player.hq && (
                  <text
                    x={p.X}
                    y={p.Y - r - 4 / uiScale}
                    className="hq-marker"
                    fontSize={9 / uiScale}
                    textAnchor="middle"
                    data-testid="hq-marker"
                  >
                    ★
                  </text>
                )}
                <circle
                  data-testid={`city-${c.id}`}
                  cx={p.X}
                  cy={p.Y}
                  r={r}
                  className={
                    (selected === c.id
                      ? 'city-dot selected'
                      : isTarget
                        ? 'city-dot target'
                        : held > 0
                          ? 'city-dot slotted'
                          : 'city-dot') +
                    ` tier-${cityTier(c)}` +
                    // Capacity pressure, straight from the slot model: an airport
                    // filling up is a place you have to move on, and the map is
                    // where that decision starts.
                    (pressure(c.id) >= 1 ? ' full' : pressure(c.id) >= 0.75 ? ' tight' : '')
                  }
                />
              </g>
            )
          })}
          {/* Labels draw in their own layer ABOVE every dot, with a halo — a
              neighboring city's dot can never sit on top of a name. Mass order
              is the priority order: majors get first pick of the slots. The
              collision pass itself is in labels.ts, which does it against a
              uniform grid rather than by scanning every label already placed;
              the naive version is quadratic and peaks at ~150 labels around
              1.8x zoom, where tier-3 cities unlock but the frame still holds
              most of the world. */}
          {(() => {
            const fs = 9 / uiScale
            const gap = 3 / uiScale
            const sites = visible
              .filter((c) => labeled.has(c.id))
              .sort((a, b) => cityMass(b) - cityMass(a) || (a.id < b.id ? -1 : 1))
              .map((c) => ({ c, p: pt(c.lon, c.lat) }))
              .filter(({ p }) => p.vis)
              .map(({ c, p }) => ({
                id: c.id,
                x: p.X,
                y: p.Y,
                r: (1.7 + cityMass(c) / 13) / Math.sqrt(uiScale),
                w: c.id.length * fs * 0.66,
              }))
            return placeLabels(sites, fs, gap).map((l) => (
              <text
                key={`label-${l.id}`}
                x={l.x}
                y={l.y}
                fontSize={fs}
                textAnchor={l.anchor}
                className="city-label"
              >
                {l.id}
              </text>
            ))
          })()}
        </g>
      </svg>
      </div>
      {/* The frame falls off into the dark so the middle of the world holds
          the eye. It belongs to the frame, not the world, so it sits outside
          the layer entirely — a gesture must not drag it around. A CSS
          gradient on a div, rather than a rect inside the SVG, is what keeps
          it still now that the whole SVG moves. */}
      <div className="map-vignette" />
      <div className="map-controls">
        <button
          data-testid="zoom-in"
          aria-label="zoom in"
          onClick={() =>
            isGlobe
              ? applyGlobe({ ...globeTarget.current, s: globeTarget.current.s * 1.5 }, false)
              : zoomAt(null, null, 1.5)
          }
        >
          +
        </button>
        <button
          data-testid="zoom-out"
          aria-label="zoom out"
          onClick={() =>
            isGlobe
              ? applyGlobe({ ...globeTarget.current, s: globeTarget.current.s / 1.5 }, false)
              : zoomAt(null, null, 1 / 1.5)
          }
        >
          −
        </button>
        <button
          data-testid="zoom-reset"
          aria-label="reset zoom"
          onClick={() => (isGlobe ? applyGlobe(GLOBE_HOME, false) : applyView(homeView(), false))}
        >
          ⤢
        </button>
        <button
          data-testid="map-projection"
          aria-label={isGlobe ? 'switch to flat map' : 'switch to globe'}
          title={isGlobe ? 'flat map' : 'globe'}
          className={isGlobe ? 'active' : ''}
          onClick={() => {
            const next = isGlobe ? 'flat' : 'globe'
            setProjection(next)
            localStorage.setItem('loadfactor:projection', next)
          }}
        >
          🌐
        </button>
        <button
          data-testid="toggle-rivals"
          aria-label={showRivals ? 'hide rival networks' : 'show rival networks'}
          className={showRivals ? 'active' : ''}
          onClick={() => setShowRivals((v) => !v)}
        >
          ⚔
        </button>
        <button
          data-testid="map-lens"
          aria-label={`data lens: ${lens === 'none' ? 'off' : lens === 'load' ? 'load factor' : lens === 'profit' ? 'profit' : 'season'} — click to cycle`}
          title={`lens: ${lens === 'none' ? 'off' : lens === 'load' ? 'load factor' : lens === 'profit' ? 'P&L' : 'season'}`}
          className={lens !== 'none' ? 'active' : ''}
          onClick={() => setLens(lens === 'none' ? 'load' : lens === 'load' ? 'profit' : lens === 'profit' ? 'season' : 'none')}
        >
          {lens === 'profit' ? '$' : lens === 'season' ? '🌞' : '◐'}
        </button>
      </div>
      {/* Minimap inset: once zoomed in, a world thumbnail shows where the
          viewport sits — click (or drag) to jump the view there. Flat map
          only; the globe orients itself. */}
      {!isGlobe && view.w < W * 0.85 && (
        <div className="minimap-wrap">
        <svg
          className="minimap"
          viewBox={`0 0 ${W} ${H}`}
          data-testid="minimap"
          role="img"
          aria-label="Minimap — click to move the view"
          onMouseDown={(e) => e.preventDefault()} // a jump, never a selection
          onPointerDown={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            const mx = ((e.clientX - rect.left) / rect.width) * W
            const my = ((e.clientY - rect.top) / rect.height) * H
            const t = targetRef.current
            applyView({ ...t, x: mx - t.w / 2, y: my - t.h / 2 }, true)
          }}
        >
          <rect x={0} y={0} width={W} height={H} className="map-sea" />
          <path d={WORLD_PATH} className="minimap-land" />
        </svg>
          {/* The viewport marker is an ordinary div, not a rect inside the
              SVG. Writing a transform onto an SVG element re-runs SVG layout,
              so even as a pure translate this little inset was repainting on
              every frame of a drag: hiding it took frames over 32ms from 51
              to 22 under a 6x CPU throttle. A div on its own layer is a
              compositor move, like the map. The translate is a percentage of
              the marker's OWN box, which is exactly view.w wide — so
              translating it 100% of itself moves it one view across the
              world, and no pixel measurement is needed. */}
          <div
            ref={minimapRef}
            className="minimap-viewport"
            data-testid="minimap-viewport"
            style={{
              width: `${(view.w / W) * 100}%`,
              height: `${(view.h / H) * 100}%`,
              transform: `translate3d(${(view.x / view.w) * 100}%, ${(view.y / view.h) * 100}%, 0)`,
            }}
          />
        </div>
      )}
    </div>
  )
}
