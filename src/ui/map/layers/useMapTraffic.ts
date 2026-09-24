// The map's motion layer, described: which planes fly where (and how big and
// fast), the ambient effects that ride the same canvas, and the camera the
// canvas reads each frame. The drawing itself is TrafficCanvas's.

import { useCallback, useLayoutEffect, useMemo, useRef } from 'react'
import type { MutableRefObject } from 'react'
import { getAircraftType } from '../../../data/aircraft'
import { distanceKm, getCity, type City } from '../../../data/cities'
import type { Airline, GameState } from '../../../engine'
import { effectiveFrequency, operatingFleet } from '../../../engine/queries'
import { aircraftGlyph } from '../../AircraftArt'
import type { DisplayPreferences } from '../../display'
import { rivalColor } from '../../mapStyle'
import type { TrafficCamera, TrafficEffect, TrafficLeg, TrafficPlane } from '../../traffic'
import { FULL_VIEW, type ViewBox } from '../camera'
import type { EventHalos } from '../eventHalos'
import type { GlobePoint, GlobeView } from '../globe'
import { H, PLANE_GLYPH, W } from '../projection'

export function useMapTraffic({
  state,
  seat,
  player,
  showRivals,
  isGlobe,
  globe,
  projKey,
  rotating,
  reduceMotion,
  display,
  tripLegFor,
  pt,
  dotRadius,
  uiScale,
  halos,
  frame,
  baseRef,
  layerXfRef,
  movingRef,
}: {
  state: GameState
  seat: number
  player: Airline
  showRivals: boolean
  isGlobe: boolean
  globe: GlobeView
  projKey: string
  rotating: boolean
  reduceMotion: boolean
  display: Pick<DisplayPreferences, 'traffic'>
  tripLegFor: (fromId: string, toId: string) => TrafficLeg | null
  pt: (lon: number, lat: number) => GlobePoint
  dotRadius: (c: City) => number
  uiScale: number
  halos: EventHalos
  frame: { width: number; height: number }
  baseRef: MutableRefObject<ViewBox>
  layerXfRef: MutableRefObject<{ tx: number; ty: number; s: number }>
  movingRef: MutableRefObject<boolean>
}) {
  const flyingFleet = useMemo(() => operatingFleet(player, state.turn), [player, state.turn])
  const flownRoutes = useMemo(() => player.routes.filter((r) => effectiveFrequency(player, r, state.turn) > 0), [player, state.turn])
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
      tx: layerXfRef.current.tx,
      ty: layerXfRef.current.ty,
      s: layerXfRef.current.s,
      zoom: (isGlobe ? globe.s : W / baseRef.current.w) * layerXfRef.current.s,
    })
  })
  const trafficCamera = useCallback(() => cameraRef.current(), [])
  const trafficFrozen = useCallback(() => movingRef.current, [movingRef])

  return { traffic, effects, trafficCamera, trafficFrozen }
}
