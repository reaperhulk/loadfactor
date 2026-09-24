// SVG world map: real landmass under an equirectangular projection, cities as
// dots with zoom-dependent level of detail, routes as lifted arcs whose look
// tells you short-haul from long-haul at a glance. Presentation-only floats
// are fine here — the engine never sees screen coordinates.
//
// This file composes the map; the pieces live in ./map/:
//   camera.ts, projection.ts, globe.ts   pure camera, flat and globe math
//   useMapCamera.ts                      view state, layer transform, eases
//   useMapGestures.ts, useMapKeyboard.ts pointer/wheel/touch and keyboard input
//   layers/                              the drawn layers and the map's chrome

import { useMemo, useRef, useState } from 'react'
import { getAircraftType } from '../data/aircraft'
import { CITIES, getCity, type City } from '../data/cities'
import type { GameState } from '../engine'
import { isGrounded, networkCities, slotsAllocated, slotsHeld, yearOf } from '../engine/queries'
import { cityPool } from '../engine/slots'
import { useDisplayPreferences, useReducedMotion } from './display'
import { cityMass, cityTier, rivalColor, type MapLens } from './mapStyle'
import { viewSeat } from './session'
import { TrafficCanvas } from './TrafficCanvas'
import type { TrafficLeg } from './traffic'
import './map.css'
import { SPAN_MIN, layerSpan } from './map/camera'
import { REGION_COLLAPSE_BELOW_SCALE, eventHalos } from './map/eventHalos'
import { globeProject, type GlobePoint } from './map/globe'
import { H, W, cachedRoutePath, cachedTripLeg, x, y } from './map/projection'
import { useMapCamera } from './map/useMapCamera'
import { useMapGestures } from './map/useMapGestures'
import { useMapKeyboard } from './map/useMapKeyboard'
import { useQuarterResult } from './map/useQuarterResult'
import { MapBackdrop, MapDefs, useGlobeGeography } from './map/layers/Backdrop'
import { CityLabels, CityMarkers } from './map/layers/Cities'
import { GlobeStatus, MapColors, MapControls, Minimap, QuarterResultCaption } from './map/layers/MapChrome'
import { EventHaloLayer, HubGlows, OceanLabels, RangeRing, SlotPings } from './map/layers/Marks'
import { useMapTraffic } from './map/layers/useMapTraffic'
import { useRouteLayers } from './map/layers/useRouteLayers'

interface MapViewProps {
  flowRouteIds?: number[]
  selectedRouteId?: number
  active?: boolean
  state: GameState
  selected: string | null // city shown in the dossier panel
  routeFrom: string | null // armed origin: next city click opens a route
  onCityClick: (city: string) => void
  onRouteClick?: (routeId: number) => void
  newRouteIds: ReadonlySet<number>
  newSlotCities: ReadonlySet<string>
  // Routes that just arrived via a takeover — they flash from rival gold
  // into the player's color so the map narrates the acquisition.
  acquiredRouteIds?: ReadonlySet<number>
  // Flash each route by its profit change once a quarter's report closes. Off
  // for the replay viewer, where quarters advance on a timer.
  announceQuarter?: boolean
}

export function MapView({
  active = true,
  selectedRouteId,
  flowRouteIds,
  state,
  selected,
  routeFrom,
  onCityClick,
  onRouteClick,
  newRouteIds,
  newSlotCities,
  acquiredRouteIds,
  announceQuarter = true,
}: MapViewProps) {
  const display = useDisplayPreferences()
  const reduceMotion = useReducedMotion()
  const camera = useMapCamera({ state, active, reduceMotion })
  const {
    svgRef,
    wrapRef,
    layerRef,
    minimapRef,
    frame,
    frameAspect,
    view,
    anchor,
    targetRef,
    globeGeometry,
    isGlobe,
    rotating,
    movingRef,
    baseRef,
    globe,
    layerXfRef,
    applyView,
  } = camera
  const seat = viewSeat()
  const player = state.airlines[seat]!
  const scale = isGlobe ? globe.s : W / view.w
  // Normalize decorations to actual CSS pixels, including the SVG's slice
  // scaling in tall workspaces. Zoom alone is insufficient: the same world
  // view can fill a 350 px strip or a 750 px tall desktop frame. City hit
  // testing still uses its independent 28 CSS-pixel nearest-city resolver.
  const frameScale = Math.max(frame.width / W, frame.height / H)
  const uiScale = (isGlobe ? 1 : scale) * frameScale
  const dotRadius = (c: City) => (2.3 + cityMass(c) / 28) / uiScale
  // One projection call for every feature on the map.
  const pt = (lon: number, lat: number): GlobePoint =>
    isGlobe ? globeProject(globe, lon, lat) : { X: x(lon), Y: y(lat), vis: true }
  const cityPt = (cityId: string): GlobePoint => {
    const c = getCity(cityId)
    return pt(c.lon, c.lat)
  }
  // Route path strings are pure in (projection, endpoints) — served from the
  // module-level caches keyed by projKey, so the 60fps zoom ease stops
  // rebuilding hundreds of Bézier strings per frame. projKey also names the
  // projection for the layer memos below.
  const projKey = isGlobe ? `g:${globe.cLon}:${globe.cLat}:${globe.s}` : 'flat'
  const routePathFor = (fromId: string, toId: string): string =>
    cachedRoutePath(projKey, isGlobe ? globe : null, fromId, toId)
  const tripLegFor = (fromId: string, toId: string): TrafficLeg | null =>
    cachedTripLeg(projKey, isGlobe ? globe : null, fromId, toId)
  const network = useMemo(() => networkCities(player), [player])
  // How full each airport is, 0..1 — the slot model's scarcity, made visible
  // on the board where expansion decisions are actually taken.
  const pressure = (cityId: string): number => {
    const pool = cityPool(state, cityId)
    return pool <= 0 ? 1 : slotsAllocated(state, cityId) / pool
  }
  // Launching needs an idle airframe with the legs — targets beyond every
  // idle aircraft's range shouldn't light up at all.
  let idleReachKm = 0
  for (const a of player.fleet) {
    if (a.routeId === null && !a.reserve && !isGrounded(a, state.turn)) idleReachKm = Math.max(idleReachKm, getAircraftType(a.type).rangeKm)
  }
  const [showRivals, setShowRivals] = useState(true)
  // Hub glow: each route's connecting pax land on both endpoints, so the
  // transfer hub — riding two legs — naturally counts double and glows
  // brightest. Makes the network's actual hub structure visible.
  const hubVolume = new Map<string, number>()
  for (const r of player.routes) {
    for (const c of [r.from, r.to]) hubVolume.set(c, (hubVolume.get(c) ?? 0) + r.lastTransferPax)
  }
  // Data lens: recolor your arcs by an operational metric so the network's
  // health reads at a glance.
  const [lens, setLens] = useState<MapLens>('none')
  // The airport holding the map's single tab stop (roving tabindex); null
  // until the keyboard first moves, when the selection or the HQ holds it.
  const [focusCity, setFocusCity] = useState<string | null>(null)
  // Set when a drag/pinch gesture ends so the click that follows it is
  // swallowed instead of selecting whatever the pointer happened to be over.
  const suppressClick = useRef(false)

  // Layer memoization: the arc and traffic layers are the map's node-count
  // heavyweights, and none of them depend on the flat viewBox — so they
  // rebuild only when the data or the projection moves, not on every frame
  // of a zoom ease or an unrelated interaction (selection, planning mode).
  // Decorative glyph sizes quantize to quarter steps for the same reason.
  const pulseUi = newRouteIds.size > 0 ? uiScale : 1

  const quarterResult = useQuarterResult({ state, player, active, announceQuarter })
  const { rivalArcsLayer, opportunities, opportunityArcsLayer, threatArcsLayer, playerArcsLayer } = useRouteLayers({
    state,
    seat,
    player,
    showRivals,
    lens,
    isGlobe,
    globe,
    projKey,
    routePathFor,
    cityPt,
    pulseUi,
    newRouteIds,
    acquiredRouteIds,
    selectedRouteId,
    flowRouteIds,
    selected,
    onRouteClick,
    quarterResult,
    suppressClickRef: suppressClick,
  })

  // World events on the map: one labeled halo per region-wide event at world
  // zoom, rings on individual cities once they are separate places.
  const haloZoom = scale >= REGION_COLLAPSE_BELOW_SCALE ? REGION_COLLAPSE_BELOW_SCALE : 1
  const halos = useMemo(() => eventHalos(state.world.events, haloZoom), [state.world.events, haloZoom])
  const { traffic, effects, trafficCamera, trafficFrozen } = useMapTraffic({
    state,
    seat,
    player,
    showRivals,
    isGlobe,
    globe,
    projKey,
    rotating,
    reduceMotion,
    display,
    tripLegFor,
    pt,
    dotRadius,
    uiScale,
    halos,
    frame,
    baseRef,
    layerXfRef,
    movingRef,
  })

  const geography = useGlobeGeography({ isGlobe, globe, rotating, globeGeometry })

  // Visibility only changes when the game state, selection, an LOD threshold
  // crossing, or the visible window changes — not on every animation frame of
  // a zoom, and not while a gesture is moving the layer (which does not touch
  // `view` at all).
  const lodKey = (scale >= 1.8 ? 2 : 0) | (scale >= 1.5 ? 1 : 0)

  // Culling follows the ANCHOR — the window the layer is actually painted
  // around — not the logical view. A pan commit moves only the view; if it
  // moved the cull too, the city set would change and invalidate the raster
  // the pan-commit path exists to keep.
  const cull = anchor
  // The globe re-projects rather than panning, so it needs no overhang.
  const span = isGlobe ? SPAN_MIN : layerSpan(anchor, frameAspect)
  const { visible, labeled } = useMemo(() => {
    // Cities the player has a stake in stay visible at any zoom.
    const stakes = new Set<string>()
    for (const r of player.routes) {
      stakes.add(r.from)
      stakes.add(r.to)
    }
    for (const c of CITIES) if (slotsHeld(player, c.id) > 0) stakes.add(c.id)
    for (const e of state.world.events) if (e.city !== null) stakes.add(e.city)
    if (selected !== null) stakes.add(selected)
    // The keyboard's current airport must never be culled out from under it.
    if (focusCity !== null) stakes.add(focusCity)
    const byTier = CITIES.filter((c) => (lodKey >= 2 ? true : cityTier(c) < 3) || stakes.has(c.id))
    // ...and then only the ones that can actually be seen. At world view that
    // is all of them; at 6x it is a couple of dozen out of 165, and the
    // difference is not just markup. The label pass below tests every label
    // against every label already placed, so rendering the whole world at
    // max zoom cost ~54k rectangle intersections to position a dozen labels
    // — paid again on every re-centre mid-drag. The pad covers the layer's
    // whole overhang with room to spare, so nothing culled here can be
    // revealed by a gesture before the layer re-centres and this runs again.
    // The globe does its own culling, by hemisphere.
    const pad = (layerSpan(cull, frameAspect) - 1) / 2 + 0.1
    const inFrame = (c: City): boolean =>
      isGlobe ||
      (x(c.lon) >= cull.x - cull.w * pad &&
        x(c.lon) <= cull.x + cull.w * (1 + pad) &&
        y(c.lat) >= cull.y - cull.h * pad &&
        y(c.lat) <= cull.y + cull.h * (1 + pad))
    const vis = byTier.filter(inFrame)
    return {
      visible: vis,
      labeled: new Set(vis.filter((c) => cityTier(c) === 1 || lodKey >= 1 || stakes.has(c.id)).map((c) => c.id)),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, seat, selected, focusCity, lodKey, isGlobe, cull.x, cull.y, cull.w, cull.h, frameAspect])

  const { onPointerDown, onPointerMove, onPointerUp, zoomInAt, handleCityClick, handleMapTap } = useMapGestures({
    camera,
    visible,
    pt,
    onCityClick,
    suppressClickRef: suppressClick,
  })

  const { sitePos, tabStop, onMapKeyDown } = useMapKeyboard({
    camera,
    visible,
    pt,
    focusCity,
    setFocusCity,
    selected,
    hq: player.hq,
    onCityClick,
  })

  return (
    // The view React has committed. During a gesture the viewBox on the SVG
    // runs ahead of it — written straight to the DOM — and this attribute is
    // how the handoff back at the end of the gesture can be seen: React only
    // rewrites it when the state actually changes.
    <div
      ref={wrapRef}
      className="map-wrap"
      data-testid="map-wrap"
      data-view={`${view.x} ${view.y} ${view.w} ${view.h}`}
      style={{ aspectRatio: `${W} / ${H}` }}
      // Focusing an airport that sits in the layer's overhang would scroll
      // this clipped box to reveal it, knocking the layer off its transform.
      // The keyboard path pans the map itself; the box never scrolls.
      onScroll={(e) => {
        const el = e.currentTarget
        if (el.scrollLeft !== 0 || el.scrollTop !== 0) {
          el.scrollLeft = 0
          el.scrollTop = 0
        }
      }}
    >
      <p id="map-keys-hint" className="map-sr-only">
        Arrow keys move between airports, Shift and an arrow pans the map, plus and minus zoom, Enter opens the airport.
      </p>
      {/* The element a gesture moves, and the reason it is a div rather than
          the <g> it used to be. Transforming an SVG group re-rasterises every
          path under it on every frame: measured over a 40-frame drag at full
          detail, 876ms of raster. A promoted div with a CSS transform is a
          compositor operation — the same drag rasterises 0ms, identical to
          not moving at all. `contain: paint` and a standing will-change are
          what buy the cached layer; the SVG inside paints past its own box
          (overflow: visible) so the layer holds a frame-and-a-bit of world
          and a drag has real map to reveal instead of a blank edge. */}
      <div
        className="map-layer"
        ref={layerRef}
        data-testid="map-pan"
        style={{
          left: `${-((span - 1) / 2) * 100}%`,
          top: `${-((span - 1) / 2) * 100}%`,
          width: `${span * 100}%`,
          height: `${span * 100}%`,
        }}
      >
      <svg
        ref={svgRef}
        style={{
          left: `${((1 - 1 / span) / 2) * 100}%`,
          top: `${((1 - 1 / span) / 2) * 100}%`,
          width: `${(1 / span) * 100}%`,
          height: `${(1 / span) * 100}%`,
        }}
        viewBox={isGlobe ? `0 0 ${W} ${H}` : `${anchor.x} ${anchor.y} ${anchor.w} ${anchor.h}`}
        preserveAspectRatio="xMidYMid slice"
        className={`map era-${Math.min(2000, Math.max(1960, Math.floor(yearOf(state) / 10) * 10))}`}
        role="application"
        aria-label="World route map"
        aria-describedby="map-keys-hint"
        data-testid="map"
        onKeyDown={onMapKeyDown}
        onPointerDown={onPointerDown}
        onMouseDown={(e) => {
          // A press on the map is a pan, never the start of a text selection.
          // user-select: none covers the map itself, but Safari arms the
          // selection at mousedown and extends it into the page around the
          // map the moment the pointer leaves it mid-drag. Canceling
          // mousedown keeps it from arming at all; click and dblclick still
          // fire, so taps and double-click zoom are untouched.
          e.preventDefault()
        }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={handleMapTap}
        onDoubleClick={(e) => zoomInAt(e.clientX, e.clientY)}
      >
        <MapDefs />
        {/* Everything that pans lives in one group so a gesture can move it
            with a transform instead of a viewBox — see paintView. The
            vignette stays outside, pinned to the frame. */}
        <g className="map-pan">
          <MapBackdrop isGlobe={isGlobe} globe={globe} rotating={rotating} uiScale={uiScale} geography={geography} />
          <OceanLabels pt={pt} uiScale={uiScale} />
          <HubGlows hubVolume={hubVolume} cityPt={cityPt} uiScale={uiScale} />
          {/* Rival networks, thin and color-coded per airline, under the
              player's arcs. Toggleable for decluttering. */}
          {rivalArcsLayer}
          {opportunityArcsLayer}
          {playerArcsLayer}
          {threatArcsLayer}
          <SlotPings newSlotCities={newSlotCities} cityPt={cityPt} uiScale={uiScale} />
          <EventHaloLayer halos={halos} pt={pt} uiScale={uiScale} />
          <RangeRing isGlobe={isGlobe} routeFrom={routeFrom} idleReachKm={idleReachKm} pt={pt} />
          <CityMarkers
            state={state}
            player={player}
            visible={visible}
            sitePos={sitePos}
            network={network}
            routeFrom={routeFrom}
            idleReachKm={idleReachKm}
            selected={selected}
            focusCity={focusCity}
            setFocusCity={setFocusCity}
            tabStop={tabStop}
            dotRadius={dotRadius}
            pressure={pressure}
            uiScale={uiScale}
            handleCityClick={handleCityClick}
          />
          <CityLabels visible={visible} labeled={labeled} pt={pt} dotRadius={dotRadius} uiScale={uiScale} hq={player.hq} selected={selected} />
        </g>
      </svg>
      </div>
      {/* Traffic floats over the layer in its own frame-sized canvas: it
          re-projects through the layer's transform each frame instead of
          living inside the SVG, where every moving node re-rastered the
          composited map. Sits under the vignette and the controls. */}
      <TrafficCanvas
        planes={traffic.planes}
        effects={effects}
        rivalCount={traffic.rivalCount}
        frame={frame}
        active={active}
        camera={trafficCamera}
        frozen={trafficFrozen}
      />
      {/* The frame falls off into the dark so the middle of the world holds
          the eye. It belongs to the frame, not the world, so it sits outside
          the layer entirely — a gesture must not drag it around. A CSS
          gradient on a div, rather than a rect inside the SVG, is what keeps
          it still now that the whole SVG moves. */}
      <div className="map-vignette" />
      <MapControls camera={camera} showRivals={showRivals} setShowRivals={setShowRivals} />
      <QuarterResultCaption quarterResult={quarterResult} />
      <GlobeStatus camera={camera} />
      <MapColors
        lens={lens}
        setLens={setLens}
        opportunities={opportunities}
        owners={state.airlines
          .filter((a) => !a.bankrupt && (a.id === seat || (showRivals && a.routes.length > 0)))
          .map((a) => ({ id: a.id, name: a.name, color: rivalColor(a.id), you: a.id === seat }))}
        events={halos.legend}
      />
      <Minimap isGlobe={isGlobe} view={view} frameAspect={frameAspect} minimapRef={minimapRef} targetRef={targetRef} applyView={applyView} />
    </div>
  )
}
