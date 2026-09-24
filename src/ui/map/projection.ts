// The flat map's projection and the route geometry drawn on it: where a city
// sits, how an arc between two cities lifts, the path caches the layers
// share, and where "home" is for the airline in the viewer's seat.
// Presentation-only floats — the engine never sees screen coordinates.

import { getCity } from '../../data/cities'
import { MAP_H, MAP_W, projectLat, projectLon } from '../../data/worldmap.gen'
import type { Airline, GameState, Route } from '../../engine'
import { networkCities, routeWeeklyCapacity, slotCities } from '../../engine/queries'
import { viewSeat } from '../session'
import { quadraticLeg, type TrafficLeg } from '../traffic'
import { HOME_SCALE_COMPACT, HOME_SCALE_DESKTOP, homeViewFor, type Insets, type ViewBox } from './camera'
import { globeRoutePath, globeTripLeg, type GlobeView } from './globe'

// Arc weight tells capacity: seats/wk drive stroke width, so the map itself
// shows where an airline's hardware is concentrated. Fed to CSS as a custom
// property so hover/transition rules still win.
export function capWidth(airline: Airline, route: Route, thin: boolean, turn: number): number {
  const cap = routeWeeklyCapacity(airline, route, turn)
  const w = (thin ? 0.6 : 0.7) + Math.sqrt(cap) / (thin ? 90 : 40)
  return Math.min(thin ? 1.6 : 4, Math.max(thin ? 0.7 : 0.9, w))
}

export function slotsUsedAt(routes: readonly Route[], city: string): number {
  let used = 0
  for (const r of routes) if (r.from === city || r.to === city) used++
  return used
}

// The projection comes FROM the generated geometry (tools/gen-worldmap.mjs),
// not a copy of it: cities and coastlines are placed by the same functions, so
// an airport can never drift off its own continent.
export const W = MAP_W
export const H = MAP_H

export const x = projectLon
export const y = projectLat

// Top-view airliner silhouette, nose on the +x axis — the traffic canvas
// rotates it to the direction of travel, so this glyph always flies
// nose-first.
export const PLANE_GLYPH =
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

export function graticulePath(): string {
  return GRATICULE_PATH
}

// Home for the airline in the viewer's seat: its HQ, served cities and
// footholds, framed by homeViewFor for this frame. A phone opens on the home
// region, a desktop on nearly the whole world centred on the network.
export function networkHome(state: GameState, frame: { width: number; height: number }, insets: Insets): ViewBox {
  const me = state.airlines[viewSeat()]!
  const ids = [...new Set([me.hq, ...networkCities(me), ...slotCities(me)])].sort()
  const points = ids.map((id) => {
    const c = getCity(id)
    return { x: x(c.lon), y: y(c.lat) }
  })
  const compact = typeof window !== 'undefined' && window.innerWidth <= 1100
  return homeViewFor({ points, frame, insets, maxScale: compact ? HOME_SCALE_COMPACT : HOME_SCALE_DESKTOP })
}

// Short hops, medium stages, and long-haul trunks each get their own line
// language (width/dash), on top of the arc lift that grows with distance.
export function haulClass(km: number): string {
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

export function cachedRoutePath(projKey: string, globe: GlobeView | null, fromId: string, toId: string): string {
  flushOnProjChange(projKey)
  const k = `${fromId}|${toId}`
  let d = routePathCache.get(k)
  if (d === undefined) {
    d = globe !== null ? globeRoutePath(globe, fromId, toId) : arcPath(fromId, toId)
    routePathCache.set(k, d)
  }
  return d
}

export function cachedTripLeg(projKey: string, globe: GlobeView | null, fromId: string, toId: string): TrafficLeg | null {
  flushOnProjChange(projKey)
  const k = `${fromId}|${toId}`
  let leg = tripLegCache.get(k)
  if (leg === undefined) {
    leg = globe !== null ? globeTripLeg(globe, fromId, toId) : flatTripLeg(fromId, toId)
    tripLegCache.set(k, leg)
  }
  return leg
}
