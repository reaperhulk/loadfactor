// Authoring-time codegen: the real world, projected to the map viewport.
//
// Source is Natural Earth via the `world-atlas` package (public domain):
// land-50m for the coastline and countries-50m for internal borders. Taking
// land and borders from SEPARATE datasets matters — the old generator filled
// one path per country, so every shared border was drawn twice and what looked
// like a coastline was really a pile of country outlines.
//
// The projection constants are EMITTED into the generated module and imported
// by MapView, so the geometry and the renderer cannot drift apart. Run
// `npm run gen:worldmap` after changing any of them.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { feature, mesh } from 'topojson-client'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const landTopo = JSON.parse(readFileSync(join(root, 'node_modules/world-atlas/land-50m.json'), 'utf8'))
const countryTopo = JSON.parse(
  readFileSync(join(root, 'node_modules/world-atlas/countries-50m.json'), 'utf8'),
)

// Equirectangular, cropped to the latitudes the game actually uses. The full
// -90..90 range spends a third of the viewport on the Southern Ocean and the
// Arctic; cropping to 76..-56 keeps every city (northernmost 60.3N,
// southernmost 43.5S), all of inhabited Eurasia, and Cape Horn, with no empty
// bands. Width and height then carry the same degrees per pixel, so shapes
// are undistorted.
const LAT_MAX = 76
const LAT_MIN = -56
const W = 960
const H = Math.round((W * (LAT_MAX - LAT_MIN)) / 360)

const px = (lon) => ((lon + 180) / 360) * W
const py = (lat) => ((LAT_MAX - lat) / (LAT_MAX - LAT_MIN)) * H

// Douglas–Peucker in projected pixel space: tolerance then means the same
// thing everywhere on screen, which is what a viewer actually perceives.
function simplify(points, tolerance) {
  if (points.length < 3) return points
  const keep = new Array(points.length).fill(false)
  keep[0] = keep[points.length - 1] = true
  const stack = [[0, points.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()
    const [ax, ay] = points[a]
    const [bx, by] = points[b]
    const dx = bx - ax
    const dy = by - ay
    const norm = Math.hypot(dx, dy)
    let maxDist = -1
    let maxIdx = -1
    for (let i = a + 1; i < b; i++) {
      const [x, y] = points[i]
      const dist =
        norm < 1e-6
          ? Math.hypot(x - ax, y - ay)
          : Math.abs(dy * x - dx * y + bx * ay - by * ax) / norm
      if (dist > maxDist) {
        maxDist = dist
        maxIdx = i
      }
    }
    if (maxDist > tolerance) {
      keep[maxIdx] = true
      stack.push([a, maxIdx], [maxIdx, b])
    }
  }
  return points.filter((_, i) => keep[i])
}

// A ring crossing the antimeridian would otherwise draw a band straight across
// the map (Chukotka and Fiji both do it). Split into runs wherever a segment
// jumps more than half the world.
function splitAtSeam(points) {
  const runs = []
  let run = []
  for (let i = 0; i < points.length; i++) {
    if (i > 0 && Math.abs(points[i][0] - points[i - 1][0]) > W / 2) {
      if (run.length > 1) runs.push(run)
      run = []
    }
    run.push(points[i])
  }
  if (run.length > 1) runs.push(run)
  return runs
}

// Latitudes outside the crop are clamped to its edge rather than dropped, so
// Greenland and Siberia end in a clean cut at the frame instead of tearing.
const projectRing = (ring) =>
  ring.map(([lon, lat]) => [px(lon), py(Math.max(LAT_MIN, Math.min(LAT_MAX, lat)))])

// Rings entirely below the crop (Antarctica, South Sandwich) would contribute
// nothing but a bar along the bottom edge.
const aboveCrop = (ring) => ring.some(([, lat]) => lat > LAT_MIN + 0.5)

function ringsOf(geometry) {
  const out = []
  const walk = (geom) => {
    if (!geom) return
    if (geom.type === 'Polygon') out.push(...geom.coordinates)
    else if (geom.type === 'MultiPolygon') for (const poly of geom.coordinates) out.push(...poly)
    else if (geom.type === 'GeometryCollection') geom.geometries.forEach(walk)
  }
  walk(geometry)
  return out
}

function linesOf(geometry) {
  if (geometry.type === 'MultiLineString') return geometry.coordinates
  if (geometry.type === 'LineString') return [geometry.coordinates]
  return []
}

const landGeo = feature(landTopo, landTopo.objects.land)
const allLandRings = ringsOf(
  landGeo.geometry ?? { type: 'GeometryCollection', geometries: landGeo.features.map((f) => f.geometry) },
)
const landRings = allLandRings.filter(aboveCrop)

// Two levels of detail: the world view cannot resolve what a 4x zoom needs,
// and keeping the fine path out of the DOM until it is resolvable is most of
// the map's render cost.
function landPath(tolerance, minPoints) {
  const parts = []
  for (const ring of landRings) {
    for (const run of splitAtSeam(projectRing(ring))) {
      const simplified = simplify(run, tolerance)
      if (simplified.length < minPoints) continue
      parts.push(`M${simplified.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join('L')}Z`)
    }
  }
  return parts.join('')
}

const WORLD_PATH = landPath(0.7, 6)
const WORLD_PATH_FINE = landPath(0.18, 5)

// Internal borders only: topojson's mesh with a !== b keeps just the arcs
// shared by two countries, so coastlines are not drawn twice.
const borderMesh = mesh(countryTopo, countryTopo.objects.countries, (a, b) => a !== b)
const borderParts = []
for (const line of linesOf(borderMesh)) {
  const projected = line
    .filter(([, lat]) => lat > LAT_MIN)
    .map(([lon, lat]) => [px(lon), py(Math.max(LAT_MIN, Math.min(LAT_MAX, lat)))])
  if (projected.length < 2) continue
  for (const run of splitAtSeam(projected)) {
    const simplified = simplify(run, 0.5)
    if (simplified.length < 2) continue
    borderParts.push(`M${simplified.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join('L')}`)
  }
}
const BORDERS_PATH = borderParts.join('')

// Islets: some airports sit on islands too small to survive 1:50m generalisation
// (Guam is the standing example). Dropping them would leave an airport floating
// in open ocean, so the generator finds every city with no land under it and
// emits a small isle there. Self-maintaining — add a Pacific city and its island
// appears with it.
const cities = JSON.parse(readFileSync(join(root, 'src/data/cities.json'), 'utf8'))
const finePolys = []
for (const ring of landRings) {
  for (const run of splitAtSeam(projectRing(ring))) {
    const simplified = simplify(run, 0.18)
    if (simplified.length >= 5) finePolys.push(simplified)
  }
}
function onLand(px0, py0) {
  for (const ring of finePolys) {
    let inside = false
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]
      const [xj, yj] = ring[j]
      if (yi > py0 !== yj > py0 && px0 < ((xj - xi) * (py0 - yi)) / (yj - yi) + xi) inside = !inside
    }
    if (inside) return true
    for (const [vx, vy] of ring) if (Math.hypot(vx - px0, vy - py0) <= 3) return true
  }
  return false
}
const isletParts = []
const islets = []
for (const c of cities) {
  const cx = px(c.lon)
  const cy = py(c.lat)
  if (onLand(cx, cy)) continue
  islets.push(c.id)
  const r = 1.6
  isletParts.push(
    `M${(cx - r).toFixed(1)},${cy.toFixed(1)}` +
      `a${r},${r} 0 1,0 ${(r * 2).toFixed(1)},0` +
      `a${r},${r} 0 1,0 ${(-r * 2).toFixed(1)},0Z`,
  )
}
const ISLETS_PATH = isletParts.join('')

// The globe re-projects every frame, so it needs lon/lat rings rather than a
// baked path — and it keeps Antarctica, because a sphere has a south pole.
const SPHERE_TOLERANCE_DEG = 0.35
const sphereRings = []
for (const ring of allLandRings) {
  const simplified = simplify(ring, SPHERE_TOLERANCE_DEG)
  if (simplified.length >= 6) {
    sphereRings.push(simplified.map(([lon, lat]) => [Math.round(lon * 10) / 10, Math.round(lat * 10) / 10]))
  }
}
const ringsJson = JSON.stringify(sphereRings)

const out = `// GENERATED by tools/gen-worldmap.mjs — do not edit by hand.
// Natural Earth 1:50m land and country borders (public domain, via the
// world-atlas package), projected to the map viewport.

// The projection, emitted with the geometry so the renderer cannot drift from
// the data it is drawing: equirectangular, cropped to the inhabited latitudes.
export const MAP_W = ${W}
export const MAP_H = ${H}
export const MAP_LAT_MAX = ${LAT_MAX}
export const MAP_LAT_MIN = ${LAT_MIN}

export const projectLon = (lon: number): number => ((lon + 180) / 360) * MAP_W
export const projectLat = (lat: number): number =>
  ((MAP_LAT_MAX - lat) / (MAP_LAT_MAX - MAP_LAT_MIN)) * MAP_H

// Coastline, filled. FINE carries roughly 4x the detail, for zoomed views.
export const WORLD_PATH = '${WORLD_PATH}'
export const WORLD_PATH_FINE = '${WORLD_PATH_FINE}'

// Country borders that are NOT coastline — hairlines drawn over the land.
export const BORDERS_PATH = '${BORDERS_PATH}'

// Islands carrying an airport but too small to survive generalisation.
export const ISLETS_PATH = '${ISLETS_PATH}'
export const ISLET_CITIES: readonly string[] = ${JSON.stringify(islets)}

// The same landmass as [lon, lat] rings (Antarctica included) for the globe
// projection, which re-projects at render time.
export const WORLD_RINGS: readonly (readonly (readonly [number, number])[])[] = ${ringsJson}
`
writeFileSync(join(root, 'src/data/worldmap.gen.ts'), out)
console.log(
  `land ${Math.round(WORLD_PATH.length / 1024)}KB (fine ${Math.round(WORLD_PATH_FINE.length / 1024)}KB) · ` +
    `borders ${Math.round(BORDERS_PATH.length / 1024)}KB · globe ${sphereRings.length} rings ` +
    `(${Math.round(ringsJson.length / 1024)}KB) · viewport ${W}x${H}`,
)
