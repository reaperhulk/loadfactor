// SVG world map: real landmass under an equirectangular projection, cities as
// dots with zoom-dependent level of detail, routes as lifted arcs whose look
// tells you short-haul from long-haul at a glance. Presentation-only floats
// are fine here — the engine never sees screen coordinates.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent } from 'react'
import { getAircraftType } from '../data/aircraft'
import { CITIES, distanceKm, getCity, pairKey, type City } from '../data/cities'
import { pairWeeklyDemand, seasonalBp } from '../engine/market'
import { MIN_ROUTE_KM } from '../data/constants'
import { Icon } from './Icon'
import { loadGlobeGeometry, type GlobeGeometry } from './globeGeometry'
import { aircraftGlyph } from './AircraftArt'
import { reducedMotion, useDisplayPreferences, useReducedMotion } from './display'
import { placeLabels } from './labels'
import { cityMass, cityTier, rivalColor, rivalColorClass, type MapLens } from './mapStyle'
import { MapLegend } from './legends'
import { REGION_COLLAPSE_BELOW_SCALE, eventHalos, regionHaloShape } from './map/eventHalos'
import { QUARTER_RESULT_MS, quarterTrends } from './map/quarterResult'
import { ARROW_DIRECTIONS, nearestInDirection } from './map/keyboard'
import { TrafficCanvas } from './TrafficCanvas'
import { polylineLeg, quadraticLeg, type TrafficCamera, type TrafficEffect, type TrafficLeg, type TrafficPlane } from './traffic'
import {
  BORDERS_PATH,
  ISLETS_PATH,
  MAP_H,
  MAP_LAT_MAX,
  MAP_LAT_MIN,
  MAP_W,
  WORLD_PATH,
  WORLD_PATH_FINE,
  projectLat,
  projectLon,
} from '../data/worldmap.gen'
import type { GameState, Route } from '../engine'
import {
  effectiveFrequency,
  isGrounded,
  operatingFleet,
  networkCities,
  pairWeeklySeats,
  routeWeeklyCapacity,
  slotCities,
  slotsAllocated,
  slotsHeld,
  yearOf,
} from '../engine/queries'
import { cityPool } from '../engine/slots'
import type { Airline } from '../engine'
import { viewSeat } from './session'
import './map.css'
import {
  FULL_VIEW,
  HOME_SCALE_COMPACT,
  HOME_SCALE_DESKTOP,
  MAX_SCALE,
  SPAN_MIN,
  layerSpan,
  NO_INSETS,
  clampView,
  homeViewFor,
  overlayInsets,
  viewToCss,
  visibleRect,
  type Insets,
  type ViewBox,
} from './map/camera'

// Arc weight tells capacity: seats/wk drive stroke width, so the map itself
// shows where an airline's hardware is concentrated. Fed to CSS as a custom
// property so hover/transition rules still win.
function capWidth(airline: Airline, route: Route, thin: boolean, turn: number): number {
  const cap = routeWeeklyCapacity(airline, route, turn)
  const w = (thin ? 0.6 : 0.7) + Math.sqrt(cap) / (thin ? 90 : 40)
  return Math.min(thin ? 1.6 : 4, Math.max(thin ? 0.7 : 0.9, w))
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


const x = projectLon
const y = projectLat

// Top-view airliner silhouette, nose on the +x axis — the traffic canvas
// rotates it to the direction of travel, so this glyph always flies
// nose-first.
const PLANE_GLYPH =
  'M 7 0 C 6 -0.9 5 -1 4 -1 L 1.2 -1 L -1.8 -5 L -3.6 -5 L -1.9 -1 L -4.6 -1 ' +
  'L -6.2 -2.6 L -6.8 -2.6 L -5.8 0 L -6.8 2.6 L -6.2 2.6 L -4.6 1 L -1.9 1 ' +
  'L -3.6 5 L -1.8 5 L 1.2 1 L 4 1 C 5 1 6 0.9 7 0 Z'

// LOD contract: majors and regionals (tier 1-2) are visible from the world
// view — Aerobiz-style busy map; small fields (tier 3) fade in at 1.8× zoom,
// labels for non-majors at 1.5×. Implemented via lodKey in the render memo.

// Quadratic arc between two cities, lifted perpendicular to the chord — reads
// as a flight path instead of a fence line. The control point is shared by
// the drawn arc and the traffic shuttle that rides it.
function arcControl(fromId: string, toId: string): { x1: number; y1: number; mx: number; my: number; x2: number; y2: number } {
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
  return { x1, y1, mx: (x1 + x2) / 2 + (dy / len) * lift, my: (y1 + y2) / 2 - (dx / len) * lift, x2, y2 }
}

function arcPath(fromId: string, toId: string): string {
  const { x1, y1, mx, my, x2, y2 } = arcControl(fromId, toId)
  return `M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`
}

// The same arc as a sampled polyline for the traffic canvas, which paces the
// shuttle by arc length and orients the glyph along each segment.
function flatTripLeg(fromId: string, toId: string): TrafficLeg {
  const { x1, y1, mx, my, x2, y2 } = arcControl(fromId, toId)
  return quadraticLeg(x1, y1, mx, my, x2, y2)
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

// Short hops, medium stages, and long-haul trunks each get their own line
// language (width/dash), on top of the arc lift that grows with distance.
// Home for the airline in the viewer's seat: its HQ, served cities and
// footholds, framed by homeViewFor for this frame. A phone opens on the home
// region, a desktop on nearly the whole world centred on the network.
function networkHome(state: GameState, frame: { width: number; height: number }, insets: Insets): ViewBox {
  const me = state.airlines[viewSeat()]!
  const ids = [...new Set([me.hq, ...networkCities(me), ...slotCities(me)])].sort()
  const points = ids.map((id) => {
    const c = getCity(id)
    return { x: x(c.lon), y: y(c.lat) }
  })
  const compact = typeof window !== 'undefined' && window.innerWidth <= 1100
  return homeViewFor({ points, frame, insets, maxScale: compact ? HOME_SCALE_COMPACT : HOME_SCALE_DESKTOP })
}

function haulClass(km: number): string {
  return km >= 4500 ? 'route-long' : km >= 1500 ? 'route-medium' : 'route-short'
}

// Module-level path caches. Route/trip paths are pure in (projection,
// endpoints), and the flat projection never moves — so during a zoom ease
// (many renders per second) every path string is a Map hit instead of fresh
// Bézier math. A globe move changes the projection key and flushes the
// globe entries. Presentation-only mutable state; the engine sees none of it.
const routePathCache = new Map<string, string>()
const tripLegCache = new Map<string, TrafficLeg | null>()
let cachedProjKey = 'flat'

function flushOnProjChange(projKey: string): void {
  if (projKey === cachedProjKey) return
  cachedProjKey = projKey
  routePathCache.clear()
  tripLegCache.clear()
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

function cachedTripLeg(projKey: string, globe: GlobeView | null, fromId: string, toId: string): TrafficLeg | null {
  flushOnProjChange(projKey)
  const k = `${fromId}|${toId}`
  let leg = tripLegCache.get(k)
  if (leg === undefined) {
    leg = globe !== null ? globeTripLeg(globe, fromId, toId) : flatTripLeg(fromId, toId)
    tripLegCache.set(k, leg)
  }
  return leg
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
export function globeLandPath(
  g: GlobeView,
  rings: readonly (readonly (readonly [number, number])[])[],
): string {
  const R = GLOBE_R * g.s
  const cx = W / 2
  const cy = H / 2
  const parts: string[] = []
  for (const ring of rings) {
    const points = ring.map(([lon, lat]) => globeProjectFull(g, lon, lat))
    const start = points.findIndex((p) => p.cosc > 0.001)
    if (start < 0) continue
    // A ring has no privileged first vertex. Start on the visible coastline
    // so every hidden run (including one spanning the stored ring's seam)
    // goes through the limb-arc bridge below. Otherwise SVG's closing Z
    // joins two limb points with a chord and fills a wedge of ocean.
    let d = ''
    let prevLimbAz: number | null = null
    const emit = (px: number, py: number): void => {
      d += `${d === '' ? 'M' : 'L'}${px.toFixed(1)} ${py.toFixed(1)}`
    }
    for (let i = 0; i < points.length; i++) {
      const p = points[(start + i) % points.length]!
      if (p.cosc > 0.001) {
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
    parts.push(d + 'Z')
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

// The great circle for the traffic shuttle — only when the whole leg faces
// the viewer (a plane vanishing mid-flight reads as a glitch).
function globeTripLeg(g: GlobeView, fromId: string, toId: string): TrafficLeg | null {
  const pts = greatCircle(fromId, toId).map(([lon, lat]) => globeProject(g, lon, lat))
  if (pts.some((p) => !p.vis)) return null
  const flat = new Float64Array(pts.length * 2)
  pts.forEach((p, i) => {
    flat[i * 2] = p.X
    flat[i * 2 + 1] = p.Y
  })
  return polylineLeg(flat)
}

interface MapViewProps {
  flowRouteIds?: number[]
  selectedRouteId?: number
  active?: boolean
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
  // Flash each route by its profit change once a quarter's report closes. Off
  // for the replay viewer, where quarters advance on a timer.
  announceQuarter?: boolean
}

export function MapView({
  active = true,
  selectedRouteId,
  flowRouteIds,
  state,
  selected,
  routeFrom,
  onCityClick,
  onRouteClick,
  newRouteIds,
  newSlotCities,
  acquiredRouteIds,
  announceQuarter = true,
}: MapViewProps) {
  const display = useDisplayPreferences()
  const reduceMotion = useReducedMotion()
  const svgRef = useRef<SVGSVGElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  // The frame's size in CSS px — state for rendering, and a ref for the input
  // and framing paths that must see a measurement taken this very tick.
  const [frame, setFrame] = useState({ width: W, height: H })
  const frameRef = useRef(frame)
  const frameAspect = frame.width / frame.height
  const aspectNow = (): number => frameRef.current.width / frameRef.current.height
  // Home frames the player's own network — HQ, served cities, footholds —
  // in the part of the frame the map's chrome does not cover (see
  // homeViewFor). A phone's box is nearly square against a 2.7:1 world, so it
  // opens on the home region; a desktop opens on nearly the whole world,
  // centred where the airline actually flies instead of on the Atlantic.
  const homeView = (): ViewBox => {
    const wrap = wrapRef.current
    const rect = wrap?.getBoundingClientRect()
    const measured = rect !== undefined && rect.width > 0 && rect.height > 0
    const insets = measured
      ? overlayInsets(rect, [...wrap!.querySelectorAll('.map-controls, .map-data-control')].map((el) => el.getBoundingClientRect()))
      : NO_INSETS
    return networkHome(state, measured ? rect : frameRef.current, insets)
  }
  // Before the frame is measured, home is a guess at the world's own aspect;
  // the first measurement (below) frames it for real, before first paint.
  const [initialView] = useState<ViewBox>(() => networkHome(state, { width: W, height: H }, NO_INSETS))
  const [view, setView] = useState<ViewBox>(initialView)
  // What the SVG rasters, as opposed to what React knows. `view` is the
  // logical view — taps, cull-adjacent reads, the minimap, data-view — and
  // `anchor` is the viewBox actually written to the DOM. They part ways after
  // a pan: the world at a shifted offset is the same pixels, already painted,
  // so a pan commits into `view` and leaves the layer's transform parked —
  // no viewBox rewrite, no re-raster, nothing. Only a zoom (new resolution)
  // or a re-centre (new world content) moves the anchor, and each is a single
  // raster taken at rest.
  const [anchor, setAnchor] = useState<ViewBox>(initialView)
  // Called with every new frame measurement (see the observer below): the
  // first real one frames home, since nothing before it knew the frame's
  // shape; later ones only re-clamp, so a resize never strands the view off
  // the world's edge. A ref, refreshed each render, so the once-attached
  // observer always runs against current state.
  const homed = useRef(false)
  const onFrameRef = useRef<(width: number, height: number) => void>(() => {})
  const drag = useRef<{ px: number; py: number; moved: boolean } | null>(null)
  // Zoom eases toward targetRef via exponential smoothing in a rAF loop;
  // panning writes through immediately. Wheel/button handlers mutate the
  // TARGET, so rapid inputs compound smoothly instead of stacking jumps.
  const targetRef = useRef<ViewBox>(initialView)
  const rafRef = useRef(0)

  // Projection: the flat overview or a rotatable orthographic globe. The
  // choice persists — planning favors the whole-world view, the globe is the
  // honest picture of what long-haul really flies.
  const [projection, setProjection] = useState<'flat' | 'globe'>(() => {
    try { return localStorage.getItem('loadfactor:projection') === 'globe' ? 'globe' : 'flat' } catch { return 'flat' }
  })
  const [globeGeometry, setGlobeGeometry] = useState<GlobeGeometry | null>(null)
  const [globeError, setGlobeError] = useState(false)
  const [globeRetry, setGlobeRetry] = useState(0)
  useEffect(() => {
    if (projection !== 'globe' || globeGeometry) return
    let cancelled = false
    loadGlobeGeometry().then((geometry) => {
      if (!cancelled) { setGlobeGeometry(geometry); setGlobeError(false) }
    }).catch(() => { if (!cancelled) setGlobeError(true) })
    return () => { cancelled = true }
  }, [projection, globeGeometry, globeRetry])
  // The flat map remains usable while the optional globe chunk is in flight.
  const isGlobe = projection === 'globe' && globeGeometry !== null
  const globeLoading = projection === 'globe' && !globeGeometry && !globeError

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
      // Reached through the animation APIs, not a CSS class: toggling a class
      // meant a descendant-selector restyle over the whole map to reach two
      // elements that usually are not even there, and it measured ~12ms of
      // the first frame of a drag. The traffic canvas freezes its own clock
      // off movingRef; the SVG pause covers any SMIL that ever returns.
      svg.pauseAnimations()
      paused.current = svg.getAnimations({ subtree: true }).filter((a) => a.playState === 'running')
      for (const a of paused.current) a.pause() // CSS: selection ring, target blink
    } else if (active && !document.hidden && !reduceMotion) {
      svg.unpauseAnimations()
      for (const a of paused.current) a.play()
      paused.current = []
    }
  }
  useEffect(() => {
    const visibility = () => {
      const svg = svgRef.current
      if (!svg) return
      if (!active || document.hidden || reduceMotion || movingRef.current) svg.pauseAnimations()
      else svg.unpauseAnimations()
    }
    visibility()
    document.addEventListener('visibilitychange', visibility)
    return () => document.removeEventListener('visibilitychange', visibility)
  }, [reduceMotion, active])
  const layerRef = useRef<HTMLDivElement>(null)
  const minimapRef = useRef<HTMLDivElement>(null)
  // The viewBox actually in the DOM. The transform maps it to the live view.
  const baseRef = useRef<ViewBox>(initialView)
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
  const layerXf = useRef({ tx: 0, ty: 0, s: 1 })
  const paintLayer = (tx: number, ty: number, s: number): void => {
    layerXf.current = { tx, ty, s }
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
  const paintedRef = useRef<ViewBox>(initialView)

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
      const vis = visibleRect(v, aspectNow())
      mm.style.transform = `translate3d(${(vis.x / vis.w) * 100}%, ${(vis.y / vis.h) * 100}%, 0)`
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
    spanRef.current = isGlobe ? SPAN_MIN : layerSpan(anchor, frameAspect)
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
  const easeRef = useRef<ViewBox>(initialView)
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
    immediate = immediate || reduceMotion
    targetRef.current = clampView(target, aspectNow())
    if (gesturing.current) {
      // Mid-gesture: straight to the DOM, no render, no media query. A pinch
      // changes the width and pays the same scaling bill as an eased zoom.
      stopEase()
      paintView(targetRef.current)
      return
    }
    const reduced = reducedMotion()
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

  useLayoutEffect(() => {
    onFrameRef.current = (width: number, height: number): void => {
      const prev = frameRef.current
      if (prev.width === width && prev.height === height && homed.current) return
      frameRef.current = { width, height }
      setFrame(frameRef.current)
      if (!homed.current) {
        homed.current = true
        applyView(homeView(), true)
      } else if (!gesturing.current && !rafRef.current) {
        const t = targetRef.current
        const c = clampView(t, width / height)
        if (Math.abs(c.x - t.x) > 0.01 || Math.abs(c.y - t.y) > 0.01) applyView(c, true)
      }
    }
  })
  // Measured before the first paint so home is framed for the real frame
  // rather than flashing the guess the initial state had to make.
  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    if (r.width > 0 && r.height > 0) onFrameRef.current(r.width, r.height)
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry!.contentRect
      if (width > 0 && height > 0) onFrameRef.current(width, height)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  // A different airline in the seat (a new career, the next hotseat player)
  // opens on its own network.
  const homeKey = `${viewSeat()}:${state.airlines[viewSeat()]!.hq}`
  const lastHomeKey = useRef(homeKey)
  useEffect(() => {
    if (lastHomeKey.current === homeKey) return
    lastHomeKey.current = homeKey
    if (homed.current && !gesturing.current) applyView(homeView(), true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [homeKey])

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
    immediate = immediate || reduceMotion
    globeTarget.current = clampGlobe(next)
    const reduced = reducedMotion()
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
  // Projection shortcuts belong to the visible map, outside forms/dialogs.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!active || e.ctrlKey || e.metaKey || e.altKey || (e.key !== 'g' && e.key !== 'G')) return
      const target = e.target as HTMLElement | null
      if (target?.closest('input, select, textarea, [role=dialog], [contenteditable=true]')) return
      setProjection((p) => {
        const next = p === 'globe' ? 'flat' : 'globe'
        try { localStorage.setItem('loadfactor:projection', next) } catch { /* session preference */ }
        return next
      })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active])
  const clampGlobe = (g: GlobeView): GlobeView => ({
    cLon: ((g.cLon + 540) % 360) - 180,
    cLat: Math.min(80, Math.max(-80, g.cLat)),
    s: Math.min(MAX_SCALE, Math.max(1, g.s)),
  })

  const seat = viewSeat()
  const player = state.airlines[seat]!
  const scale = isGlobe ? globe.s : W / view.w
  // Normalize decorations to actual CSS pixels, including the SVG's slice
  // scaling in tall workspaces. Zoom alone is insufficient: the same world
  // view can fill a 350 px strip or a 750 px tall desktop frame. City hit
  // testing still uses its independent 28 CSS-pixel nearest-city resolver.
  const frameScale = Math.max(frame.width / W, frame.height / H)
  const uiScale = (isGlobe ? 1 : scale) * frameScale
  const dotRadius = (c: City) => (2.3 + cityMass(c) / 28) / uiScale
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
  const tripLegFor = (fromId: string, toId: string): TrafficLeg | null =>
    cachedTripLeg(projKey, isGlobe ? globe : null, fromId, toId)
  const flyingFleet = useMemo(() => operatingFleet(player, state.turn), [player, state.turn])
  const flownRoutes = useMemo(() => player.routes.filter((r) => effectiveFrequency(player, r, state.turn) > 0), [player, state.turn])
  const network = useMemo(() => networkCities(player), [player])
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
    if (a.routeId === null && !a.reserve && !isGrounded(a, state.turn)) idleReachKm = Math.max(idleReachKm, getAircraftType(a.type).rangeKm)
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
  const [lens, setLens] = useState<MapLens>('none')
  // The airport holding the map's single tab stop (roving tabindex); null
  // until the keyboard first moves, when the selection or the HQ holds it.
  const [focusCity, setFocusCity] = useState<string | null>(null)
  const moveFocus = useRef<string | null>(null)
  const lensClass = (r: Route): string => {
    if (lens === 'season') {
      // The calendar's lean on this pair right now (tourism seasonality).
      const bp = Math.floor((seasonalBp(r.from, state.turn) * seasonalBp(r.to, state.turn)) / 10000)
      return bp > 10100 ? ' lens-good' : bp < 9900 ? ' lens-bad' : ''
    }
    if (lens === 'none' || lens === 'demand' || r.lastCapacity === 0) return ''
    if (lens === 'load') {
      return r.lastLoadFactorBp >= 8000 ? ' lens-good' : r.lastLoadFactorBp >= 5500 ? ' lens-mid' : ' lens-bad'
    }
    const marginBp = r.lastRevenue > 0 ? Math.floor(((r.lastRevenue - r.lastCost) * 10000) / r.lastRevenue) : -1
    return marginBp >= 1500 ? ' lens-good' : marginBp >= 0 ? ' lens-mid' : ' lens-bad'
  }
  // Every pair any rival serves — player arcs on these run contested-hot.
  const rivalPairs = new Set(
    state.airlines.filter((a) => a.id !== viewSeat()).flatMap((a) => a.routes.map((r) => pairKey(r.from, r.to))),
  )

  // Set when a drag/pinch gesture ends so the click that follows it is
  // swallowed instead of selecting whatever the pointer happened to be over.
  const suppressClick = useRef(false)

  // Layer memoization: the arc and traffic layers are the map's node-count
  // heavyweights, and none of them depend on the flat viewBox — so they
  // rebuild only when the data or the projection moves, not on every frame
  // of a zoom ease or an unrelated interaction (selection, planning mode).
  // Decorative glyph sizes quantize to quarter steps for the same reason.
  const pulseUi = newRouteIds.size > 0 ? uiScale : 1

  // The quarter's result, on the map. A turn that advanced by one is noted
  // while rendering; the flash waits until the report (or any other modal)
  // has closed and the map is on screen, then holds for a few seconds.
  const [seenTurn, setSeenTurn] = useState(state.turn)
  const [pendingResult, setPendingResult] = useState<number | null>(null)
  const [shownResult, setShownResult] = useState<number | null>(null)
  if (state.turn !== seenTurn) {
    setSeenTurn(state.turn)
    setPendingResult(announceQuarter && state.turn === seenTurn + 1 ? state.turn : null)
    setShownResult(null)
  }
  useEffect(() => {
    if (pendingResult === null) return
    let timer = 0
    const poll = (): void => {
      if (active && !document.hidden && document.querySelector('dialog[open]') === null) {
        setPendingResult(null)
        setShownResult(pendingResult)
        return
      }
      timer = window.setTimeout(poll, 250)
    }
    timer = window.setTimeout(poll, 250)
    return () => clearTimeout(timer)
  }, [pendingResult, active])
  useEffect(() => {
    if (shownResult === null) return
    const timer = window.setTimeout(() => setShownResult(null), QUARTER_RESULT_MS)
    return () => clearTimeout(timer)
  }, [shownResult])
  const quarterResult = useMemo(
    () => (shownResult === null ? null : quarterTrends(player.routes, shownResult)),
    [shownResult, player],
  )
  const rivalArcsLayer = useMemo(() => {
    if (!showRivals) return null
    return state.airlines.filter((a) => a.id !== viewSeat()).map((airline) =>
      airline.routes.map((r) => {
        const d = routePathFor(r.from, r.to)
        if (d === '') return null
        return (
          <path
            key={`${airline.id}-${r.id}`}
            d={d}
            className={`route-rival ${rivalColorClass(airline.id)}`}
            style={{ '--cap-w': capWidth(airline, r, true, state.turn) } as React.CSSProperties}
          />
        )
      }),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, seat, showRivals, isGlobe, globe, projKey])

  // Demand lens: the richest markets nobody is flying from the player's own
  // network — the map as a spatial puzzle, not a list. Faint arcs, thicker
  // where more weekly demand goes unmet by everyone's seats combined.
  const opportunities = useMemo(() => {
    if (lens !== 'demand') return []
    const anchors = [...new Set([...networkCities(player), ...slotCities(player)])].sort()
    const served = new Set(player.routes.map((r) => pairKey(r.from, r.to)))
    const seen = new Set<string>()
    const out: { from: string; to: string; demand: number; score: number }[] = []
    for (const a of anchors) {
      for (const c of CITIES) {
        if (c.id === a) continue
        const key = pairKey(a, c.id)
        if (served.has(key) || seen.has(key)) continue
        seen.add(key)
        if (distanceKm(a, c.id) < MIN_ROUTE_KM) continue
        const demand = pairWeeklyDemand(state, a, c.id)
        const score = demand - pairWeeklySeats(state, a, c.id)
        if (score <= 0) continue
        out.push({ from: a < c.id ? a : c.id, to: a < c.id ? c.id : a, demand, score })
      }
    }
    return out.sort((x, y) => y.score - x.score || `${x.from}-${x.to}`.localeCompare(`${y.from}-${y.to}`)).slice(0, 12)
  }, [state, player, lens])
  const opportunityArcsLayer = useMemo(() => {
    if (opportunities.length === 0) return null
    const top = opportunities[0]!.score
    return opportunities.map((o) => {
      const d = routePathFor(o.from, o.to)
      if (d === '') return null
      return (
        <path
          key={`opp-${o.from}-${o.to}`}
          d={d}
          className="route-opportunity"
          data-testid={`opportunity-${o.from}-${o.to}`}
          style={{ '--cap-w': 0.7 + (2.6 * o.score) / Math.max(1, top) } as React.CSSProperties}
        >
          <title>{`${o.from}–${o.to}: ${o.demand.toLocaleString('en-US')} pax/wk demand, ${o.score.toLocaleString('en-US')} unmet`}</title>
        </path>
      )
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opportunities, isGlobe, globe, projKey])

  // Announced raids on the viewer's own markets: the threat drawn on the
  // pair itself, in the raider's color, before its first flight.
  const threatArcsLayer = useMemo(() => {
    const seatId = viewSeat()
    return state.airlines
      .filter((a) => a.id !== seatId && !a.bankrupt && a.campaign?.kind === 'raid' && a.campaign.target === seatId && a.campaign.pair && state.turn < a.campaign.untilTurn)
      .map((a) => {
        const [from, to] = a.campaign!.pair!.split('-') as [string, string]
        const d = routePathFor(from, to)
        if (d === '') return null
        return (
          <path key={`threat-${a.id}`} d={d} className={`route-threat ${rivalColorClass(a.id)}`} data-testid={`threat-${from}-${to}`}>
            <title>{`${a.name} has announced a raid on ${from}–${to}`}</title>
          </path>
        )
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, isGlobe, globe, projKey])

  // A selected city pulls its own arcs forward: the rest of the network drops
  // to context so the hub's spokes read at a glance. A selected route or a
  // flow highlight already does its own focusing and takes precedence.
  const cityFocus = selectedRouteId === undefined && !flowRouteIds?.length && selected !== null && player.routes.some((r) => r.from === selected || r.to === selected) ? selected : null
  const playerArcsLayer = useMemo(() => {
    return player.routes.map((r) => {
      const km = distanceKm(r.from, r.to)
      const isNew = newRouteIds.has(r.id)
      const isAcquired = acquiredRouteIds?.has(r.id) ?? false
      const contested = rivalPairs.has(pairKey(r.from, r.to))
      const trend = quarterResult?.byRoute.get(r.id)
      const d = routePathFor(r.from, r.to)
      if (d === '') return null
      return (
        <g key={r.id} className="route-group"
            onClick={(e) => {
              e.stopPropagation() // an arc click must not select a nearby city
              if (suppressClick.current) {
                suppressClick.current = false
                return
              }
              onRouteClick?.(r.id)
            }}
        >
          <path
            d={d}
            pathLength={1}
            data-acquired={isAcquired || undefined}
            className={`route-player ${haulClass(km)}${r.id === selectedRouteId || flowRouteIds?.includes(r.id) ? ' route-selected' : flowRouteIds?.length ? ' route-context' : cityFocus !== null && r.from !== cityFocus && r.to !== cityFocus ? ' route-context' : ''}${isNew ? ' route-new' : ''}${isAcquired ? ' route-acquired' : ''}${contested ? ' route-contested' : ''}${lensClass(r)}${trend === 'up' ? ' route-result-up' : trend === 'down' ? ' route-result-down' : ''}`}
            style={
              {
                '--cap-w': capWidth(player, r, false, state.turn),
                // Two more facts ride the same line: how full it flies (opacity
                // — a limp route is literally faint) and whether it earns (a
                // losing arc goes red). Width was already seats/wk, so an arc
                // now says size, fullness and health at once.
                '--load-o': (0.34 + (0.62 * r.lastLoadFactorBp) / 10000).toFixed(3),
              } as React.CSSProperties
            }
            data-losing={r.lastCapacity > 0 && r.lastRevenue < r.lastCost ? '' : undefined}
            data-testid={isNew ? 'route-line-new' : undefined}

          />
          <path d={d} className="route-hit" data-testid={`route-hit-${r.id}`} aria-hidden="true" />
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
  }, [state, seat, isGlobe, globe, projKey, newRouteIds, acquiredRouteIds, lens, pulseUi, onRouteClick, selectedRouteId, flowRouteIds, cityFocus, quarterResult])

  // Constant traffic: planes shuttle back and forth on every served route —
  // more of them the busier the schedule, and long-haul takes visibly longer
  // than a hop. Rival traffic is one small plane per rival route (capped) in
  // the rival's own color. All of it is drawn by the traffic canvas; this
  // memo only describes what flies where, and the whole set is empty while
  // motion is reduced or the globe is turning (its projection changes every
  // frame, and traffic that lags the terrain reads as a glitch).
  const traffic = useMemo((): { planes: TrafficPlane[]; rivalCount: number } => {
    if (reduceMotion || (isGlobe && rotating)) return { planes: [], rivalCount: 0 }
    const planes: TrafficPlane[] = []
    let remaining = display.traffic === 'low' ? 8 : 24
    for (const r of flownRoutes) {
      const km = distanceKm(r.from, r.to)
      const freq = effectiveFrequency(player, r, state.turn)
      const count = Math.min(remaining, Math.max(1, Math.min(4, Math.round(freq / 8))))
      if (!count) continue
      const leg = tripLegFor(r.from, r.to)
      if (leg === null) continue // route crosses the horizon — no shuttle
      remaining -= count
      // The glyph wears the metal: widebodies render visibly larger than
      // regional jets, and fast airframes visibly outrun the fleet
      // (Concorde zips). Biggest/fastest airframe assigned to the route.
      let biggestSeats = 0
      let fastestKmh = 0
      let aircraftType = 'caravelle'
      for (const ac of flyingFleet) {
        if (ac.routeId !== r.id && ac.secondaryRouteId !== r.id) continue
        const t = getAircraftType(ac.type)
        if (t.seats > biggestSeats) aircraftType = ac.type
        biggestSeats = Math.max(biggestSeats, t.seats)
        fastestKmh = Math.max(fastestKmh, t.speedKmh)
      }
      const size = 0.62 + Math.min(0.5, biggestSeats / 800)
      const dur = (4 + Math.min(14, km / 900)) * (850 / Math.max(1, fastestKmh))
      const glyph = aircraftGlyph(aircraftType)
      for (let i = 0; i < count; i++) {
        planes.push({
          leg,
          dur,
          phase: ((r.id * 13) % 60) / 10 + (i * dur) / count,
          glyph,
          size,
          fill: '#cfe3ff',
          stroke: '#0b2332',
          alpha: 1,
        })
      }
    }
    let rivalCount = 0
    if (showRivals) {
      const rivalRoutes = state.airlines
        .filter((a) => a.id !== seat)
        .flatMap((airline) => airline.routes.map((r) => ({ airline, r })))
        .slice(0, display.traffic === 'low' ? 4 : 12)
      for (const { airline, r } of rivalRoutes) {
        const leg = tripLegFor(r.from, r.to)
        if (leg === null) continue
        const km = distanceKm(r.from, r.to)
        planes.push({
          leg,
          dur: 5 + Math.min(15, km / 900),
          phase: ((r.id * 17 + airline.id * 7) % 70) / 10,
          glyph: PLANE_GLYPH,
          size: 0.55,
          fill: rivalColor(airline.id),
          stroke: '#0b2332',
          alpha: 0.7,
        })
        rivalCount++
      }
    }
    return { planes, rivalCount }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, seat, showRivals, isGlobe, globe, projKey, reduceMotion, display.traffic, rotating])
  // Ambient motion beyond the planes, on the same canvas: a sweep around each
  // airport the player is negotiating with, breathing halos on cities under a
  // world event, and dashes marching along a pair a rival has announced a
  // raid on. Each has a static SVG twin (what reduced motion shows, and what
  // tests look for); a CSS animation on those twins would re-lay-out the SVG
  // every frame, which is exactly the cost this canvas exists to remove.
  // World events on the map: one labeled halo per region-wide event at world
  // zoom, rings on individual cities once they are separate places.
  const haloZoom = scale >= REGION_COLLAPSE_BELOW_SCALE ? REGION_COLLAPSE_BELOW_SCALE : 1
  const halos = useMemo(() => eventHalos(state.world.events, haloZoom), [state.world.events, haloZoom])
  const effects = useMemo((): TrafficEffect[] => {
    if (reduceMotion || (isGlobe && rotating)) return []
    const out: TrafficEffect[] = []
    for (const req of player.slotRequests) {
      const c = getCity(req.city)
      const p = pt(c.lon, c.lat)
      if (!p.vis) continue
      out.push({ kind: 'sweep', x: p.X, y: p.Y, r: dotRadius(c) + 4 / uiScale, width: 1.6, color: '#ffd166', period: 6 })
    }
    // Event halos breathe softly — context, never louder than the airports.
    for (const h of halos.cities) {
      const p = pt(h.city.lon, h.city.lat)
      if (!p.vis) continue
      out.push({ kind: 'breathe', x: p.X, y: p.Y, r: 12 / uiScale, width: 1.2, color: h.good ? '#ffd166' : '#e06c6c', period: 2.6, alpha: 0.5 })
    }
    for (const a of state.airlines) {
      if (a.id === seat || a.bankrupt || a.campaign?.kind !== 'raid' || a.campaign.target !== seat || !a.campaign.pair || state.turn >= a.campaign.untilTurn) continue
      const [from, to] = a.campaign.pair.split('-') as [string, string]
      const leg = tripLegFor(from, to)
      if (leg === null) continue
      out.push({ kind: 'march', leg, width: 2.4, color: rivalColor(a.id) })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, seat, isGlobe, globe, projKey, uiScale, reduceMotion, rotating, halos])
  // What the canvas draws through, read per frame: the viewBox React has
  // written plus whatever transform the last gesture or ease left on the
  // layer. A ref, so the animation loop never closes over a stale render.
  const cameraRef = useRef<() => TrafficCamera>(() => ({ vb: FULL_VIEW, fw: W, fh: H, tx: 0, ty: 0, s: 1 }))
  useLayoutEffect(() => {
    cameraRef.current = () => ({
      vb: isGlobe ? FULL_VIEW : baseRef.current,
      fw: frame.width,
      fh: frame.height,
      tx: layerXf.current.tx,
      ty: layerXf.current.ty,
      s: layerXf.current.s,
    })
  })
  const trafficCamera = useCallback(() => cameraRef.current(), [])
  const trafficFrozen = useCallback(() => movingRef.current, [])

  // Visibility only changes when the game state, selection, an LOD threshold
  // crossing, or the visible window changes — not on every animation frame of
  // a zoom, and not while a gesture is moving the layer (which does not touch
  // `view` at all).
  const lodKey = (scale >= 1.8 ? 2 : 0) | (scale >= 1.5 ? 1 : 0)
  const globeLand = useMemo(
    () =>
      isGlobe
        ? globeLandPath(globe, globe.s >= 1.8 && !rotating ? globeGeometry!.WORLD_RINGS_FINE : globeGeometry!.WORLD_RINGS)
        : '',
    [isGlobe, globe, rotating, globeGeometry],
  )

  // Culling follows the ANCHOR — the window the layer is actually painted
  // around — not the logical view. A pan commit moves only the view; if it
  // moved the cull too, the city set would change and invalidate the raster
  // the pan-commit path exists to keep.
  const cull = anchor
  // The globe re-projects rather than panning, so it needs no overhang.
  const span = isGlobe ? SPAN_MIN : layerSpan(anchor, frameAspect)
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
    // The keyboard's current airport must never be culled out from under it.
    if (focusCity !== null) stakes.add(focusCity)
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
    const pad = (layerSpan(cull, frameAspect) - 1) / 2 + 0.1
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
  }, [state, seat, selected, focusCity, lodKey, isGlobe, cull.x, cull.y, cull.w, cull.h, frameAspect])

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
  // phone the markers stay compact — the generous reach keeps the game's
  // primary verb comfortable without covering the network in large dots. Precise dot/arc clicks stopPropagation
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

  // Airports actually drawn, and where — projected once per render and shared
  // by the markers, the roving tab stop and the arrow keys.
  const sites: { id: string; x: number; y: number }[] = []
  for (const c of visible) {
    const p = pt(c.lon, c.lat)
    if (p.vis) sites.push({ id: c.id, x: p.X, y: p.Y })
  }
  const sitePos = new Map(sites.map((st) => [st.id, st]))
  const preferredStop = focusCity ?? selected ?? player.hq
  const tabStop = sitePos.has(preferredStop) ? preferredStop : (sites[0]?.id ?? null)

  // Keyboard: arrows hop between airports (Shift+arrows, or an arrow with no
  // airport that way, pans), + and − zoom, Enter or Space opens the airport.
  const panStep = (dir: 'left' | 'right' | 'up' | 'down'): void => {
    const sx = dir === 'right' ? 1 : dir === 'left' ? -1 : 0
    const sy = dir === 'down' ? 1 : dir === 'up' ? -1 : 0
    if (isGlobe) {
      const g = globeTarget.current
      const d = 12 / g.s
      applyGlobe({ ...g, cLon: g.cLon + sx * d, cLat: g.cLat - sy * d }, false)
      return
    }
    const t = targetRef.current
    const vis = visibleRect(t, aspectNow())
    applyView({ ...t, x: t.x + sx * vis.w * 0.2, y: t.y + sy * vis.h * 0.2 }, false)
  }
  const zoomStep = (factor: number): void => {
    if (isGlobe) applyGlobe({ ...globeTarget.current, s: globeTarget.current.s * factor }, false)
    else zoomAt(null, null, factor)
  }
  const onMapKeyDown = (e: ReactKeyboardEvent<SVGSVGElement>): void => {
    if (e.altKey || e.ctrlKey || e.metaKey) return
    const cityId = (e.target as Element).getAttribute('data-city')
    const dir = ARROW_DIRECTIONS[e.key]
    if (dir !== undefined) {
      e.preventDefault()
      const from = cityId !== null ? sitePos.get(cityId) : undefined
      const next = !e.shiftKey && from !== undefined ? nearestInDirection(from, sites.filter((st) => st.id !== cityId), dir) : null
      if (next !== null) {
        moveFocus.current = next
        setFocusCity(next)
      } else panStep(dir)
    } else if (e.key === '+' || e.key === '=') {
      e.preventDefault()
      zoomStep(1.5)
    } else if (e.key === '-' || e.key === '_') {
      e.preventDefault()
      zoomStep(1 / 1.5)
    } else if ((e.key === 'Enter' || e.key === ' ') && cityId !== null) {
      e.preventDefault()
      onCityClick(cityId)
    }
  }

  // After an arrow key moves the tab stop: focus the new airport, and bring
  // it into view if it sits near or past the frame's edge.
  useLayoutEffect(() => {
    const id = moveFocus.current
    if (id === null) return
    moveFocus.current = null
    svgRef.current?.querySelector<SVGGElement>(`[data-city="${id}"]`)?.focus({ preventScroll: true })
    const c = getCity(id)
    if (isGlobe) {
      const p = globeProjectFull(globe, c.lon, c.lat)
      if (p.cosc < 0.35) applyGlobe({ ...globeTarget.current, cLon: c.lon, cLat: c.lat }, false)
      return
    }
    const t = targetRef.current
    const vis = visibleRect(t, aspectNow())
    const px = x(c.lon)
    const py = y(c.lat)
    const mx = vis.w * 0.08
    const my = vis.h * 0.1
    if (px < vis.x + mx || px > vis.x + vis.w - mx || py < vis.y + my || py > vis.y + vis.h - my) {
      applyView({ ...t, x: px - t.w / 2, y: py - t.h / 2 }, false)
    }
  })

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
      // Focusing an airport that sits in the layer's overhang would scroll
      // this clipped box to reveal it, knocking the layer off its transform.
      // The keyboard path pans the map itself; the box never scrolls.
      onScroll={(e) => {
        const el = e.currentTarget
        if (el.scrollLeft !== 0 || el.scrollTop !== 0) {
          el.scrollLeft = 0
          el.scrollTop = 0
        }
      }}
    >
      <p id="map-keys-hint" className="map-sr-only">
        Arrow keys move between airports, Shift and an arrow pans the map, plus and minus zoom, Enter opens the airport.
      </p>
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
        role="application"
        aria-label="World route map"
        aria-describedby="map-keys-hint"
        data-testid="map"
        onKeyDown={onMapKeyDown}
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
          <linearGradient id="landRelief" x1="0" y1="0" x2="0.25" y2="1">
            <stop offset="0" className="land-stop-light" />
            <stop offset="1" className="land-stop-base" />
          </linearGradient>
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
          <rect x={-W} y={-H} width={W * 3} height={H * 3} className="map-sea map-ocean" />
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
                <radialGradient id="globeLighting" cx="32%" cy="25%" r="78%">
                  <stop offset="0" stopColor="#d9f3ef" stopOpacity=".12" />
                  <stop offset=".5" stopColor="#06121e" stopOpacity="0" />
                  <stop offset="1" stopColor="#030b15" stopOpacity=".65" />
                </radialGradient>
                {/* Atmosphere: a thin band of scattered blue that peaks just
                    outside the limb and fades both ways — a faint rim-light
                    on the terrain's edge and a soft halo into space. The
                    gradient is relative to the halo circle (1.12R), so the
                    limb sits at 1/1.12 ≈ 0.893 of it. */}
                <radialGradient id="globeAtmosphere" cx="50%" cy="50%" r="50%">
                  <stop offset=".80" stopColor="#8fc4ff" stopOpacity="0" />
                  <stop offset=".875" stopColor="#8fc4ff" stopOpacity=".14" />
                  <stop offset=".895" stopColor="#b9dcff" stopOpacity=".42" />
                  <stop offset=".93" stopColor="#6aa8f0" stopOpacity=".16" />
                  <stop offset="1" stopColor="#4a86d8" stopOpacity="0" />
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
                <path d={globeLinesPath(globe, globeGeometry!.BORDER_LINES)} className="map-border" />
              )}
              {globeGeometry!.ISLET_POINTS.map(([lon, lat]) => {
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
              <circle cx={W / 2} cy={H / 2} r={GLOBE_R * globe.s} fill="url(#globeLighting)" pointerEvents="none" />
              <circle cx={W / 2} cy={H / 2} r={GLOBE_R * globe.s * 1.12} fill="url(#globeAtmosphere)" className="globe-atmosphere" data-testid="globe-atmosphere" pointerEvents="none" />
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
              <path d={uiScale >= 1.8 ? WORLD_PATH_FINE : WORLD_PATH} className="map-coast-glow" />
              {/* Detail that resolves: the coarse coastline is a smear at 3x,
                  and the fine one is wasted bytes of curve at world view. The
                  swap happens at a committed render, once per threshold
                  crossing — never mid-gesture. */}
              <path d={uiScale >= 1.8 ? WORLD_PATH_FINE : WORLD_PATH} className="map-land" />
              {/* Country borders come from a separate mesh, so they are the
                  borders themselves and never a second copy of the coast. */}
              {uiScale >= 1.35 && <path d={BORDERS_PATH} className="map-border" />}
              {/* Islands with an airport but too small to survive 1:50m
                  generalisation — without these, Guam is an airport in open
                  ocean. */}
              <path d={ISLETS_PATH} className="map-land map-islet" />
            </>
          )}
          {/* Geographic labels sit below the operating network, never in its hit layer. */}
          {[
            { name: 'NORTH ATLANTIC', lon: -40, lat: 28 },
            { name: 'SOUTH ATLANTIC', lon: -20, lat: -28 },
            { name: 'INDIAN OCEAN', lon: 77, lat: -24 },
            { name: 'NORTH PACIFIC', lon: -151, lat: 27 },
            { name: 'SOUTH PACIFIC', lon: -132, lat: -25 },
          ].map((ocean) => {
            const p = pt(ocean.lon, ocean.lat)
            return p.vis && <text key={ocean.name} x={p.X} y={p.Y} textAnchor="middle" fontSize={10 / uiScale}
              className="map-ocean-label" style={{ letterSpacing: 2 / uiScale }}>{ocean.name}</text>
          })}
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
          {opportunityArcsLayer}
          {playerArcsLayer}
          {threatArcsLayer}
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
          {halos.regions.map((h) => {
            const shape = regionHaloShape(
              h.core.map((c) => pt(c.lon, c.lat)).filter((p) => p.vis),
              14 / uiScale,
            )
            if (shape === null) return null
            return (
              <g key={h.key} className={h.good ? 'event-region halo-boom' : 'event-region halo-bust'} data-testid={`event-region-${h.region}`}>
                <ellipse cx={shape.cx} cy={shape.cy} rx={shape.rx} ry={shape.ry} className="event-region-halo" />
                <text x={shape.cx} y={shape.cy - shape.ry - 4 / uiScale} fontSize={10 / uiScale} textAnchor="middle" className="event-region-label">
                  {h.name}
                </text>
              </g>
            )
          })}
          {halos.cities.map((h) => {
            const p = pt(h.city.lon, h.city.lat)
            if (!p.vis) return null
            return (
              <circle
                key={h.key}
                cx={p.X}
                cy={p.Y}
                r={12 / uiScale}
                className={h.good ? 'event-halo halo-boom' : 'event-halo halo-bust'}
                data-testid={`event-halo-${h.city.id}`}
              />
            )
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
            const site = sitePos.get(c.id)
            if (site === undefined) return null
            const p = { X: site.x, Y: site.y }
            const r = dotRadius(c)
            const load = pressure(c.id)
            const served = player.routes.some((rt) => rt.from === c.id || rt.to === c.id)
            const status =
              c.id === player.hq
                ? 'your headquarters'
                : served
                  ? 'served by you'
                  : held > 0
                    ? 'your slots, not yet served'
                    : 'not served by you'
            return (
              <g
                key={c.id}
                onClick={(e) => {
                  e.stopPropagation() // precise hit — don't also run the nearest-city resolver
                  handleCityClick(c.id, e.detail)
                }}
                onFocus={() => {
                  if (focusCity !== c.id) setFocusCity(c.id)
                }}
                className="city"
                role="button"
                tabIndex={c.id === tabStop ? 0 : -1}
                data-city={c.id}
                aria-label={`${c.name} (${c.id}), ${status}${isTarget ? ', a route can open here' : ''}${load >= 1 ? ', airport full' : ''}`}
                aria-pressed={selected === c.id}
              >
                {selected === c.id && (
                  <circle cx={p.X} cy={p.Y} r={r + 5 / uiScale} className="selection-ring" />
                )}
                {/* The keyboard's focus ring, drawn only on the one tab stop
                    and shown only while it holds keyboard focus. */}
                {c.id === tabStop && <circle cx={p.X} cy={p.Y} r={r + 7 / uiScale} className="city-focus-ring" />}
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
                {state.airlines.some((a) => a.id !== viewSeat() && !a.bankrupt && a.slotInterest === c.id) && (
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
                    fontSize={11 / uiScale}
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
                    (load >= 1 ? ' full' : load >= 0.75 ? ' tight' : '')
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
            const fs = 11 / uiScale
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
                r: dotRadius(c),
                w: c.id.length * fs * 0.66,
                // A major, the HQ or the selected city is always named, even
                // shingled; anything else yields when a cluster of network
                // cities (JFK/PHL/DCA at world view) leaves it no room.
                optional: cityTier(c) !== 1 && c.id !== player.hq && c.id !== selected,
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
      {/* Traffic floats over the layer in its own frame-sized canvas: it
          re-projects through the layer's transform each frame instead of
          living inside the SVG, where every moving node re-rastered the
          composited map. Sits under the vignette and the controls. */}
      <TrafficCanvas
        planes={traffic.planes}
        effects={effects}
        rivalCount={traffic.rivalCount}
        frame={frame}
        active={active}
        camera={trafficCamera}
        frozen={trafficFrozen}
      />
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
          title="zoom in"
          onClick={() =>
            isGlobe
              ? applyGlobe({ ...globeTarget.current, s: globeTarget.current.s * 1.5 }, false)
              : zoomAt(null, null, 1.5)
          }
        >
          <Icon name="zoomIn" />
        </button>
        <button
          data-testid="zoom-out"
          aria-label="zoom out"
          title="zoom out"
          onClick={() =>
            isGlobe
              ? applyGlobe({ ...globeTarget.current, s: globeTarget.current.s / 1.5 }, false)
              : zoomAt(null, null, 1 / 1.5)
          }
        >
          <Icon name="zoomOut" />
        </button>
        <button
          data-testid="zoom-reset"
          aria-label="reset zoom"
          title="reset the view"
          onClick={() => (isGlobe ? applyGlobe(GLOBE_HOME, false) : applyView(homeView(), false))}
        >
          <Icon name="reset" />
        </button>
        <button
          data-testid="map-projection"
          aria-label={projection === 'globe' ? 'switch to flat map' : 'switch to globe'}
          aria-busy={globeLoading}
          title={isGlobe ? 'switch to flat map' : 'switch to globe'}
          className={isGlobe ? 'active' : ''}
          onClick={() => {
            const next = projection === 'globe' ? 'flat' : 'globe'
            setProjection(next)
            try { localStorage.setItem('loadfactor:projection', next) } catch { /* session preference */ }
          }}
        >
          <Icon name="globe" />
        </button>
        <button
          data-testid="toggle-rivals"
          aria-label={showRivals ? 'hide rival networks' : 'show rival networks'}
          title={showRivals ? 'hide rival networks' : 'show rival networks'}
          className={showRivals ? 'active' : ''}
          onClick={() => setShowRivals((v) => !v)}
        >
          <Icon name="rivals" />
        </button>

      </div>
      {quarterResult !== null && quarterResult.up + quarterResult.down > 0 && (
        <div className="map-quarter-result" role="status" data-testid="map-quarter-result">
          Last quarter{' '}
          {quarterResult.up > 0 && <span className="pos">▲ {quarterResult.up} {quarterResult.up === 1 ? 'route' : 'routes'} earned more</span>}
          {quarterResult.up > 0 && quarterResult.down > 0 && ' · '}
          {quarterResult.down > 0 && <span className="neg">▼ {quarterResult.down} earned less</span>}
        </div>
      )}
      {globeLoading && <div className="map-load-status" role="status">Loading globe…</div>}
      {projection === 'globe' && globeError && <div className="map-load-status" role="status">
        Globe unavailable. <button onClick={() => { setGlobeError(false); setGlobeRetry((n) => n + 1) }}>Try again</button>
      </div>}
      <div className="map-data-control">
        <label>Map colors <select aria-label="map colors" value={lens} onChange={(e) => setLens(e.target.value as typeof lens)}>
          <option value="none">Ownership</option><option value="load">Load factor</option><option value="profit">Route margin</option><option value="season">Season</option><option value="demand">Unserved demand</option>
        </select></label>
        <MapLegend
          lens={lens}
          opportunities={opportunities.length}
          owners={state.airlines
            .filter((a) => !a.bankrupt && (a.id === seat || (showRivals && a.routes.length > 0)))
            .map((a) => ({ id: a.id, name: a.name, color: rivalColor(a.id), you: a.id === seat }))}
          events={halos.legend}
        />
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
          {/* The marker outlines what the frame SHOWS — the viewBox minus
              what `slice` crops — so it never claims the cropped edges. */}
          {(() => {
            const vis = visibleRect(view, frameAspect)
            return (
              <div
                ref={minimapRef}
                className="minimap-viewport"
                data-testid="minimap-viewport"
                style={{
                  width: `${(vis.w / W) * 100}%`,
                  height: `${(vis.h / H) * 100}%`,
                  transform: `translate3d(${(vis.x / vis.w) * 100}%, ${(vis.y / vis.h) * 100}%, 0)`,
                }}
              />
            )
          })()}
        </div>
      )}
    </div>
  )
}
