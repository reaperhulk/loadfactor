// Flat-map camera math: the viewBox the SVG shows, what part of it a frame
// actually sees, how far it may pan, and where "home" is. Pure functions over
// numbers, so the framing rules are unit-tested rather than eyeballed.
//
// The SVG covers its box (preserveAspectRatio="slice"): the viewBox is scaled
// by the LARGER of the two frame/viewBox ratios and the surplus is cropped
// evenly either side. On a desktop the map frame is much taller than the
// world's 2.7:1, so at the whole-world viewBox a third of the planet's width
// (the Pacific, Japan, Australia, the US west coast) is cropped away. Every
// rule below therefore reasons about the VISIBLE rectangle, not the viewBox.

import { MAP_H, MAP_W } from '../../data/worldmap.gen'

const W = MAP_W
const H = MAP_H

export interface ViewBox {
  x: number
  y: number
  w: number
  h: number
}

export const FULL_VIEW: ViewBox = { x: 0, y: 0, w: W, h: H }
// Past 4× the frame holds nothing but dots and one label; 6× was empty.
export const MAX_SCALE = 4

// Home zoom limits: a desktop opens on (nearly) the whole world, centred on
// the player's network; a phone, whose box is nearly square, opens on the
// player's own region. Below 1.18x on the desktop the minimap stays hidden at
// home, which keeps the world view uncluttered.
export const HOME_SCALE_DESKTOP = 1.15
export const HOME_SCALE_COMPACT = 2.2

// The SVG covers its box (preserveAspectRatio="slice"), so viewBox units map
// to CSS pixels by the LARGER of the two ratios with the surplus split either
// side. Every pointer conversion — tap, drag, pinch, zoom-to-cursor — must use
// this, or input lands in the wrong place the moment the element's box stops
// carrying the viewBox's aspect (which is what a phone-height map does).
export function viewToCss(rect: { width: number; height: number }, w: number, h: number) {
  const k = Math.max(rect.width / w, rect.height / h)
  return { k, offX: (rect.width - w * k) / 2, offY: (rect.height - h * k) / 2 }
}

// The part of viewBox `v` a frame of aspect `aspect` (width / height) shows.
export function visibleRect(v: ViewBox, aspect: number): ViewBox {
  if (aspect < v.w / v.h) {
    const w = v.h * aspect
    return { x: v.x + (v.w - w) / 2, y: v.y, w, h: v.h }
  }
  const h = v.w / aspect
  return { x: v.x, y: v.y + (v.h - h) / 2, w: v.w, h }
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n))

// Keep the zoom in range and the VISIBLE part of the view on the world. The
// viewBox itself may overhang the world's edge by exactly the amount `slice`
// crops away — without that, nothing near the antimeridian could ever be
// centred (Tokyo sat at the right edge at every zoom a desktop allows).
export function clampView(v: ViewBox, aspect: number = W / H): ViewBox {
  const w = Math.min(W, Math.max(W / MAX_SCALE, v.w))
  const h = (w / W) * H
  const vis = visibleRect({ x: 0, y: 0, w, h }, aspect)
  const slackX = (w - vis.w) / 2
  const slackY = (h - vis.h) / 2
  return {
    x: clamp(v.x, -slackX, W - w + slackX),
    y: clamp(v.y, -slackY, H - h + slackY),
    w,
    h,
  }
}

// How many frames wide the moving layer is. The overhang past each edge is
// (SPAN - 1) / 2 of the frame, and that is the budget a gesture spends before
// the layer runs out of painted world and has to be re-centred — which rewrites
// the viewBox and throws away the cached texture, the one genuinely expensive
// thing a drag can do.
//
// So the layer is sized to hold the WHOLE WORLD whenever that is affordable.
// Zoomed out two steps the world is only 2.25 frames across, so the layer
// covers all of it and a drag of any length re-centres zero times: the
// compositor just slides a texture that already has everywhere on it. Past the
// cap the world no longer fits and re-centres come back, but by then the view
// holds few enough cities that the render behind one is cheap.
// The choice is deliberately all-or-nothing. Either the layer holds the whole
// world, and a drag of any length re-centres zero times, or it takes the
// smallest useful overhang and re-centres often but cheaply. A middle size
// gets the worst of both: re-centres still happen, and the wider cull that a
// wider layer forces drags more cities into every render — at max zoom that
// was 48 of them instead of 12, to remove only two thirds of the re-centres.
//
// "Holds the whole world" is measured from where the layer is ANCHORED: the
// layer is centred on the view it was painted for, and home now frames the
// player's network rather than the middle of the map, so the layer must reach
// the FARTHER world edge on each axis. For a centred view that is exactly
// the world's size in frames, as before; the cap is the same texture budget.
export const SPAN_MIN = 1.5
export const SPAN_WHOLE_WORLD_UP_TO = 2.5
export function layerSpan(anchor: ViewBox, frameAspect: number): number {
  if (frameAspect < 1.5) return SPAN_MIN
  const vis = visibleRect(anchor, frameAspect)
  const cx = vis.x + vis.w / 2
  const cy = vis.y + vis.h / 2
  const need = Math.max((2 * Math.max(cx, W - cx)) / vis.w, (2 * Math.max(cy, H - cy)) / vis.h)
  const cap = SPAN_WHOLE_WORLD_UP_TO * Math.max(1, W / H / frameAspect, frameAspect / (W / H))
  return need <= cap + 1e-9 ? Math.max(SPAN_MIN, need) : SPAN_MIN
}

export interface Insets {
  left: number
  top: number
  right: number
  bottom: number
}

export const NO_INSETS: Insets = { left: 0, top: 0, right: 0, bottom: 0 }

interface Box {
  left: number
  top: number
  width: number
  height: number
}

// The map's own chrome (zoom column, map-colors box) floats over the frame.
// Each overlay is charged to whichever frame edge costs the least map area to
// give up — a tall column hugging the left edge becomes a left inset, a wide
// box along the top a top inset. Capped so one oversized overlay cannot
// squeeze the network into a sliver.
export function overlayInsets(frame: Box, overlays: readonly Box[]): Insets {
  const out = { ...NO_INSETS }
  const fr = frame.left + frame.width
  const fb = frame.top + frame.height
  for (const o of overlays) {
    const or = o.left + o.width
    const ob = o.top + o.height
    if (o.width <= 0 || o.height <= 0 || or <= frame.left || o.left >= fr || ob <= frame.top || o.top >= fb) continue
    const sides: [keyof Insets, number, number][] = [
      ['left', or - frame.left, frame.height],
      ['right', fr - o.left, frame.height],
      ['top', ob - frame.top, frame.width],
      ['bottom', fb - o.top, frame.width],
    ]
    let best = sides[0]!
    for (const s of sides) if (s[1] * s[2] < best[1] * best[2]) best = s
    out[best[0]] = Math.max(out[best[0]], best[1])
  }
  out.left = Math.min(out.left, frame.width * 0.3)
  out.right = Math.min(out.right, frame.width * 0.3)
  out.top = Math.min(out.top, frame.height * 0.3)
  out.bottom = Math.min(out.bottom, frame.height * 0.3)
  return out
}

export interface HomeFraming {
  // Projected (viewBox-unit) positions of the places home must show: the HQ,
  // every served city and every foothold.
  points: readonly { x: number; y: number }[]
  frame: { width: number; height: number }
  insets?: Insets
  // The closest home may zoom in — a one-city network still opens on a region.
  maxScale: number
}

// Home: the smallest view (down to `maxScale`) whose visible, uncovered area
// holds the whole network with a margin, centred on it as far as the world's
// edge allows. A network wider than the frame falls back to the widest view,
// still centred on the network rather than on the Atlantic.
export function homeViewFor({ points, frame, insets = NO_INSETS, maxScale }: HomeFraming): ViewBox {
  const fw = Math.max(1, frame.width)
  const fh = Math.max(1, frame.height)
  const aspect = fw / fh
  if (points.length === 0) return clampView(FULL_VIEW, aspect)
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of points) {
    minX = Math.min(minX, p.x)
    maxX = Math.max(maxX, p.x)
    minY = Math.min(minY, p.y)
    maxY = Math.max(maxY, p.y)
  }
  // A margin that grows with the network, never less than ~10° of arc, so a
  // city on the bounding box is not pressed against the frame's edge.
  const padX = Math.max(26, (maxX - minX) * 0.12)
  const padY = Math.max(18, (maxY - minY) * 0.12)
  const bw = maxX - minX + 2 * padX
  const bh = maxY - minY + 2 * padY
  const availW = Math.max(1, fw - insets.left - insets.right)
  const availH = Math.max(1, fh - insets.top - insets.bottom)
  // CSS px per world unit that fits the box into the uncovered area...
  const fit = Math.min(availW / bw, availH / bh)
  // ...expressed as a viewBox width under `slice`, then held to the zoom range.
  const cover = Math.max(fw, (fh * W) / H)
  const w = Math.min(W, Math.max(W / Math.min(MAX_SCALE, Math.max(1, maxScale)), cover / fit))
  const h = (w / W) * H
  const k = cover / w
  // Centre the network in the UNCOVERED area: shift by half the difference
  // between the insets on opposite sides.
  const cx = (minX + maxX) / 2 - (insets.left - insets.right) / (2 * k)
  const cy = (minY + maxY) / 2 - (insets.top - insets.bottom) / (2 * k)
  return clampView({ x: cx - w / 2, y: cy - h / 2, w, h }, aspect)
}
