import { useEffect, useLayoutEffect, useRef } from 'react'
import { drawTraffic, type TrafficCamera, type TrafficEffect, type TrafficPlane } from './traffic'

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
}

export function TrafficCanvas({ planes, effects, rivalCount, frame, active, camera, frozen }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const planesRef = useRef(planes)
  const effectsRef = useRef(effects)
  const elapsed = useRef(0) // seconds of unfrozen animation time
  const lastTs = useRef(0)
  const lastDraw = useRef(0)
  const raf = useRef(0)
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
      if (ts - lastDraw.current >= FRAME_MS - 1) {
        if (lastTs.current && !frozen()) elapsed.current += Math.min(MAX_STEP_MS, ts - lastTs.current) / 1000
        lastTs.current = ts
        lastDraw.current = ts
        drawTraffic(ctx, planesRef.current, effectsRef.current, camera(), dpr, elapsed.current)
      }
      raf.current = requestAnimationFrame(tick)
    }
    const sync = (): void => {
      const run = active && !document.hidden && (planes.length > 0 || effects.length > 0)
      if (!run) {
        stop()
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.clearRect(0, 0, canvas.width, canvas.height)
      } else if (raf.current === 0) {
        lastDraw.current = 0
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
    drawTraffic(ctx, planes, effects, camera(), dpr, elapsed.current)
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
    />
  )
}
