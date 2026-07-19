// SVG world map: real landmass under an equirectangular projection, cities as
// dots with zoom-dependent level of detail, routes as lifted arcs whose look
// tells you short-haul from long-haul at a glance. Presentation-only floats
// are fine here — the engine never sees screen coordinates.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import { CITIES, distanceKm, getCity, pairKey, type City } from '../data/cities'
import { getEventDef } from '../data/events'
import { WORLD_PATH } from '../data/worldmap.gen'
import type { GameState, Route } from '../engine'
import { effectiveFrequency, networkCities, slotsHeld } from '../engine/queries'

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

  const player = state.airlines[0]!
  const scale = W / view.w
  const flownRoutes = player.routes.filter((r) => player.fleet.some((a) => a.routeId === r.id))
  const network = networkCities(player)
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
      zoomAt(e.clientX, e.clientY, factor)
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
    const t = targetRef.current
    applyView({ ...t, x: t.x - (dx / rect.width) * t.w, y: t.y - (dy / rect.height) * t.h }, true)
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
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        className="map"
        role="img"
        aria-label="World route map"
        data-testid="map"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <rect x={0} y={0} width={W} height={H} className="map-sea" />
        <path d={WORLD_PATH} className="map-land" />
        {/* Transfer hubs glow in proportion to the connecting pax flowing
            over them last quarter. */}
        {[...hubVolume.entries()]
          .filter(([, v]) => v >= 500)
          .map(([cityId, v]) => {
            const c = getCity(cityId)
            return (
              <circle
                key={`hub-${cityId}`}
                cx={x(c.lon)}
                cy={y(c.lat)}
                r={(5 + Math.min(14, Math.sqrt(v) / 6)) / scale}
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
            airline.routes.map((r) => (
              <path
                key={`${airline.id}-${r.id}`}
                d={arcPath(r.from, r.to)}
                className={`route-rival ${rivalColorClass(airline.id)}`}
              />
            )),
          )}
        {player.routes.map((r) => {
          const km = distanceKm(r.from, r.to)
          const isNew = newRouteIds.has(r.id)
          const contested = rivalPairs.has(pairKey(r.from, r.to))
          return (
            <g key={r.id}>
              <path
                d={arcPath(r.from, r.to)}
                pathLength={1}
                className={`route-player ${haulClass(km)}${isNew ? ' route-new' : ''}${contested ? ' route-contested' : ''}${lensClass(r)}`}
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
                  const c = getCity(cityId)
                  return (
                    <circle key={cityId} cx={x(c.lon)} cy={y(c.lat)} r={10 / scale} className="endpoint-pulse" />
                  )
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
          const path = arcPath(r.from, r.to)
          return Array.from({ length: planes }, (_, i) => (
            <g key={`plane-${r.id}-${i}`} className="plane" data-testid={i === 0 ? `plane-${r.id}` : undefined}>
              {/* A silhouette whose nose points along +x: rotate="auto" then
                  keeps it flying nose-first on BOTH legs of the shuttle — the
                  ✈ text glyph points 45° off-axis and read as flying
                  backwards on the return leg. */}
              <path d={PLANE_GLYPH} transform={`scale(${0.8 / scale})`} />
              <animateMotion
                dur={`${dur.toFixed(1)}s`}
                begin={`${(-((r.id * 13) % 60) / 10 - (i * dur) / planes).toFixed(1)}s`}
                repeatCount="indefinite"
                keyPoints="0;1;1;0;0"
                keyTimes="0;0.45;0.5;0.95;1"
                calcMode="linear"
                rotate="auto"
                path={path}
              />
            </g>
          ))
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
          // In route-planning mode, legal destinations light up as targets —
          // and a route must touch the network (HQ or a served city).
          const inNetwork = network.has(c.id)
          const isTarget =
            routeFrom !== null &&
            routeFrom !== c.id &&
            (network.has(routeFrom) || inNetwork) &&
            held > slotsUsedAt(player.routes, c.id) &&
            !player.routes.some(
              (r) =>
                (r.from === c.id && r.to === routeFrom) || (r.from === routeFrom && r.to === c.id),
            )
          const r = (2 + cityMass(c) / 18) / Math.sqrt(scale)
          return (
            <g key={c.id} onClick={() => handleCityClick(c.id)} className="city">
              {inNetwork && (
                <circle cx={x(c.lon)} cy={y(c.lat)} r={r + 2.5 / scale} className="city-network-ring" />
              )}
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
            </g>
          )
        })}
        {/* Labels draw in their own layer ABOVE every dot, with a halo — a
            neighboring city's dot can never sit on top of a name. */}
        {visible
          .filter((c) => labeled.has(c.id))
          .map((c) => {
            const r = (2 + cityMass(c) / 18) / Math.sqrt(scale)
            return (
              <text
                key={`label-${c.id}`}
                x={x(c.lon) + r + 3 / scale}
                y={y(c.lat) + 3 / scale}
                fontSize={9 / scale}
                className="city-label"
              >
                {c.id}
              </text>
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
