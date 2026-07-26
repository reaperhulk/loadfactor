import { describe, expect, it } from 'vitest'
import {
  GRID_FROM,
  placeLabels,
  type LabelAnchor,
  type LabelPlacement,
  type LabelSite,
} from '../labels'

// The reference: the same greedy pass, testing every candidate against every
// box already placed. Short, obviously correct, and quadratic — which is why
// it lives here and not in the map.
function placeLabelsNaive(sites: readonly LabelSite[], fs: number, gap: number): LabelPlacement[] {
  const leftEdge = (x: number, w: number, a: LabelAnchor): number =>
    a === 'start' ? x : a === 'end' ? x - w : x - w / 2
  const placed: { x1: number; y1: number; x2: number; y2: number }[] = []
  const out: LabelPlacement[] = []
  for (const s of sites) {
    const spots: { x: number; y: number; anchor: LabelAnchor }[] = [
      { x: s.x + s.r + gap, y: s.y + fs / 3, anchor: 'start' },
      { x: s.x - s.r - gap, y: s.y + fs / 3, anchor: 'end' },
      { x: s.x, y: s.y - s.r - gap, anchor: 'middle' },
      { x: s.x, y: s.y + s.r + fs, anchor: 'middle' },
    ]
    let pick = spots[0]!
    for (const spot of spots) {
      const x1 = leftEdge(spot.x, s.w, spot.anchor)
      const box = { x1, y1: spot.y - fs, x2: x1 + s.w, y2: spot.y }
      if (!placed.some((b) => box.x1 < b.x2 && box.x2 > b.x1 && box.y1 < b.y2 && box.y2 > b.y1)) {
        pick = spot
        break
      }
    }
    const px1 = leftEdge(pick.x, s.w, pick.anchor)
    placed.push({ x1: px1, y1: pick.y - fs, x2: px1 + s.w, y2: pick.y })
    out.push({ id: s.id, x: pick.x, y: pick.y, anchor: pick.anchor })
  }
  return out
}

// Deterministic pseudo-random layouts — the engine's no-Math.random rule is
// about reproducibility, and a test that fails only sometimes is worthless.
function layout(seed: number, n: number, spread: number): LabelSite[] {
  let s = seed >>> 0
  const next = (): number => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x100000000
  }
  return Array.from({ length: n }, (_, i) => ({
    id: `C${i}`,
    x: next() * spread,
    y: next() * spread * 0.36,
    r: 1.4 + next() * 2,
    w: (3 + Math.floor(next() * 3)) * 9 * 0.66,
  }))
}

describe('placeLabels', () => {
  it('places every label it is given, once', () => {
    const sites = layout(1, 60, 400)
    const out = placeLabels(sites, 9, 3)
    expect(out).toHaveLength(sites.length)
    expect(out.map((p) => p.id)).toEqual(sites.map((s) => s.id))
  })

  // placeLabels picks between a linear scan and a uniform grid by input size.
  // Pinning the threshold to 0 forces the grid and to Infinity forces the
  // scan, so both are checked at every size rather than only the one the
  // default happens to select.
  const BOTH: [string, number][] = [
    ['grid', 0],
    ['scan', Number.POSITIVE_INFINITY],
  ]

  it('matches the brute-force reference, both paths, across densities', () => {
    // Sparse enough that nothing collides, tight enough that everything does,
    // and the crowded middle where the anchor choice actually varies.
    for (const [name, gridFrom] of BOTH) {
      for (const spread of [60, 200, 600, 2000]) {
        for (let seed = 1; seed <= 12; seed++) {
          const sites = layout(seed, 90, spread)
          expect(
            placeLabels(sites, 9, 3, gridFrom),
            `${name}: seed ${seed} at spread ${spread}`,
          ).toEqual(placeLabelsNaive(sites, 9, 3))
        }
      }
    }
  })

  it('matches the brute-force reference, both paths, at the sizes that hurt', () => {
    // 148 labels is what 1.8x zoom actually produces: tier-3 cities unlocked,
    // frame still holding most of the world. 400 is past the threshold, where
    // the default takes the grid.
    for (const [name, gridFrom] of BOTH) {
      for (const n of [148, 400]) {
        for (const seed of [7, 21, 99]) {
          const sites = layout(seed, n, 900)
          expect(placeLabels(sites, 9, 3, gridFrom), `${name} at n=${n}, seed ${seed}`).toEqual(
            placeLabelsNaive(sites, 9, 3),
          )
        }
      }
    }
  })

  it('gives the same answer either side of the threshold it switches on', () => {
    // The switch must be invisible: a catalogue that grows past 200 cities
    // must not quietly move every label on the map.
    for (const n of [GRID_FROM - 1, GRID_FROM, GRID_FROM + 1]) {
      const sites = layout(4, n, 900)
      expect(placeLabels(sites, 9, 3, 0), `n=${n}`).toEqual(
        placeLabels(sites, 9, 3, Number.POSITIVE_INFINITY),
      )
    }
  })

  it('agrees when labels land exactly edge to edge', () => {
    // Boxes that share a boundary do not overlap, and cell borders are where
    // a grid is most likely to disagree with a scan.
    const fs = 10
    const w = 20
    const sites: LabelSite[] = Array.from({ length: 24 }, (_, i) => ({
      id: `E${i}`,
      x: (i % 6) * w,
      y: Math.floor(i / 6) * fs,
      r: 0,
      w,
    }))
    expect(placeLabels(sites, fs, 0, 0), 'grid').toEqual(placeLabelsNaive(sites, fs, 0))
    expect(placeLabels(sites, fs, 0, Number.POSITIVE_INFINITY), 'scan').toEqual(
      placeLabelsNaive(sites, fs, 0),
    )
  })

  it('gives a crowd of labels distinct boxes where it can', () => {
    // Six cities in a tidy row, far enough apart that all four anchors are
    // available: nothing should shingle.
    const sites: LabelSite[] = Array.from({ length: 6 }, (_, i) => ({
      id: `R${i}`,
      x: i * 120,
      y: 50,
      r: 2,
      w: 18,
    }))
    const out = placeLabels(sites, 9, 3)
    expect(new Set(out.map((p) => `${p.x},${p.y},${p.anchor}`)).size).toBe(sites.length)
  })

  it('does not blow up as the catalogue grows', () => {
    // Above the threshold the grid is what runs, so a 4x bigger input should
    // cost roughly 4x, not 16x. The bound is loose — this is a shape check on
    // a shared runner, not a benchmark — but it still catches the grid being
    // bypassed and the whole list being scanned again.
    const time = (n: number): number => {
      const sites = layout(5, n, 960)
      for (let i = 0; i < 200; i++) placeLabels(sites, 9, 3) // warm the JIT
      const t0 = performance.now()
      for (let i = 0; i < 50; i++) placeLabels(sites, 9, 3)
      return performance.now() - t0
    }
    const small = Math.max(time(300), 0.5)
    const big = time(1200)
    expect(
      big / small,
      `1200 labels took ${(big / small).toFixed(1)}x the time of 300`,
    ).toBeLessThan(10)
  })
})
