// City label placement.
//
// Greedy, in the order the caller supplies (mass first, so majors claim the
// best slot): each label tries the right-hand slot, then left, then above,
// then below, taking the first that does not overlap a label already placed.
// A label that finds no free slot is placed right anyway — a shingled name is
// better than a missing one.
//
// The collision test comes in two shapes, and which one is faster is not the
// one the big-O suggests. Scanning every label already placed is quadratic;
// bucketing them into a uniform grid and testing a candidate only against the
// cells it spans is linear. Measured, per placement pass:
//
//     labels     scan        grid
//        42    0.0045ms    0.0105ms
//       148    0.0244ms    0.0329ms
//       300    0.2012ms    0.0627ms
//       600    1.0316ms    0.2073ms
//      1200    3.9616ms    0.6584ms
//
// The scan wins below ~200, because a rectangle test is four comparisons and
// it stops at the first clash, while the grid pays for a Map and for
// inserting each box into every cell it touches. This map's worst case is
// ~150 labels (1.8x zoom: tier-3 cities unlocked, frame still holding most of
// the world) — comfortably in scan territory, and 24us, which is a tenth of a
// percent of one re-raster. So the quadratic pass was never the bottleneck it
// looks like, and the grid only earns its keep if the catalogue grows: the
// map has already gone from 80 cities to 165 once.
//
// Both are therefore kept, chosen by size. They are interchangeable because
// the grid is exact, not approximate: if two boxes overlap, their intersection
// is a non-empty region, and whichever cell that region lies in is touched by
// both boxes, so both are registered there and the clash is found. Placements
// come out identical label for label, which labels.test.ts checks against a
// brute-force reference over random layouts — down BOTH paths.

export type LabelAnchor = 'start' | 'end' | 'middle'

export interface LabelSite {
  id: string
  x: number // marker centre, in viewBox units
  y: number
  r: number // marker radius, so the label clears the dot
  w: number // rendered width of the label
}

export interface LabelPlacement {
  id: string
  x: number
  y: number
  anchor: LabelAnchor
}

interface Box {
  x1: number
  y1: number
  x2: number
  y2: number
}

const overlaps = (a: Box, b: Box): boolean =>
  a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1

// Where a label's box starts, given the anchor it hangs from.
const leftEdge = (x: number, w: number, anchor: LabelAnchor): number =>
  anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2

// Where the grid starts paying, from the table above. Not a cliff — the two
// are within a third of each other on either side of it — so it needs no
// precision, only to be in the right place.
export const GRID_FROM = 200

// How many box-vs-box comparisons a pass made. This is what separates the two
// strategies, and unlike a stopwatch it is the same number on every machine —
// so the test that guards the grid can assert on it without ever depending on
// how loaded the runner is.
export interface PlaceStats {
  comparisons: number
}

export function placeLabels(
  sites: readonly LabelSite[],
  fs: number, // font size, and the height of a label box
  gap: number, // clearance between a marker and its name
  gridFrom: number = GRID_FROM, // tests pin this to exercise both paths
  stats?: PlaceStats,
): LabelPlacement[] {
  // Cells sized against the type: a label is at most ~5 characters of 0.66em,
  // so a box spans no more than two cells on either axis and the work per
  // candidate stays constant however many labels are on screen.
  const cell = Math.max(fs * 4, Number.MIN_VALUE)
  const grid = sites.length >= gridFrom ? new Map<number, Box[]>() : null
  const flat: Box[] = []
  // Cell coordinates are small (the world is 960 units and a cell is a few
  // units across), so packing them into one number is safe and beats the
  // string keys a Map of `${ix},${iy}` would allocate per lookup.
  const key = (ix: number, iy: number): number => ix * 1e7 + iy

  let comparisons = 0
  const clashes = (b: Box): boolean => {
    if (grid === null) {
      for (const other of flat) {
        comparisons++
        if (overlaps(b, other)) return true
      }
      return false
    }
    const ix1 = Math.floor(b.x2 / cell)
    const iy1 = Math.floor(b.y2 / cell)
    for (let ix = Math.floor(b.x1 / cell); ix <= ix1; ix++) {
      for (let iy = Math.floor(b.y1 / cell); iy <= iy1; iy++) {
        const bucket = grid.get(key(ix, iy))
        if (bucket === undefined) continue
        for (const other of bucket) {
          comparisons++
          if (overlaps(b, other)) return true
        }
      }
    }
    return false
  }

  const keep = (b: Box): void => {
    if (grid === null) {
      flat.push(b)
      return
    }
    const ix1 = Math.floor(b.x2 / cell)
    const iy1 = Math.floor(b.y2 / cell)
    for (let ix = Math.floor(b.x1 / cell); ix <= ix1; ix++) {
      for (let iy = Math.floor(b.y1 / cell); iy <= iy1; iy++) {
        const k = key(ix, iy)
        const bucket = grid.get(k)
        if (bucket === undefined) grid.set(k, [b])
        else bucket.push(b)
      }
    }
  }

  const out: LabelPlacement[] = []
  for (const site of sites) {
    const spots: { x: number; y: number; anchor: LabelAnchor }[] = [
      { x: site.x + site.r + gap, y: site.y + fs / 3, anchor: 'start' },
      { x: site.x - site.r - gap, y: site.y + fs / 3, anchor: 'end' },
      { x: site.x, y: site.y - site.r - gap, anchor: 'middle' },
      { x: site.x, y: site.y + site.r + fs, anchor: 'middle' },
    ]
    let pick = spots[0]!
    for (const spot of spots) {
      const x1 = leftEdge(spot.x, site.w, spot.anchor)
      if (!clashes({ x1, y1: spot.y - fs, x2: x1 + site.w, y2: spot.y })) {
        pick = spot
        break
      }
    }
    const px1 = leftEdge(pick.x, site.w, pick.anchor)
    keep({ x1: px1, y1: pick.y - fs, x2: px1 + site.w, y2: pick.y })
    out.push({ id: site.id, x: pick.x, y: pick.y, anchor: pick.anchor })
  }
  if (stats !== undefined) stats.comparisons = comparisons
  return out
}
