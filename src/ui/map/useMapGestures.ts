// Pointer, touch and wheel input for the map: drag to pan (or spin the
// globe), pinch and wheel to zoom about the fingers or cursor, double click or
// double tap to step in, and the fat-finger tap resolver that picks the
// nearest airport. Everything moves through the camera (useMapCamera); the
// only state kept here is the gesture in flight.

import { useEffect, useRef } from 'react'
import type { MouseEvent as ReactMouseEvent, MutableRefObject, PointerEvent } from 'react'
import type { City } from '../../data/cities'
import { viewToCss } from './camera'
import { GLOBE_R, globeUnproject, type GlobePoint } from './globe'
import { H, W } from './projection'
import type { MapCamera } from './useMapCamera'

export function useMapGestures({
  camera,
  visible,
  pt,
  onCityClick,
  suppressClickRef,
}: {
  camera: MapCamera
  visible: readonly City[]
  pt: (lon: number, lat: number) => GlobePoint
  onCityClick: (city: string) => void
  // Set when a drag/pinch gesture ends so the click that follows it is
  // swallowed; the route arcs consult it too.
  suppressClickRef: MutableRefObject<boolean>
}) {
  const { isGlobe, frameRect, globeTargetRef, applyGlobe, zoomAt, svgRef, targetRef, applyView, beginGesture, endGesture, view } = camera
  const drag = useRef<{ px: number; py: number; moved: boolean } | null>(null)
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
        const g = globeTargetRef.current
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
  }, [svgRef])

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
    suppressClickRef.current = false
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2) {
      pinch.current = pinchGeometry()
      drag.current = null
      suppressClickRef.current = true
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
        const g = globeTargetRef.current
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
      const g = globeTargetRef.current
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
    if (isGlobe) applyGlobe({ ...globeTargetRef.current, s: globeTargetRef.current.s * 1.5 }, false)
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
    if (wasDrag) suppressClickRef.current = true
    if (pointers.current.size === 0) endGesture()
    if (e.pointerType === 'touch' && !wasDrag && pointers.current.size === 0) {
      const prev = lastTap.current
      const now = e.timeStamp
      if (prev !== null && now - prev.t < 320 && Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < 32) {
        lastTap.current = null
        // The second tap zooms instead of re-toggling whatever it landed on.
        suppressClickRef.current = true
        zoomInAt(e.clientX, e.clientY)
        return
      }
      lastTap.current = { t: now, x: e.clientX, y: e.clientY }
    }
  }

  const handleCityClick = (cityId: string, detail = 1): void => {
    if (detail >= 2) return // the dblclick handler is zooming
    if (suppressClickRef.current) {
      suppressClickRef.current = false
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
    if (suppressClickRef.current) {
      suppressClickRef.current = false
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

  return { onPointerDown, onPointerMove, onPointerUp, zoomInAt, handleCityClick, handleMapTap }
}
