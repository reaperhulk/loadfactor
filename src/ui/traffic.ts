// Ambient map traffic: the planes that shuttle along every served route.
//
// They used to be SMIL <animateMotion> elements inside the map SVG. Every
// frame of SMIL moves a DOM node, which invalidates layout and re-rasters
// the composited map layer — measured at ~425ms of main thread per second
// on a mature career, on a map nobody was touching. This module is the
// replacement: the same shuttles, drawn on one <canvas> that floats over
// the map. Nothing here touches the simulation — presentation only, and the
// only clock is the animation frame timestamp the canvas component feeds in.

// One leg of a route, sampled as a world-space polyline (viewBox units).
export interface TrafficLeg {
  pts: Float64Array // x0, y0, x1, y1, …
  cum: Float64Array // cumulative length at each point; cum[n-1] is the total
}

export interface TrafficPlane {
  leg: TrafficLeg
  dur: number // seconds for the full out-and-back shuttle
  phase: number // seconds already flown when the clock started
  glyph: string // SVG path, nose on +x
  size: number // CSS pixels per glyph unit
  fill: string
  stroke: string
  alpha: number
}

// Ambient motion that used to be CSS animations on SVG elements: a running
// animation on an SVG node re-lays-out the map every frame in Chromium,
// which cost about as much as the planes did. The static SVG element stays
// (it is what reduced motion shows, and what tests find); the canvas adds
// the movement on top.
export type TrafficEffect =
  // A bright arc sweeping around a ring: a negotiation in progress.
  | { kind: 'sweep'; x: number; y: number; r: number; width: number; color: string; period: number }
  // A ring breathing in and out: a world event on a city.
  | { kind: 'breathe'; x: number; y: number; r: number; width: number; color: string; period: number }
  // Dashes marching along a leg: a raid announced on the pair.
  | { kind: 'march'; leg: TrafficLeg; width: number; color: string }

export interface PlanePose {
  x: number
  y: number
  heading: number // radians, screen convention (y down)
}

// Polyline from a quadratic Bézier (the flat map's arc) — the same curve
// animateMotion followed, so the shuttles keep their lifted flight paths.
export function quadraticLeg(x1: number, y1: number, mx: number, my: number, x2: number, y2: number, n = 16): TrafficLeg {
  const pts = new Float64Array((n + 1) * 2)
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const u = 1 - t
    pts[i * 2] = u * u * x1 + 2 * u * t * mx + t * t * x2
    pts[i * 2 + 1] = u * u * y1 + 2 * u * t * my + t * t * y2
  }
  return polylineLeg(pts)
}

export function polylineLeg(pts: Float64Array): TrafficLeg {
  const n = pts.length / 2
  const cum = new Float64Array(n)
  for (let i = 1; i < n; i++) {
    const dx = pts[i * 2]! - pts[i * 2 - 2]!
    const dy = pts[i * 2 + 1]! - pts[i * 2 - 1]!
    cum[i] = cum[i - 1]! + Math.sqrt(dx * dx + dy * dy)
  }
  return { pts, cum }
}

// The shuttle's timeline, kept from the SMIL keyTimes: out for 45% of the
// cycle, a short dwell, back for 45%, another dwell. The nose points along
// the direction of travel and stays there through each dwell.
const OUT_END = 0.45
const BACK_START = 0.5
const BACK_END = 0.95

export function posePlane(leg: TrafficLeg, progress: number): PlanePose {
  const p = progress - Math.floor(progress)
  const total = leg.cum[leg.cum.length - 1]!
  if (p < BACK_START) {
    const d = Math.min(1, p / OUT_END) * total
    return poseAt(leg, d, false)
  }
  const d = (1 - Math.min(1, (p - BACK_START) / (BACK_END - BACK_START))) * total
  return poseAt(leg, d, true)
}

function poseAt(leg: TrafficLeg, distance: number, reversed: boolean): PlanePose {
  const { pts, cum } = leg
  const n = cum.length
  // The segment holding `distance`: linear scan — legs have ~25 points and
  // the loop runs a few dozen planes per frame, far below anything a binary
  // search would earn back.
  let i = 1
  while (i < n - 1 && cum[i]! < distance) i++
  const segLen = cum[i]! - cum[i - 1]!
  const t = segLen > 0 ? Math.min(1, Math.max(0, (distance - cum[i - 1]!) / segLen)) : 0
  const ax = pts[i * 2 - 2]!
  const ay = pts[i * 2 - 1]!
  const bx = pts[i * 2]!
  const by = pts[i * 2 + 1]!
  const dx = bx - ax
  const dy = by - ay
  return {
    x: ax + dx * t,
    y: ay + dy * t,
    heading: reversed ? Math.atan2(-dy, -dx) : Math.atan2(dy, dx),
  }
}

// The viewport the canvas draws through: the SVG's viewBox (`slice` fit into
// a frame of fw×fh CSS pixels) with the map layer's gesture transform on top
// (a scale about the frame's centre plus a translation). See MapView's
// paintLayer for where those numbers come from.
export interface TrafficCamera {
  vb: { x: number; y: number; w: number; h: number }
  fw: number
  fh: number
  tx: number
  ty: number
  s: number
}

// World (viewBox) → CSS pixel mapping as `css = a * world + e`, per axis.
export function cameraAffine(c: TrafficCamera): { a: number; ex: number; ey: number } {
  const k = Math.max(c.fw / c.vb.w, c.fh / c.vb.h)
  const offX = (c.fw - c.vb.w * k) / 2
  const offY = (c.fh - c.vb.h * k) / 2
  const a = k * c.s
  return {
    a,
    ex: (c.fw / 2) * (1 - c.s) + offX * c.s - c.vb.x * a + c.tx,
    ey: (c.fh / 2) * (1 - c.s) + offY * c.s - c.vb.y * a + c.ty,
  }
}

const glyphCache = new Map<string, Path2D>()
function glyphPath(d: string): Path2D {
  let p = glyphCache.get(d)
  if (p === undefined) {
    p = new Path2D(d)
    glyphCache.set(d, p)
  }
  return p
}

const TAU = Math.PI * 2

// One frame of traffic. `elapsed` is seconds of unpaused animation time.
export function drawTraffic(
  ctx: CanvasRenderingContext2D,
  planes: readonly TrafficPlane[],
  effects: readonly TrafficEffect[],
  camera: TrafficCamera,
  dpr: number,
  elapsed: number,
): void {
  const { a, ex, ey } = cameraAffine(camera)
  const wpx = camera.fw * dpr
  const hpx = camera.fh * dpr
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, wpx, hpx)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  for (const fx of effects) {
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.strokeStyle = fx.color
    if (fx.kind === 'march') {
      const { pts } = fx.leg
      ctx.beginPath()
      for (let i = 0; i < pts.length; i += 2) {
        const px = (a * pts[i]! + ex) * dpr
        const py = (a * pts[i + 1]! + ey) * dpr
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      ctx.setLineDash([3 * dpr, 6 * dpr])
      ctx.lineDashOffset = -((elapsed / 1.4) % 1) * 18 * dpr
      ctx.lineWidth = fx.width * dpr
      ctx.globalAlpha = 0.9
      ctx.stroke()
      ctx.setLineDash([])
      ctx.lineDashOffset = 0
      continue
    }
    const cx = (a * fx.x + ex) * dpr
    const cy = (a * fx.y + ey) * dpr
    const r = a * fx.r * dpr
    if (cx < -r || cy < -r || cx > wpx + r || cy > hpx + r) continue
    const u = (elapsed / fx.period) % 1
    ctx.beginPath()
    if (fx.kind === 'sweep') {
      ctx.arc(cx, cy, r, u * TAU, u * TAU + 1.6)
      ctx.globalAlpha = 0.95
    } else {
      const w = (1 - Math.cos(u * TAU)) / 2 // ease in and out, 0 → 1 → 0
      ctx.arc(cx, cy, r * (0.75 + 0.4 * w), 0, TAU)
      ctx.globalAlpha = 0.9 - 0.55 * w
    }
    ctx.lineWidth = fx.width * dpr
    ctx.stroke()
  }
  for (const plane of planes) {
    const pose = posePlane(plane.leg, (elapsed + plane.phase) / plane.dur)
    const cx = (a * pose.x + ex) * dpr
    const cy = (a * pose.y + ey) * dpr
    const g = plane.size * dpr
    const margin = 20 * g
    if (cx < -margin || cy < -margin || cx > wpx + margin || cy > hpx + margin) continue
    const cos = Math.cos(pose.heading) * g
    const sin = Math.sin(pose.heading) * g
    ctx.setTransform(cos, sin, -sin, cos, cx, cy)
    ctx.globalAlpha = plane.alpha
    const path = glyphPath(plane.glyph)
    ctx.strokeStyle = plane.stroke
    ctx.lineWidth = 1.2
    ctx.stroke(path)
    ctx.fillStyle = plane.fill
    ctx.fill(path)
  }
  ctx.globalAlpha = 1
}
