// Keyboard access to the map: the airports drawn this render (one shared
// projection for markers, tab stop and arrows), which one holds the single tab
// stop, and the keys — arrows hop between airports (panning to keep the new
// one in view), Shift+arrows pan, + and - zoom, Enter or Space opens.

import { useLayoutEffect, useRef } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { getCity, type City } from '../../data/cities'
import { visibleRect } from './camera'
import { globeProjectFull, type GlobePoint } from './globe'
import { ARROW_DIRECTIONS, nearestInDirection } from './keyboard'
import { x, y } from './projection'
import type { MapCamera } from './useMapCamera'

export function useMapKeyboard({
  camera,
  visible,
  pt,
  focusCity,
  setFocusCity,
  selected,
  hq,
  onCityClick,
}: {
  camera: MapCamera
  visible: readonly City[]
  pt: (lon: number, lat: number) => GlobePoint
  focusCity: string | null
  setFocusCity: (id: string) => void
  selected: string | null
  hq: string
  onCityClick: (city: string) => void
}) {
  const { isGlobe, globe, globeTargetRef, applyGlobe, targetRef, aspectNow, applyView, zoomAt, svgRef } = camera
  // Set by an arrow key, consumed after the render that moves the tab stop.
  const moveFocusRef = useRef<string | null>(null)
  // Airports actually drawn, and where — projected once per render and shared
  // by the markers, the roving tab stop and the arrow keys.
  const sites: { id: string; x: number; y: number }[] = []
  for (const c of visible) {
    const p = pt(c.lon, c.lat)
    if (p.vis) sites.push({ id: c.id, x: p.X, y: p.Y })
  }
  const sitePos = new Map(sites.map((st) => [st.id, st]))
  const preferredStop = focusCity ?? selected ?? hq
  const tabStop = sitePos.has(preferredStop) ? preferredStop : (sites[0]?.id ?? null)

  // Keyboard: arrows hop between airports (Shift+arrows, or an arrow with no
  // airport that way, pans), + and − zoom, Enter or Space opens the airport.
  const panStep = (dir: 'left' | 'right' | 'up' | 'down'): void => {
    const sx = dir === 'right' ? 1 : dir === 'left' ? -1 : 0
    const sy = dir === 'down' ? 1 : dir === 'up' ? -1 : 0
    if (isGlobe) {
      const g = globeTargetRef.current
      const d = 12 / g.s
      applyGlobe({ ...g, cLon: g.cLon + sx * d, cLat: g.cLat - sy * d }, false)
      return
    }
    const t = targetRef.current
    const vis = visibleRect(t, aspectNow())
    applyView({ ...t, x: t.x + sx * vis.w * 0.2, y: t.y + sy * vis.h * 0.2 }, false)
  }
  const zoomStep = (factor: number): void => {
    if (isGlobe) applyGlobe({ ...globeTargetRef.current, s: globeTargetRef.current.s * factor }, false)
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
        moveFocusRef.current = next
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
    const id = moveFocusRef.current
    if (id === null) return
    moveFocusRef.current = null
    svgRef.current?.querySelector<SVGGElement>(`[data-city="${id}"]`)?.focus({ preventScroll: true })
    const c = getCity(id)
    if (isGlobe) {
      const p = globeProjectFull(globe, c.lon, c.lat)
      if (p.cosc < 0.35) applyGlobe({ ...globeTargetRef.current, cLon: c.lon, cLat: c.lat }, false)
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

  return { sitePos, tabStop, onMapKeyDown }
}
