// The map's ground: ocean, graticule and land — the flat map's baked paths or
// the globe's re-projected geography (memoized on the globe view, coarse rings
// while it turns). Everything the network is drawn on top of.

import { useMemo } from 'react'
import { BORDERS_PATH, ISLETS_PATH, WORLD_PATH, WORLD_PATH_FINE } from '../../../data/worldmap.gen'
import type { GlobeGeometry } from '../../globeGeometry'
import { GLOBE_R, globeGraticule, globeLandPath, globeLinesPath, globeProjectFull, type GlobeView } from '../globe'
import { H, W, graticulePath } from '../projection'

export function useGlobeGeography({
  isGlobe,
  globe,
  rotating,
  globeGeometry,
}: {
  isGlobe: boolean
  globe: GlobeView
  rotating: boolean
  globeGeometry: GlobeGeometry | null
}) {
  const globeLand = useMemo(
    () =>
      isGlobe
        ? globeLandPath(globe, globe.s >= 1.8 && !rotating ? globeGeometry!.WORLD_RINGS_FINE : globeGeometry!.WORLD_RINGS)
        : '',
    [isGlobe, globe, rotating, globeGeometry],
  )

  // The rest of the globe's geography, memoized like the land: a render that
  // did not move the globe (selection, a lens, a quarter) re-projects nothing.
  const globeGrid = useMemo(() => (isGlobe ? globeGraticule(globe) : ''), [isGlobe, globe])
  const globeBorders = useMemo(
    () => (isGlobe && globe.s >= 1.35 && !rotating ? globeLinesPath(globe, globeGeometry!.BORDER_LINES) : ''),
    [isGlobe, globe, rotating, globeGeometry],
  )
  const globeIslets = useMemo(() => {
    if (!isGlobe) return null
    // The flat islet is r=1.6 in a map where 360 degrees is 960 units; the
    // globe's equator is 2*pi*R, so the same island is scaled by the ratio.
    const r = (1.6 * (2 * Math.PI * GLOBE_R * globe.s)) / W
    return globeGeometry!.ISLET_POINTS.map(([lon, lat]) => {
      const p = globeProjectFull(globe, lon, lat)
      if (p.cosc <= 0.001) return null
      return <circle key={`islet-${lon},${lat}`} cx={p.X} cy={p.Y} r={r} className="map-land map-islet" />
    })
  }, [isGlobe, globe, globeGeometry])
  return { globeLand, globeGrid, globeBorders, globeIslets }
}

export type GlobeGeography = ReturnType<typeof useGlobeGeography>

// Gradients pinned to the world, shared by the land and the sea.
export function MapDefs() {
  return (
    <defs>
      {/* Ocean depth: the abyssal plain is darker than the shelves, so the
          continents sit ON something instead of floating in flat black. */}
      {/* Pinned to the world, not to the rect that carries it: the sea
          rect overscans the frame (see below) and a bounding-box gradient
          would stretch and re-centre with it. */}
      <linearGradient id="landRelief" x1="0" y1="0" x2="0.25" y2="1">
        <stop offset="0" className="land-stop-light" />
        <stop offset="1" className="land-stop-base" />
      </linearGradient>
      <radialGradient
        id="seaDepth"
        gradientUnits="userSpaceOnUse"
        cx={W / 2}
        cy={H * 0.42}
        r={Math.max(W, H) * 0.78}
      >
        <stop offset="0%" className="sea-stop-shallow" />
        <stop offset="100%" className="sea-stop-deep" />
      </radialGradient>
    </defs>
  )
}

export function MapBackdrop({
  isGlobe,
  globe,
  rotating,
  uiScale,
  geography,
}: {
  isGlobe: boolean
  globe: GlobeView
  rotating: boolean
  uiScale: number
  geography: GlobeGeography
}) {
  const { globeLand, globeGrid, globeBorders, globeIslets } = geography
  return (
    <>
      {/* The sea overscans a whole frame on every side, for two reasons:
          `slice` scales the viewBox to COVER the element, so a container
          shaped differently from the viewBox — always, on the globe, whose
          viewBox is a fixed W x H — has visible area outside it; and the
          layer now bleeds past the frame so a drag reveals painted world.
          A sea of exactly W x H left both unpainted, and the globe sat in
          a black rectangle narrower than the window. */}
      <rect x={-W} y={-H} width={W * 3} height={H * 3} className="map-sea map-ocean" />
      {!isGlobe && <path d={graticulePath()} className="graticule map-graticule" />}
      {isGlobe ? (
        <>
          <defs>
            {/* A soft key light up-left: the disc reads as a sphere. */}
            <radialGradient id="globeShade" cx="38%" cy="32%" r="80%">
              <stop offset="0%" stopColor="#1b2a45" />
              <stop offset="70%" stopColor="#111b2e" />
              <stop offset="100%" stopColor="#0b111e" />
            </radialGradient>
            <radialGradient id="globeLighting" cx="32%" cy="25%" r="78%">
              <stop offset="0" stopColor="#d9f3ef" stopOpacity=".12" />
              <stop offset=".5" stopColor="#06121e" stopOpacity="0" />
              <stop offset="1" stopColor="#030b15" stopOpacity=".65" />
            </radialGradient>
            {/* Atmosphere: a thin band of scattered blue that peaks just
                outside the limb and fades both ways — a faint rim-light
                on the terrain's edge and a soft halo into space. The
                gradient is relative to the halo circle (1.12R), so the
                limb sits at 1/1.12 ≈ 0.893 of it. */}
            <radialGradient id="globeAtmosphere" cx="50%" cy="50%" r="50%">
              <stop offset=".80" stopColor="#8fc4ff" stopOpacity="0" />
              <stop offset=".875" stopColor="#8fc4ff" stopOpacity=".14" />
              <stop offset=".895" stopColor="#b9dcff" stopOpacity=".42" />
              <stop offset=".93" stopColor="#6aa8f0" stopOpacity=".16" />
              <stop offset="1" stopColor="#4a86d8" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx={W / 2} cy={H / 2} r={GLOBE_R * globe.s} fill="url(#globeShade)" className="globe-disc" />
          <path d={globeGrid} className="graticule" />
          {/* Same quality ladder as the flat map: coast glow under the
              land, fine coastline and borders past the same thresholds,
              islets for the airports whose islands do not survive 1:50m.
              The one concession is mid-rotation, where every frame is a
              full re-projection: coarse rings until the globe rests. */}
          <path d={globeLand} className="map-coast-glow" />
          <path d={globeLand} className="map-land" data-testid="globe-land" />
          {globe.s >= 1.35 && !rotating && (
            <path d={globeBorders} className="map-border" />
          )}
          {globeIslets}
          <circle cx={W / 2} cy={H / 2} r={GLOBE_R * globe.s} fill="url(#globeLighting)" pointerEvents="none" />
          <circle cx={W / 2} cy={H / 2} r={GLOBE_R * globe.s * 1.12} fill="url(#globeAtmosphere)" className="globe-atmosphere" data-testid="globe-atmosphere" pointerEvents="none" />
          <circle cx={W / 2} cy={H / 2} r={GLOBE_R * globe.s} className="globe-limb" />
        </>
      ) : (
        <>
          {/* The coast's glow is GEOMETRY, not a filter: the same path
              stroked wide underneath, and the land drawn over its inner
              half leaves a halo. It used to be an SVG drop-shadow, and an
              SVG filter's region is the bounding box of the whole world —
              WebKit re-runs that blur on every re-raster of the layer,
              which measured as the difference between a 186ms and a 46ms
              worst frame during a drag. A stroke is just another path
              pass, cheap on every engine, and at 2.5 non-scaling pixels
              it reads the same. */}
          <path d={uiScale >= 1.8 ? WORLD_PATH_FINE : WORLD_PATH} className="map-coast-glow" />
          {/* Detail that resolves: the coarse coastline is a smear at 3x,
              and the fine one is wasted bytes of curve at world view. The
              swap happens at a committed render, once per threshold
              crossing — never mid-gesture. */}
          <path d={uiScale >= 1.8 ? WORLD_PATH_FINE : WORLD_PATH} className="map-land" />
          {/* Country borders come from a separate mesh, so they are the
              borders themselves and never a second copy of the coast. */}
          {uiScale >= 1.35 && <path d={BORDERS_PATH} className="map-border" />}
          {/* Islands with an airport but too small to survive 1:50m
              generalisation — without these, Guam is an airport in open
              ocean. */}
          <path d={ISLETS_PATH} className="map-land map-islet" />
        </>
      )}
    </>
  )
}
