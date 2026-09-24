// The map's camera: what the flat map shows (the committed view, the raster
// anchor, the eased target), the globe's orientation, and the projection
// between them — plus the machinery that moves them without re-rendering the
// map every frame (a transform on a composited layer, rAF eases, the frame
// measurement home is framed from). Gestures and keys drive it through
// applyView / applyGlobe / zoomAt and begin/endGesture.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { GameState } from '../../engine'
import { reducedMotion } from '../display'
import { loadGlobeGeometry, type GlobeGeometry } from '../globeGeometry'
import { viewSeat } from '../session'
import {
  MAX_SCALE,
  NO_INSETS,
  SPAN_MIN,
  clampView,
  layerSpan,
  overlayInsets,
  viewToCss,
  visibleRect,
  type ViewBox,
} from './camera'
import { GLOBE_HOME, clampGlobe, type GlobeView } from './globe'
import { H, W, networkHome } from './projection'

export function useMapCamera({ state, active, reduceMotion }: { state: GameState; active: boolean; reduceMotion: boolean }) {
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

  return {
    svgRef,
    wrapRef,
    layerRef,
    minimapRef,
    frame,
    frameAspect,
    aspectNow,
    homeView,
    view,
    anchor,
    targetRef,
    projection,
    setProjection,
    globeGeometry,
    globeError,
    setGlobeError,
    setGlobeRetry,
    isGlobe,
    globeLoading,
    rotating,
    movingRef,
    baseRef,
    globe,
    globeTargetRef: globeTarget,
    layerXfRef: layerXf,
    frameRect,
    applyView,
    applyGlobe,
    zoomAt,
    beginGesture,
    endGesture,
  }
}

export type MapCamera = ReturnType<typeof useMapCamera>
