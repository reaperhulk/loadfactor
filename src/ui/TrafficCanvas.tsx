import { useEffect, useLayoutEffect, useRef } from 'react'
import { cameraAffine, drawTraffic, type Occluder, type TrafficCamera, type TrafficEffect, type TrafficPlane } from './traffic'

// The map's motion layer: one canvas over the map, one throttled
// animation-frame loop, carrying the planes and the few ambient effects
// (negotiation sweeps, event halos, raid marches). It runs only while there
// is something to show — the map tab on screen, the document visible — and
// stops dead otherwise, so an idle background tab or a hidden map costs
// nothing at all.
//
// Positions come from the camera the map reports each frame (its viewBox
// plus the compositor transform a gesture leaves on the layer), so the
// shuttles stay glued to their routes while the map pans and zooms. The
// clock freezes while a gesture is in flight — the same "hold still while
// the map moves" rule the SMIL planes lived by — and resumes on release.
const FRAME_MS = 1000 / 30
const MAX_STEP_MS = 100

interface Props {
  planes: readonly TrafficPlane[]
  effects: readonly TrafficEffect[]
  rivalCount: number
  frame: { width: number; height: number }
  active: boolean
  camera: () => TrafficCamera
  frozen: () => boolean
  // The city names on screen, in world units — read each frame, so a new
  // label layout never restarts the animation loop.
  occluders?: { readonly current: readonly Occluder[] }
}

export function TrafficCanvas({ planes, effects, rivalCount, frame, active, camera, frozen, occluders }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const planesRef = useRef(planes)
  const effectsRef = useRef(effects)
  const elapsed = useRef(0) // seconds of unfrozen animation time
  const lastTs = useRef(0)
  const lastDraw = useRef(0)
  const raf = useRef(0)
  // The world→CSS mapping the bitmap was last drawn through. While the clock
  // is frozen (a drag, a pinch, a zoom ease) the planes hold still in the
  // world, so the drawn bitmap is still right — only the camera moved. The
  // canvas then follows the map with a CSS transform instead of redrawing:
  // every redraw re-uploads a frame-sized bitmap to the compositor, and in a
  // traced drag under CPU throttle those uploads were what held frames past
  // 100ms (the main thread sat in WaitForCommitCompletion, not in script).
  const drawnAt = useRef<{ a: number; ex: number; ey: number } | null>(null)
  const dpr = Math.min(2, typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1)
  const widthPx = Math.max(1, Math.round(frame.width * dpr))
  const heightPx = Math.max(1, Math.round(frame.height * dpr))
  useLayoutEffect(() => {
    planesRef.current = planes
    effectsRef.current = effects
  }, [planes, effects])

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d') ?? null
    if (canvas === null || ctx === null) return
    const stop = (): void => {
      if (raf.current) cancelAnimationFrame(raf.current)
      raf.current = 0
      lastTs.current = 0
    }
    const tick = (ts: number): void => {
      raf.current = 0
      const still = frozen()
      const at = drawnAt.current
      if (still && at !== null) {
        // Frozen: follow the camera every frame (a style write, no raster),
        // and keep the clock parked so the pause is not counted on release.
        lastTs.current = ts
        const now = cameraAffine(camera())
        const k = now.a / at.a
        const style = `translate3d(${(now.ex - k * at.ex).toFixed(2)}px, ${(now.ey - k * at.ey).toFixed(2)}px, 0) scale(${k.toFixed(6)})`
        if (canvas.style.transform !== style) canvas.style.transform = style
      } else if (ts - lastDraw.current >= FRAME_MS - 1) {
        if (lastTs.current && !still) elapsed.current += Math.min(MAX_STEP_MS, ts - lastTs.current) / 1000
        lastTs.current = ts
        lastDraw.current = ts
        const cam = camera()
        if (canvas.style.transform !== '') canvas.style.transform = ''
        drawTraffic(ctx, planesRef.current, effectsRef.current, cam, dpr, elapsed.current, occluders?.current)
        drawnAt.current = cameraAffine(cam)
      }
      raf.current = requestAnimationFrame(tick)
    }
    const sync = (): void => {
      const run = active && !document.hidden && (planes.length > 0 || effects.length > 0)
      if (!run) {
        stop()
        drawnAt.current = null
        canvas.style.transform = ''
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.clearRect(0, 0, canvas.width, canvas.height)
      } else if (raf.current === 0) {
        lastDraw.current = 0
        // New planes or effects: the next frame draws them for real.
        drawnAt.current = null
        raf.current = requestAnimationFrame(tick)
      }
    }
    sync()
    document.addEventListener('visibilitychange', sync)
    return () => {
      document.removeEventListener('visibilitychange', sync)
      stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, planes, effects, dpr])

  // A resize resets the bitmap; repaint before the frame shows a blank layer.
  useLayoutEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d') ?? null
    if (canvas === null || ctx === null || raf.current === 0) return
    const cam = camera()
    canvas.style.transform = ''
    drawTraffic(ctx, planes, effects, cam, dpr, elapsed.current, occluders?.current)
    drawnAt.current = cameraAffine(cam)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widthPx, heightPx])

  return (
    <canvas
      ref={ref}
      className="map-traffic"
      data-testid="map-traffic"
      data-planes={planes.length - rivalCount}
      data-rival-planes={rivalCount}
      width={widthPx}
      height={heightPx}
      aria-hidden="true"
      style={{ transformOrigin: '0 0', willChange: 'transform' }}
    />
  )
}
