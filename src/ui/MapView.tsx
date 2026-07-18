// SVG world map: real landmass under an equirectangular projection, cities as
// dots with zoom-dependent level of detail, routes as lifted arcs whose look
// tells you short-haul from long-haul at a glance. Presentation-only floats
// are fine here — the engine never sees screen coordinates.

import { useEffect, useRef, useState } from 'react'
import type { PointerEvent, WheelEvent } from 'react'
import { CITIES, distanceKm, getCity, type City } from '../data/cities'
import { getEventDef } from '../data/events'
import { WORLD_PATH } from '../data/worldmap.gen'
import type { GameState, Route } from '../engine'
import { slotsHeld } from '../engine/queries'

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

// Level of detail: majors always visible, regionals from mid zoom, small
// fields only up close — plus anything the player has a stake in.
export function cityTier(c: City): 1 | 2 | 3 {
  const mass = cityMass(c)
  return mass >= 62 ? 1 : mass >= 45 ? 2 : 3
}

// Majors and regionals are visible from the world view (Aerobiz-style busy
// map); small fields fade in as you zoom.
const TIER_MIN_SCALE: Record<1 | 2 | 3, number> = { 1: 0, 2: 0, 3: 1.8 }

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

// Short hops, medium stages, and long-haul trunks each get their own line
// language (width/dash), on top of the arc lift that grows with distance.
function haulClass(km: number): string {
  return km >= 4500 ? 'route-long' : km >= 1500 ? 'route-medium' : 'route-short'
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
  newRouteIds: ReadonlySet<number>
  newSlotCities: ReadonlySet<string>
}

export function MapView({ state, selected, routeFrom, onCityClick, newRouteIds, newSlotCities }: MapViewProps) {
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

  const player = state.airlines[0]!
  const scale = W / view.w
  const flownRoutes = player.routes.filter((r) => player.fleet.some((a) => a.routeId === r.id))

  // Cities the player has a stake in stay visible at any zoom.
  const stakes = new Set<string>()
  for (const airline of state.airlines) {
    if (airline.id !== 0) continue
    for (const r of airline.routes) {
      stakes.add(r.from)
      stakes.add(r.to)
    }
  }
  for (const c of CITIES) if (slotsHeld(player, c.id) > 0) stakes.add(c.id)
  for (const e of state.world.events) if (e.city !== null) stakes.add(e.city)
  if (selected !== null) stakes.add(selected)

  const visible = CITIES.filter((c) => scale >= TIER_MIN_SCALE[cityTier(c)] || stakes.has(c.id))
  const labeled = new Set(
    visible.filter((c) => cityTier(c) === 1 || scale >= 1.5 || stakes.has(c.id)).map((c) => c.id),
  )

  // Cursor-anchored zoom, computed in TARGET space so consecutive wheel
  // events compound on where the view is heading, not where it is.
  const zoomAt = (clientX: number | null, clientY: number | null, factor: number): void => {
    const t = targetRef.current
    let mx = t.x + t.w / 2
    let my = t.y + t.h / 2
    if (clientX !== null && clientY !== null && svgRef.current) {
      const rect = svgRef.current.getBoundingClientRect()
      mx = t.x + ((clientX - rect.left) / rect.width) * t.w
      my = t.y + ((clientY - rect.top) / rect.height) * t.h
    }
    const w = t.w / factor
    const h = t.h / factor
    applyView({ x: mx - ((mx - t.x) / t.w) * w, y: my - ((my - t.y) / t.h) * h, w, h }, false)
  }

  const onWheel = (e: WheelEvent<SVGSVGElement>): void => {
    // Proportional to scroll delta: gentle on trackpads (many small deltas),
    // one comfortable step per mouse-wheel notch, hard-clamped per event.
    const factor = Math.min(1.6, Math.max(0.625, Math.pow(1.0018, -e.deltaY)))
    zoomAt(e.clientX, e.clientY, factor)
  }

  const onPointerDown = (e: PointerEvent<SVGSVGElement>): void => {
    drag.current = { px: e.clientX, py: e.clientY, moved: false }
  }

  const onPointerMove = (e: PointerEvent<SVGSVGElement>): void => {
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
    const t = targetRef.current
    applyView({ ...t, x: t.x - (dx / rect.width) * t.w, y: t.y - (dy / rect.height) * t.h }, true)
    drag.current.px = e.clientX
    drag.current.py = e.clientY
  }

  const onPointerUp = (): void => {
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
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        className="map"
        role="img"
        aria-label="World route map"
        data-testid="map"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <rect x={0} y={0} width={W} height={H} className="map-sea" />
        <path d={WORLD_PATH} className="map-land" />
        {/* Rival routes, thin, under the player's */}
        {state.airlines.slice(1).map((airline) =>
          airline.routes.map((r) => (
            <path key={`${airline.id}-${r.id}`} d={arcPath(r.from, r.to)} className="route-rival" />
          )),
        )}
        {player.routes.map((r) => {
          const km = distanceKm(r.from, r.to)
          const isNew = newRouteIds.has(r.id)
          return (
            <g key={r.id}>
              <path
                d={arcPath(r.from, r.to)}
                pathLength={1}
                className={`route-player ${haulClass(km)}${isNew ? ' route-new' : ''}`}
                data-testid={isNew ? 'route-line-new' : undefined}
              />
              {isNew &&
                [r.from, r.to].map((cityId) => {
                  const c = getCity(cityId)
                  return (
                    <circle key={cityId} cx={x(c.lon)} cy={y(c.lat)} r={10 / scale} className="endpoint-pulse" />
                  )
                })}
            </g>
          )
        })}
        {/* Ambient reward: little planes fly the routes you actually serve.
            Long-haul takes visibly longer than a hop. */}
        {flownRoutes.map((r) => {
          const km = distanceKm(r.from, r.to)
          const dur = 4 + Math.min(14, km / 900)
          return (
            <g key={`plane-${r.id}`} className="plane" data-testid={`plane-${r.id}`}>
              <text fontSize={11 / scale} dy={3.5 / scale} textAnchor="middle">
                ✈
              </text>
              <animateMotion
                dur={`${dur.toFixed(1)}s`}
                begin={`${-((r.id * 13) % 60) / 10}s`}
                repeatCount="indefinite"
                keyPoints="0;1;1;0;0"
                keyTimes="0;0.45;0.5;0.95;1"
                calcMode="linear"
                rotate="auto"
                path={arcPath(r.from, r.to)}
              />
            </g>
          )
        })}
        {/* Fresh slot wins ping gold at the airport. */}
        {[...newSlotCities].sort().map((cityId) => {
          const c = getCity(cityId)
          return (
            <circle
              key={`slots-${cityId}`}
              cx={x(c.lon)}
              cy={y(c.lat)}
              r={11 / scale}
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
          return cities.map((c) => (
            <circle
              key={`${e.id}-${c.id}`}
              cx={x(c.lon)}
              cy={y(c.lat)}
              r={12 / scale}
              className={good ? 'event-halo halo-boom' : 'event-halo halo-bust'}
              data-testid={`event-halo-${c.id}`}
            />
          ))
        })}
        {visible.map((c) => {
          const held = slotsHeld(player, c.id)
          // In route-planning mode, legal destinations light up as targets.
          const isTarget =
            routeFrom !== null &&
            routeFrom !== c.id &&
            held > slotsUsedAt(player.routes, c.id) &&
            !player.routes.some(
              (r) =>
                (r.from === c.id && r.to === routeFrom) || (r.from === routeFrom && r.to === c.id),
            )
          const r = (2 + cityMass(c) / 18) / Math.sqrt(scale)
          return (
            <g key={c.id} onClick={() => handleCityClick(c.id)} className="city">
              <circle
                data-testid={`city-${c.id}`}
                cx={x(c.lon)}
                cy={y(c.lat)}
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
              {labeled.has(c.id) && (
                <text x={x(c.lon) + r + 3 / scale} y={y(c.lat) + 3 / scale} fontSize={9 / scale} className="city-label">
                  {c.id}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      <div className="map-controls">
        <button data-testid="zoom-in" aria-label="zoom in" onClick={() => zoomAt(null, null, 1.5)}>
          +
        </button>
        <button data-testid="zoom-out" aria-label="zoom out" onClick={() => zoomAt(null, null, 1 / 1.5)}>
          −
        </button>
        <button data-testid="zoom-reset" aria-label="reset zoom" onClick={() => applyView(FULL_VIEW, false)}>
          ⤢
        </button>
      </div>
    </div>
  )
}
