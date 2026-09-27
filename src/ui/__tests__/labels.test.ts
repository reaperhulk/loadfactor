import { describe, expect, it } from 'vitest'
import {
  GRID_FROM,
  labelBox,
  labelSpots,
  overlaps,
  placeLabels,
  type LabelPlacement,
  type LabelSite,
} from '../labels'

// The reference: the same greedy pass, testing every candidate against every
// box already placed. Short, obviously correct, and quadratic — which is why
// it lives here and not in the map.
function placeLabelsNaive(sites: readonly LabelSite[], fs: number, gap: number): LabelPlacement[] {
  const placed: { x1: number; y1: number; x2: number; y2: number }[] = []
  const out: LabelPlacement[] = []
  for (const s of sites) {
    const spots = labelSpots(s, fs, gap)
    let pick = spots[0]!
    let fit = false
    for (const spot of spots) {
      const box = labelBox(spot, s.w, fs)
      if (!placed.some((b) => box.x1 < b.x2 && box.x2 > b.x1 && box.y1 < b.y2 && box.y2 > b.y1)) {
        pick = spot
        fit = true
        break
      }
    }
    if (!fit && s.optional === true) continue
    placed.push(labelBox(pick, s.w, fs))
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

  it('does the work the grid promises, not the scan\'s', () => {
    // Counted, not timed: a wall-clock ratio makes the result depend on how
    // busy the runner is, and this suite runs alongside multi-career
    // simulations. Comparisons are the same number on every machine.
    const sites = layout(5, 1200, 960)
    const grid = { comparisons: 0 }
    const scan = { comparisons: 0 }
    placeLabels(sites, 9, 3, 0, grid)
    placeLabels(sites, 9, 3, Number.POSITIVE_INFINITY, scan)
    expect(
      grid.comparisons,
      `grid made ${grid.comparisons} comparisons, scan ${scan.comparisons}`,
    ).toBeLessThan(scan.comparisons / 10)
    // And both still land on the same answer, which is the point of having
    // two of them at all.
    expect(placeLabels(sites, 9, 3, 0)).toEqual(
      placeLabels(sites, 9, 3, Number.POSITIVE_INFINITY),
    )
  })

  it('drops an optional label that finds no free slot, and keeps a required one', () => {
    // Four labels boxed in around one marker leave no slot for a fifth.
    const ring: LabelSite[] = [
      { id: 'E', x: 100, y: 100, r: 2, w: 20 },
      { id: 'W', x: 100, y: 100, r: 2, w: 20 },
      { id: 'N', x: 100, y: 100, r: 2, w: 20 },
      { id: 'S', x: 100, y: 100, r: 2, w: 20 },
    ]
    const required = placeLabels([...ring, { id: 'X', x: 100, y: 100, r: 2, w: 20 }], 9, 3)
    expect(required.map((p) => p.id)).toEqual(['E', 'W', 'N', 'S', 'X'])
    const optional = placeLabels([...ring, { id: 'X', x: 100, y: 100, r: 2, w: 20, optional: true }], 9, 3)
    expect(optional.map((p) => p.id)).toEqual(['E', 'W', 'N', 'S'])
    // With room to spare an optional label is placed like any other.
    expect(placeLabels([{ id: 'Y', x: 300, y: 300, r: 2, w: 20, optional: true }], 9, 3)).toHaveLength(1)
  })
})

describe('label collision avoidance', () => {
  it('never lets two optional labels overlap, at any density', () => {
    for (const spread of [60, 200, 600, 2000]) {
      for (let seed = 1; seed <= 12; seed++) {
        const sites = layout(seed, 90, spread).map((s) => ({ ...s, optional: true }))
        const byId = new Map(sites.map((s) => [s.id, s]))
        const boxes = placeLabels(sites, 9, 3).map((p) => labelBox(p, byId.get(p.id)!.w, 9))
        for (let i = 0; i < boxes.length; i++) {
          for (let j = i + 1; j < boxes.length; j++) {
            expect(overlaps(boxes[i]!, boxes[j]!), `seed ${seed}, spread ${spread}: labels ${i} and ${j}`).toBe(false)
          }
        }
      }
    }
  })

  it('moves a crowded name to another side before giving up on it', () => {
    // GIG sits just above GRU: GRU's right-hand slot is taken by GIG's name,
    // so GRU hangs off another side of its own marker instead.
    const sites: LabelSite[] = [
      { id: 'GRU', x: 100, y: 104, r: 2, w: 20, optional: true },
      { id: 'GIG', x: 101, y: 98, r: 2, w: 20, optional: true },
    ]
    const out = placeLabels(sites, 9, 3)
    expect(out.map((p) => p.id)).toEqual(['GRU', 'GIG'])
    expect(out[0]!.anchor).toBe('start')
    expect(out[1]!.anchor).not.toBe('start')
    expect(overlaps(labelBox(out[0]!, 20, 9), labelBox(out[1]!, 20, 9))).toBe(false)
  })

  it('gives the slot to the earlier (more important) city and hides the later one', () => {
    // Three names on one marker's worth of space: whoever comes first in the
    // priority order keeps its best slot; the rest take what is left, and a
    // name with nowhere to go is hidden rather than drawn over another.
    const hub = { x: 200, y: 200, r: 2, w: 8, optional: true }
    const ring: LabelSite[] = ['A', 'B', 'C', 'D', 'E'].map((id) => ({ id, ...hub }))
    const out = placeLabels(ring, 9, 3)
    expect(out.map((p) => p.id)).toEqual(['A', 'B', 'C', 'D'])
    expect(out.map((p) => p.anchor)).toEqual(['start', 'end', 'middle', 'middle'])
  })

  it('boxes a label by its font box, so above and below clear the marker', () => {
    const site: LabelSite = { id: 'X', x: 0, y: 0, r: 2, w: 20 }
    const [right, , above, below] = labelSpots(site, 10, 3).map((p) => labelBox(p, 20, 10))
    expect(right!.x1).toBeCloseTo(5)
    // The capitals' middle sits on the marker's centre line.
    expect((right!.y1 + right!.y2) / 2).toBeLessThan(1)
    expect((right!.y1 + right!.y2) / 2).toBeGreaterThan(-1)
    expect(above!.y2).toBeCloseTo(-5)
    expect(below!.y1).toBeCloseTo(5)
  })
})

describe('spreadLabels', () => {
  it('pushes close labels apart, keeps order, and stays inside the band', async () => {
    const { spreadLabels } = await import('../Sparkline')
    expect(spreadLabels([50, 52, 30], 8, 118, 9)).toEqual([50, 59, 30])
    // Crowded at the bottom: the stack closes upward from the edge.
    expect(spreadLabels([117, 118, 116], 8, 118, 9)).toEqual([109, 118, 100])
    // A series without a line is left alone.
    expect(spreadLabels([40, Number.NaN, 41], 8, 118, 9)).toEqual([40, Number.NaN, 49])
  })
})
