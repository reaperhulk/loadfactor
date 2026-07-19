// SVG world map: real landmass under an equirectangular projection, cities as
// dots with zoom-dependent level of detail, routes as lifted arcs whose look
// tells you short-haul from long-haul at a glance. Presentation-only floats
// are fine here — the engine never sees screen coordinates.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import { getAircraftType } from '../data/aircraft'
import { CITIES, distanceKm, getCity, pairKey, type City } from '../data/cities'
import { getEventDef } from '../data/events'
import { WORLD_PATH, WORLD_RINGS } from '../data/worldmap.gen'
import type { GameState, Route } from '../engine'
import { effectiveFrequency, networkCities, routeWeeklyCapacity, slotsHeld, yearOf } from '../engine/queries'
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

const W = 960
const H = 420

function x(lon: number): number {
  return ((lon + 180) / 360) * W
}

function y(lat: number): number {
  return ((90 - lat) / 180) * ((H * 175) / 180) // clip Antarctica, keep aspect
}

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

// Short hops, medium stages, and long-haul trunks each get their own line
// language (width/dash), on top of the arc lift that grows with distance.
function haulClass(km: number): string {
  return km >= 4500 ? 'route-long' : km >= 1500 ? 'route-medium' : 'route-short'
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
const GLOBE_R = 195 // disc radius at s = 1, sized for the 960×420 viewport

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
function globeLandPath(g: GlobeView): string {
  const R = GLOBE_R * g.s
  const cx = W / 2
  const cy = H / 2
  const parts: string[] = []
  for (const ring of WORLD_RINGS) {
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
}

export function MapView({
  state,
  selected,
  routeFrom,
  onCityClick,
  onRouteClick,
  newRouteIds,
  newSlotCities,
}: MapViewProps) {
  const [view, setView] = useState<ViewBox>(FULL_VIEW)
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<{ px: number; py: number; moved: boolean } | null>(null)
  // Zoom eases toward targetRef via exponential smoothing in a rAF loop;
  // panning writes through immediately. Wheel/button handlers mutate the
  // TARGET, so rapid inputs compound smoothly instead of stacking jumps.
  const targetRef = useRef<ViewBox>(FULL_VIEW)
  const rafRef = useRef(0)

  const settleView = (): void => {
    setView((v) => {
      const t = targetRef.current
      const k = 0.25 // smoothing per frame ≈ 130ms to settle at 60fps
      const next = {
        x: v.x + (t.x - v.x) * k,
        y: v.y + (t.y - v.y) * k,
        w: v.w + (t.w - v.w) * k,
        h: v.h + (t.h - v.h) * k,
      }
      const done = Math.abs(next.w - t.w) < 0.5 && Math.abs(next.x - t.x) < 0.5 && Math.abs(next.y - t.y) < 0.5
      if (done) {
        rafRef.current = 0
        return t
      }
      rafRef.current = requestAnimationFrame(settleView)
      return next
    })
  }

  const applyView = (target: ViewBox, immediate: boolean): void => {
    targetRef.current = clampView(target)
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (immediate || reduced) {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = 0
      }
      setView(targetRef.current)
      return
    }
    if (!rafRef.current) rafRef.current = requestAnimationFrame(settleView)
  }

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  // Projection: the flat overview or a rotatable orthographic globe. The
  // choice persists — planning favors the whole-world view, the globe is the
  // honest picture of what long-haul really flies.
  const [projection, setProjection] = useState<'flat' | 'globe'>(() =>
    localStorage.getItem('loadfactor:projection') === 'globe' ? 'globe' : 'flat',
  )
  const isGlobe = projection === 'globe'
  const [globe, setGlobe] = useState<GlobeView>(GLOBE_HOME)
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
  const routePathFor = (fromId: string, toId: string): string =>
    isGlobe ? globeRoutePath(globe, fromId, toId) : arcPath(fromId, toId)
  const tripPathFor = (fromId: string, toId: string): string | null =>
    isGlobe ? globeTripPath(globe, fromId, toId) : roundTripPath(fromId, toId)
  const flownRoutes = player.routes.filter((r) => player.fleet.some((a) => a.routeId === r.id))
  const network = networkCities(player)
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
  const [lens, setLens] = useState<'none' | 'load' | 'profit'>('none')
  const lensClass = (r: Route): string => {
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

  // Visibility only changes when the game state, selection, or an LOD
  // threshold crossing changes — not on every animation frame of a zoom.
  const lodKey = (scale >= 1.8 ? 2 : 0) | (scale >= 1.5 ? 1 : 0)
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
    const vis = CITIES.filter((c) => (lodKey >= 2 ? true : cityTier(c) < 3) || stakes.has(c.id))
    return {
      visible: vis,
      labeled: new Set(vis.filter((c) => cityTier(c) === 1 || lodKey >= 1 || stakes.has(c.id)).map((c) => c.id)),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, selected, lodKey])

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
    if (clientX !== null && clientY !== null && svgRef.current) {
      const rect = svgRef.current.getBoundingClientRect()
      mx = t.x + ((clientX - rect.left) / rect.width) * t.w
      my = t.y + ((clientY - rect.top) / rect.height) * t.h
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
        const rect = svgRef.current?.getBoundingClientRect()
        setGlobe((g) => {
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
          return clampGlobe(next)
        })
      } else zoomAt(e.clientX, e.clientY, factor)
    }
  })
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const handler = (e: globalThis.WheelEvent): void => wheelRef.current(e)
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [])

  // Touch pinch: two active pointers zoom about their midpoint and pan with
  // it, writing through immediately (easing would fight fingers).
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ dist: number; midX: number; midY: number } | null>(null)

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
      e.currentTarget.setPointerCapture(e.pointerId)
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
      if (!now || !svgRef.current) return
      const rect = svgRef.current.getBoundingClientRect()
      if (isGlobe) {
        const ratio = now.dist / pinch.current.dist
        const dmx = now.midX - pinch.current.midX
        const dmy = now.midY - pinch.current.midY
        setGlobe((g) => {
          const deg = 57.3 / (GLOBE_R * g.s * (rect.width / W))
          return clampGlobe({ cLon: g.cLon - dmx * deg, cLat: g.cLat + dmy * deg, s: g.s * ratio })
        })
        pinch.current = now
        return
      }
      // Zoom about the midpoint, then follow the midpoint's travel.
      zoomAt(now.midX, now.midY, now.dist / pinch.current.dist, true)
      const t = targetRef.current
      applyView(
        {
          ...t,
          x: t.x - ((now.midX - pinch.current.midX) / rect.width) * t.w,
          y: t.y - ((now.midY - pinch.current.midY) / rect.height) * t.h,
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
      e.currentTarget.setPointerCapture(e.pointerId)
    }
    drag.current.moved = true
    const rect = svgRef.current!.getBoundingClientRect()
    if (isGlobe) {
      // Trackball: the terrain follows the pointer. Degrees per pixel shrink
      // as the globe grows.
      setGlobe((g) => {
        const deg = 57.3 / (GLOBE_R * g.s * (rect.width / W))
        return clampGlobe({ ...g, cLon: g.cLon - dx * deg, cLat: g.cLat + dy * deg })
      })
    } else {
      const t = targetRef.current
      applyView({ ...t, x: t.x - (dx / rect.width) * t.w, y: t.y - (dy / rect.height) * t.h }, true)
    }
    drag.current.px = e.clientX
    drag.current.py = e.clientY
  }

  const onPointerUp = (e: PointerEvent<SVGSVGElement>): void => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinch.current = null
    // Keep `moved` readable by the click handlers that fire right after.
    const wasDrag = drag.current?.moved ?? false
    drag.current = null
    if (wasDrag) suppressClick.current = true
  }

  const suppressClick = useRef(false)

  const handleCityClick = (cityId: string): void => {
    if (suppressClick.current) {
      suppressClick.current = false
      return
    }
    onCityClick(cityId)
  }

  return (
    <div className="map-wrap">
      <svg
        ref={svgRef}
        viewBox={isGlobe ? `0 0 ${W} ${H}` : `${view.x} ${view.y} ${view.w} ${view.h}`}
        className={`map era-${Math.min(2000, Math.max(1960, Math.floor(yearOf(state) / 10) * 10))}`}
        role="img"
        aria-label="World route map"
        data-testid="map"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <rect x={0} y={0} width={W} height={H} className="map-sea" />
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
            <path d={globeLandPath(globe)} className="map-land" data-testid="globe-land" />
            <circle cx={W / 2} cy={H / 2} r={GLOBE_R * globe.s} className="globe-limb" />
          </>
        ) : (
          <path d={WORLD_PATH} className="map-land" />
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
        {showRivals &&
          state.airlines.slice(1).map((airline) =>
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
          )}
        {player.routes.map((r) => {
          const km = distanceKm(r.from, r.to)
          const isNew = newRouteIds.has(r.id)
          const contested = rivalPairs.has(pairKey(r.from, r.to))
          const d = routePathFor(r.from, r.to)
          if (d === '') return null
          return (
            <g key={r.id}>
              <path
                d={d}
                pathLength={1}
                className={`route-player ${haulClass(km)}${isNew ? ' route-new' : ''}${contested ? ' route-contested' : ''}${lensClass(r)}`}
                style={{ '--cap-w': capWidth(player, r, false) } as React.CSSProperties}
                data-testid={isNew ? 'route-line-new' : undefined}
                onClick={() => {
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
                  return <circle key={cityId} cx={p.X} cy={p.Y} r={10 / uiScale} className="endpoint-pulse" />
                })}
            </g>
          )
        })}
        {/* Constant traffic: planes shuttle back and forth on every served
            route — more of them the busier the schedule, and long-haul takes
            visibly longer than a hop. */}
        {flownRoutes.flatMap((r) => {
          const km = distanceKm(r.from, r.to)
          const freq = effectiveFrequency(player, r)
          const planes = Math.max(1, Math.min(4, Math.round(freq / 8)))
          const dur = 4 + Math.min(14, km / 900)
          const path = tripPathFor(r.from, r.to)
          if (path === null) return [] // route crosses the horizon — no shuttle
          return Array.from({ length: planes }, (_, i) => (
            <g key={`plane-${r.id}-${i}`} className="plane" data-testid={i === 0 ? `plane-${r.id}` : undefined}>
              {/* A silhouette whose nose points along +x: rotate="auto" then
                  keeps it flying nose-first on BOTH legs of the shuttle — the
                  ✈ text glyph points 45° off-axis and read as flying
                  backwards on the return leg. */}
              <path d={PLANE_GLYPH} transform={`scale(${0.8 / uiScale})`} />
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
        })}
        {/* Rival traffic: one small plane per rival route (capped) so their
            networks read as alive, in the rival's own color. */}
        {showRivals &&
          state.airlines
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
                  <path d={PLANE_GLYPH} transform={`scale(${0.55 / uiScale})`} />
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
            })}
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
            const ry = (idleReachKm / 111.32) * (((H * 175) / 180) / 180) // px per lat degree, mirrors y()
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
          const r = (2 + cityMass(c) / 18) / Math.sqrt(uiScale)
          return (
            <g key={c.id} onClick={() => handleCityClick(c.id)} className="city">
              {selected === c.id && (
                <circle cx={p.X} cy={p.Y} r={r + 5 / uiScale} className="selection-ring" />
              )}
              {player.negotiations.some((n) => n.city === c.id) && (
                <circle
                  cx={p.X}
                  cy={p.Y}
                  r={r + 4 / uiScale}
                  className="negotiating-ring"
                  data-testid={`negotiating-${c.id}`}
                />
              )}
              {inNetwork && <circle cx={p.X} cy={p.Y} r={r + 2.5 / uiScale} className="city-network-ring" />}
              <circle
                data-testid={`city-${c.id}`}
                cx={p.X}
                cy={p.Y}
                r={r}
                className={
                  selected === c.id
                    ? 'city-dot selected'
                    : isTarget
                      ? 'city-dot target'
                      : held > 0
                        ? 'city-dot slotted'
                        : 'city-dot'
                }
              />
            </g>
          )
        })}
        {/* Labels draw in their own layer ABOVE every dot, with a halo — a
            neighboring city's dot can never sit on top of a name. */}
        {visible
          .filter((c) => labeled.has(c.id))
          .map((c) => {
            const p = pt(c.lon, c.lat)
            if (!p.vis) return null
            const r = (2 + cityMass(c) / 18) / Math.sqrt(uiScale)
            return (
              <text
                key={`label-${c.id}`}
                x={p.X + r + 3 / uiScale}
                y={p.Y + 3 / uiScale}
                fontSize={9 / uiScale}
                className="city-label"
              >
                {c.id}
              </text>
            )
          })}
      </svg>
      <div className="map-controls">
        <button
          data-testid="zoom-in"
          aria-label="zoom in"
          onClick={() => (isGlobe ? setGlobe((g) => clampGlobe({ ...g, s: g.s * 1.5 })) : zoomAt(null, null, 1.5))}
        >
          +
        </button>
        <button
          data-testid="zoom-out"
          aria-label="zoom out"
          onClick={() =>
            isGlobe ? setGlobe((g) => clampGlobe({ ...g, s: g.s / 1.5 })) : zoomAt(null, null, 1 / 1.5)
          }
        >
          −
        </button>
        <button
          data-testid="zoom-reset"
          aria-label="reset zoom"
          onClick={() => (isGlobe ? setGlobe(GLOBE_HOME) : applyView(FULL_VIEW, false))}
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
          aria-label={`data lens: ${lens === 'none' ? 'off' : lens === 'load' ? 'load factor' : 'profit'} — click to cycle`}
          title={`lens: ${lens === 'none' ? 'off' : lens === 'load' ? 'load factor' : 'P&L'}`}
          className={lens !== 'none' ? 'active' : ''}
          onClick={() => setLens(lens === 'none' ? 'load' : lens === 'load' ? 'profit' : 'none')}
        >
          {lens === 'profit' ? '$' : '◐'}
        </button>
      </div>
    </div>
  )
}
