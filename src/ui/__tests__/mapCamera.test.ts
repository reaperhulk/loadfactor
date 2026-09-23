// Home framing and pan limits for the flat map. The desktop frame is much
// taller than the world's 2.7:1, so the cropped (`slice`) edges are where the
// old rules lost the Pacific and pinned a Singapore airline to the right edge.

import { describe, expect, it } from 'vitest'
import { getCity } from '../../data/cities'
import { MAP_H, MAP_W, projectLat, projectLon } from '../../data/worldmap.gen'
import {
  FULL_VIEW,
  HOME_SCALE_COMPACT,
  HOME_SCALE_DESKTOP,
  MAX_SCALE,
  SPAN_MIN,
  SPAN_WHOLE_WORLD_UP_TO,
  clampView,
  homeViewFor,
  layerSpan,
  overlayInsets,
  viewToCss,
  visibleRect,
  type Insets,
  type ViewBox,
} from '../map/camera'

const DESKTOP = { width: 1300, height: 760 }
const PHONE = { width: 390, height: 260 }
const DESKTOP_CONTROLS: Insets = { left: 48, top: 44, right: 0, bottom: 0 }

const at = (id: string) => {
  const c = getCity(id)
  return { x: projectLon(c.lon), y: projectLat(c.lat) }
}

// Where a world point lands in the frame's CSS pixels.
function toCss(v: ViewBox, frame: { width: number; height: number }, p: { x: number; y: number }) {
  const { k, offX, offY } = viewToCss(frame, v.w, v.h)
  return { x: (p.x - v.x) * k + offX, y: (p.y - v.y) * k + offY }
}

function expectInside(v: ViewBox, frame: { width: number; height: number }, insets: Insets, ids: string[]) {
  for (const id of ids) {
    const p = toCss(v, frame, at(id))
    expect(p.x, `${id} clears the left overlay`).toBeGreaterThan(insets.left)
    expect(p.x, `${id} inside the right edge`).toBeLessThan(frame.width - insets.right)
    expect(p.y, `${id} clears the top overlay`).toBeGreaterThan(insets.top)
    expect(p.y, `${id} inside the bottom edge`).toBeLessThan(frame.height - insets.bottom)
  }
}

describe('visible rect and pan limits', () => {
  it('crops the sides of a frame taller than the world', () => {
    const vis = visibleRect(FULL_VIEW, 1.5)
    expect(vis.h).toBe(MAP_H)
    expect(vis.w).toBeCloseTo(MAP_H * 1.5)
    expect(vis.x + vis.w / 2).toBeCloseTo(MAP_W / 2)
  })

  it('lets the viewBox overhang only by what slice crops away', () => {
    const aspect = 1.5
    const left = clampView({ x: -500, y: 0, w: MAP_W, h: MAP_H }, aspect)
    expect(visibleRect(left, aspect).x).toBeCloseTo(0)
    const right = clampView({ x: 5000, y: 0, w: MAP_W / 2, h: MAP_H / 2 }, aspect)
    const vis = visibleRect(right, aspect)
    expect(vis.x + vis.w).toBeCloseTo(MAP_W)
    // A frame with the world's own aspect gets the old, strict limits.
    const strict = clampView({ x: -10, y: -10, w: MAP_W, h: MAP_H })
    for (const k of ['x', 'y', 'w', 'h'] as const) expect(strict[k]).toBeCloseTo(FULL_VIEW[k])
  })

  it('holds the zoom range', () => {
    expect(clampView({ x: 0, y: 0, w: 5, h: 1 }).w).toBeCloseTo(MAP_W / MAX_SCALE)
    expect(clampView({ x: 0, y: 0, w: MAP_W * 3, h: MAP_H * 3 }).w).toBe(MAP_W)
  })
})

describe('home framing', () => {
  it('opens an empty network on the whole world', () => {
    expect(homeViewFor({ points: [], frame: DESKTOP, maxScale: HOME_SCALE_DESKTOP })).toEqual(
      clampView(FULL_VIEW, DESKTOP.width / DESKTOP.height),
    )
  })

  it('brings a Singapore HQ in from the right edge on a desktop', () => {
    const ids = ['SIN', 'HKG', 'BKK', 'KUL']
    const v = homeViewFor({ points: ids.map(at), frame: DESKTOP, insets: DESKTOP_CONTROLS, maxScale: HOME_SCALE_DESKTOP })
    expectInside(v, DESKTOP, DESKTOP_CONTROLS, ids)
    const sin = toCss(v, DESKTOP, at('SIN'))
    // Comfortably inside, not hugging the edge as the whole-world view had it.
    expect(sin.x).toBeGreaterThan(DESKTOP.width * 0.25)
    expect(sin.x).toBeLessThan(DESKTOP.width * 0.85)
    // Home on a desktop is still (nearly) the world, never a regional close-up.
    expect(MAP_W / v.w).toBeLessThanOrEqual(HOME_SCALE_DESKTOP + 1e-9)
  })

  it('keeps the US west coast out from under the zoom controls', () => {
    const ids = ['JFK', 'SFO', 'LAX', 'ORD']
    const v = homeViewFor({ points: ids.map(at), frame: DESKTOP, insets: DESKTOP_CONTROLS, maxScale: HOME_SCALE_DESKTOP })
    expectInside(v, DESKTOP, DESKTOP_CONTROLS, ids)
  })

  it('reaches the world edge for an HQ at the antimeridian', () => {
    for (const id of ['SYD', 'HND', 'HNL']) {
      const v = homeViewFor({ points: [at(id)], frame: DESKTOP, insets: DESKTOP_CONTROLS, maxScale: HOME_SCALE_DESKTOP })
      expectInside(v, DESKTOP, DESKTOP_CONTROLS, [id])
      const vis = visibleRect(v, DESKTOP.width / DESKTOP.height)
      expect(vis.x).toBeGreaterThanOrEqual(-1e-9)
      expect(vis.x + vis.w).toBeLessThanOrEqual(MAP_W + 1e-9)
    }
  })

  it('falls back to the widest view, centred on the network, when it spans the globe', () => {
    const ids = ['SIN', 'LHR', 'LAX', 'SYD', 'GRU']
    const v = homeViewFor({ points: ids.map(at), frame: DESKTOP, insets: DESKTOP_CONTROLS, maxScale: HOME_SCALE_DESKTOP })
    expect(v.w).toBe(MAP_W)
    // Wider than the cropped frame, so the visible part holds as much as it can
    // and stays on the world.
    const vis = visibleRect(v, DESKTOP.width / DESKTOP.height)
    expect(vis.x).toBeGreaterThanOrEqual(-1e-9)
    expect(vis.x + vis.w).toBeLessThanOrEqual(MAP_W + 1e-9)
  })

  it('opens a phone on the home region, a desktop on the world', () => {
    const ids = ['JFK', 'ORD', 'MIA', 'YYZ']
    const phone = homeViewFor({ points: ids.map(at), frame: PHONE, maxScale: HOME_SCALE_COMPACT })
    const desk = homeViewFor({ points: ids.map(at), frame: DESKTOP, maxScale: HOME_SCALE_DESKTOP })
    expect(MAP_W / phone.w).toBeCloseTo(HOME_SCALE_COMPACT)
    expect(MAP_W / desk.w).toBeCloseTo(HOME_SCALE_DESKTOP)
    expectInside(phone, PHONE, { left: 0, top: 0, right: 0, bottom: 0 }, ids)
    expectInside(desk, DESKTOP, { left: 0, top: 0, right: 0, bottom: 0 }, ids)
  })

  it('zooms out as far as it must to hold an ocean-spanning network on a phone', () => {
    const ids = ['JFK', 'LAX', 'LHR']
    const v = homeViewFor({ points: ids.map(at), frame: PHONE, maxScale: HOME_SCALE_COMPACT })
    expect(MAP_W / v.w).toBeLessThan(HOME_SCALE_COMPACT)
    expectInside(v, PHONE, { left: 0, top: 0, right: 0, bottom: 0 }, ids)
  })
})

describe('overlay insets', () => {
  const frame = { left: 100, top: 50, width: 1000, height: 600 }
  it('charges a tall column to the side and a wide box to the top', () => {
    const insets = overlayInsets(frame, [
      { left: 110, top: 60, width: 34, height: 200 }, // zoom column, top-left
      { left: 800, top: 60, width: 290, height: 36 }, // map colors, top-right
    ])
    expect(insets.left).toBe(44)
    expect(insets.top).toBe(46)
    expect(insets.right).toBe(0)
    expect(insets.bottom).toBe(0)
  })

  it('ignores overlays outside the frame and caps oversized ones', () => {
    const insets = overlayInsets(frame, [
      { left: 0, top: 0, width: 50, height: 50 },
      { left: 100, top: 50, width: 900, height: 590 },
    ])
    expect(insets.left + insets.top + insets.right + insets.bottom).toBeLessThanOrEqual(600 * 0.3 + 1000 * 0.3)
    expect(Math.max(insets.left, insets.right)).toBeLessThanOrEqual(300)
  })
})

describe('layer span', () => {
  const aspect = DESKTOP.width / DESKTOP.height
  const factor = MAP_W / MAP_H / aspect
  const view = (scale: number, centreX: number): ViewBox => {
    const w = MAP_W / scale
    const h = MAP_H / scale
    return clampView({ x: centreX - w / 2, y: MAP_H / 2 - h / 2, w, h }, aspect)
  }

  it('holds exactly the world for a centred low-zoom view, as it always did', () => {
    expect(layerSpan(view(2, MAP_W / 2), aspect)).toBeCloseTo(2 * factor)
    expect(layerSpan(view(1, MAP_W / 2), aspect)).toBeCloseTo(Math.max(SPAN_MIN, factor))
  })

  it('reaches the far edge when home is anchored off-centre', () => {
    const v = view(1.15, 0) // clamped against the Pacific edge
    const vis = visibleRect(v, aspect)
    const span = layerSpan(v, aspect)
    // The layer, centred on the view, extends to the world's east edge.
    expect(vis.x + vis.w / 2 + (span * vis.w) / 2).toBeGreaterThanOrEqual(MAP_W - 1e-6)
    expect(vis.x + vis.w / 2 - (span * vis.w) / 2).toBeLessThanOrEqual(1e-6)
  })

  it('falls back to the small overhang past the texture budget, and on tall frames', () => {
    expect(layerSpan(view(SPAN_WHOLE_WORLD_UP_TO + 0.5, MAP_W / 2), aspect)).toBe(SPAN_MIN)
    // Off-centre at a zoom a centred view could afford: still over budget.
    expect(layerSpan(view(2.4, 40), aspect)).toBe(SPAN_MIN)
    expect(layerSpan(view(1, MAP_W / 2), 1)).toBe(SPAN_MIN)
  })
})
