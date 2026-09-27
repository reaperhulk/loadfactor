import { describe, expect, it, vi } from 'vitest'
import { OCCLUDED_ALPHA, PLANE_SCALE_WORLD, cameraAffine, contrailPoints, drawTraffic, occlusionFade, planeScaleForZoom, polylineLeg, posePlane, quadraticLeg, type TrafficEffect } from '../traffic'

describe('traffic shuttles', () => {
  const leg = quadraticLeg(0, 0, 50, -20, 100, 0)

  it('samples the arc with monotone cumulative length', () => {
    expect(leg.pts.length).toBe(34)
    for (let i = 1; i < leg.cum.length; i++) expect(leg.cum[i]!).toBeGreaterThan(leg.cum[i - 1]!)
    const total = leg.cum[leg.cum.length - 1]!
    expect(total).toBeGreaterThan(100)
    expect(total).toBeLessThan(120)
  })

  it('flies out, dwells, flies back nose-first, dwells', () => {
    const start = posePlane(leg, 0)
    expect(start.x).toBeCloseTo(0)
    expect(start.y).toBeCloseTo(0)
    expect(Math.cos(start.heading)).toBeGreaterThan(0) // heading east
    const far = posePlane(leg, 0.47) // dwelling at the far end
    expect(far.x).toBeCloseTo(100)
    expect(Math.cos(far.heading)).toBeGreaterThan(0) // still facing the way it came
    const back = posePlane(leg, 0.7)
    expect(back.x).toBeGreaterThan(20)
    expect(back.x).toBeLessThan(80)
    expect(Math.cos(back.heading)).toBeLessThan(0) // heading west
    const home = posePlane(leg, 0.97)
    expect(home.x).toBeCloseTo(0)
    expect(Math.cos(home.heading)).toBeLessThan(0)
    // Progress wraps: cycle 3.25 sits where 0.25 does.
    expect(posePlane(leg, 3.25)).toEqual(posePlane(leg, 0.25))
  })

  it('paces by arc length, not parameter', () => {
    const straight = polylineLeg(new Float64Array([0, 0, 10, 0, 100, 0]))
    expect(posePlane(straight, 0.225).x).toBeCloseTo(50) // halfway out in distance
  })

  it('maps world to CSS through a slice fit and the layer transform', () => {
    const vb = { x: 0, y: 0, w: 300, h: 110 }
    const at = cameraAffine({ vb, fw: 600, fh: 220, tx: 0, ty: 0, s: 1 })
    expect(at.a).toBe(2)
    expect(at.ex).toBe(0)
    expect(at.ey).toBe(0)
    // A taller frame slices: the surplus splits either side.
    const tall = cameraAffine({ vb, fw: 600, fh: 300, tx: 0, ty: 0, s: 1 })
    expect(tall.a).toBeCloseTo(300 / 110)
    expect(tall.ex).toBeCloseTo((600 - 300 * (300 / 110)) / 2)
    expect(tall.ey).toBe(0)
    // A 2× layer scale about the frame centre with no translation keeps the
    // centre pinned and doubles distances from it.
    const zoomed = cameraAffine({ vb, fw: 600, fh: 220, tx: 0, ty: 0, s: 2 })
    expect(zoomed.a * 150 + zoomed.ex).toBeCloseTo(300)
    expect(zoomed.a * 0 + zoomed.ex).toBeCloseTo(-300)
    // A pure pan of the layer moves everything by the same pixels.
    const panned = cameraAffine({ vb, fw: 600, fh: 220, tx: 30, ty: -10, s: 1 })
    expect(panned.ex).toBe(30)
    expect(panned.ey).toBe(-10)
  })

  it('draws every kind of sprite through a recording context', () => {
    vi.stubGlobal('Path2D', class { constructor(public d: string) {} toString() { return `Path2D(${this.d})` } })
    const calls: string[] = []
    const ctx = new Proxy({} as CanvasRenderingContext2D, {
      get: (_t, key: string) => (...args: unknown[]) => { calls.push(key + (args.length ? `(${args.map((a) => typeof a === 'number' ? Math.round(a) : String(a)).join(',')})` : '')) },
      set: () => true,
    })
    const effects: TrafficEffect[] = [
      { kind: 'sweep', x: 10, y: 10, r: 5, width: 1.6, color: '#ffd166', period: 6 },
      { kind: 'breathe', x: 20, y: 10, r: 12, width: 2, color: '#e06c6c', period: 2.2 },
      { kind: 'march', leg, width: 2.4, color: '#d0636e' },
    ]
    const plane = { leg, dur: 10, phase: 0, glyph: 'M0 0L1 0Z', size: 1, fill: '#fff', stroke: '#000', alpha: 1 }
    drawTraffic(ctx, [plane], effects, { vb: { x: 0, y: 0, w: 300, h: 110 }, fw: 300, fh: 110, tx: 0, ty: 0, s: 1 }, 1, 0)
    expect(calls[0]).toBe('setTransform(1,0,0,1,0,0)')
    expect(calls[1]).toBe('clearRect(0,0,300,110)')
    expect(calls.filter((c) => c.startsWith('arc(')).length).toBe(2)
    expect(calls.filter((c) => c.startsWith('setLineDash(')).length).toBe(2) // on, then off
    expect(calls.filter((c) => c.startsWith('fill(')).length).toBe(1)
    // The plane sits at the leg's start, nose east: an unrotated unit transform there.
    expect(calls.at(-1)).toBe('fill(Path2D(M0 0L1 0Z))')
    vi.unstubAllGlobals()
    expect(calls).toContain('setTransform(1,0,0,1,0,0)')
  })
})

describe('traffic at world zoom', () => {
  it('grows the glyphs modestly as the map zooms out, never below base size', () => {
    expect(planeScaleForZoom(1)).toBeCloseTo(PLANE_SCALE_WORLD)
    expect(planeScaleForZoom(0.5)).toBeCloseTo(PLANE_SCALE_WORLD) // clamped
    expect(planeScaleForZoom(3)).toBe(1)
    expect(planeScaleForZoom(4)).toBe(1)
    let prev = Infinity
    for (let z = 1; z <= 4; z += 0.25) {
      const s = planeScaleForZoom(z)
      expect(s).toBeLessThanOrEqual(prev)
      expect(s).toBeGreaterThanOrEqual(1)
      prev = s
    }
    expect(PLANE_SCALE_WORLD).toBeLessThanOrEqual(1.5) // "modestly"
  })

  it('trails a short wake behind a moving plane, none at the gate', () => {
    const leg = polylineLeg(new Float64Array([0, 0, 100, 0]))
    const plane = { leg, dur: 10, phase: 0, glyph: 'M0 0Z', size: 1, fill: '#fff', stroke: '#000', alpha: 1 }
    // Mid-flight eastbound: every wake point is behind (west of) the plane,
    // oldest farthest back.
    const now = posePlane(leg, 2 / 10)
    const wake = contrailPoints(plane, 2)
    expect(wake.length).toBeGreaterThan(1)
    let last = now.x
    for (const p of wake) {
      expect(p.x).toBeLessThan(last)
      last = p.x
    }
    // Wake length is a fraction of the leg, not a streak across the map.
    expect(now.x - wake.at(-1)!.x).toBeLessThan(20)
    // Dwelling at the far end (4.5s-5s of the cycle): where it stood still,
    // the wake collapses onto the plane — nothing is drawn for a parked jet.
    const dwell = contrailPoints(plane, 4.95)
    expect(dwell[0]!.x).toBeCloseTo(100)
    expect(dwell[1]!.x).toBeCloseTo(100)
  })
})

describe('planes give way to city names', () => {
  const box = { x1: 100, y1: 50, x2: 120, y2: 58 }

  it('fades a plane over a label and restores it clear of one', () => {
    expect(occlusionFade(110, 54, [box], 6)).toBe(OCCLUDED_ALPHA)
    expect(occlusionFade(200, 54, [box], 6)).toBe(1)
    expect(occlusionFade(110, 54, [], 6)).toBe(1)
    // Easing in over the reach: closer is fainter, never below the floor.
    const near = occlusionFade(122, 54, [box], 6)
    const nearer = occlusionFade(121, 54, [box], 6)
    expect(nearer).toBeLessThan(near)
    expect(near).toBeLessThan(1)
    expect(nearer).toBeGreaterThan(OCCLUDED_ALPHA)
    // The nearest of several boxes decides.
    expect(occlusionFade(130, 54, [box, { x1: 129, y1: 50, x2: 140, y2: 58 }], 6)).toBe(OCCLUDED_ALPHA)
  })

  it('draws the plane over a label at the faded alpha', () => {
    vi.stubGlobal('Path2D', class { constructor(public d: string) {} })
    const alphas: number[] = []
    const ctx = new Proxy({} as CanvasRenderingContext2D, {
      get: () => () => {},
      set: (_t, key, value) => {
        if (key === 'globalAlpha') alphas.push(value as number)
        return true
      },
    })
    const leg = polylineLeg(new Float64Array([110, 54, 300, 54]))
    const plane = { leg, dur: 10, phase: 0, glyph: 'M0 0Z', size: 0.6, fill: '#fff', stroke: '#000', alpha: 1 }
    const camera = { vb: { x: 0, y: 0, w: 400, h: 150 }, fw: 400, fh: 150, tx: 0, ty: 0, s: 1 }
    drawTraffic(ctx, [plane], [], camera, 1, 0, [box])
    // The last alpha set before the glyph is the plane's own.
    expect(alphas.at(-2)).toBeCloseTo(OCCLUDED_ALPHA)
    alphas.length = 0
    drawTraffic(ctx, [plane], [], camera, 1, 0)
    expect(alphas.at(-2)).toBe(1)
    vi.unstubAllGlobals()
  })

  it('keeps the world-zoom glyph small enough to sit beside a label', () => {
    // The biggest airframe at world zoom: 0.68 glyph units per px, ~28 units
    // long. It must stay well under the 45px it used to reach.
    expect(28 * 0.68 * PLANE_SCALE_WORLD).toBeLessThan(24)
  })
})
