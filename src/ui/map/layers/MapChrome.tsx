// The map's chrome, floating over the frame: the zoom/projection/rivals
// buttons, the quarter-result caption, globe loading status, the map-colors
// picker with its key, and the minimap inset.

import type { Dispatch, RefObject, SetStateAction } from 'react'
import { WORLD_PATH } from '../../../data/worldmap.gen'
import { Icon } from '../../Icon'
import { MapLegend, type MapEventEntry, type MapOwner } from '../../legends'
import type { MapLens } from '../../mapStyle'
import { visibleRect, type ViewBox } from '../camera'
import { GLOBE_HOME } from '../globe'
import { H, W } from '../projection'
import type { MapCamera } from '../useMapCamera'

export function MapControls({
  camera,
  showRivals,
  setShowRivals,
}: {
  camera: MapCamera
  showRivals: boolean
  setShowRivals: Dispatch<SetStateAction<boolean>>
}) {
  const { isGlobe, applyGlobe, globeTargetRef, zoomAt, applyView, homeView, projection, setProjection, globeLoading } = camera
  return (
    <div className="map-controls">
      <button
        data-testid="zoom-in"
        aria-label="zoom in"
        title="zoom in"
        onClick={() =>
          isGlobe
            ? applyGlobe({ ...globeTargetRef.current, s: globeTargetRef.current.s * 1.5 }, false)
            : zoomAt(null, null, 1.5)
        }
      >
        <Icon name="zoomIn" />
      </button>
      <button
        data-testid="zoom-out"
        aria-label="zoom out"
        title="zoom out"
        onClick={() =>
          isGlobe
            ? applyGlobe({ ...globeTargetRef.current, s: globeTargetRef.current.s / 1.5 }, false)
            : zoomAt(null, null, 1 / 1.5)
        }
      >
        <Icon name="zoomOut" />
      </button>
      <button
        data-testid="zoom-reset"
        aria-label="reset zoom"
        title="reset the view"
        onClick={() => (isGlobe ? applyGlobe(GLOBE_HOME, false) : applyView(homeView(), false))}
      >
        <Icon name="reset" />
      </button>
      <button
        data-testid="map-projection"
        aria-label={projection === 'globe' ? 'switch to flat map' : 'switch to globe'}
        aria-busy={globeLoading}
        title={isGlobe ? 'switch to flat map' : 'switch to globe'}
        className={isGlobe ? 'active' : ''}
        onClick={() => {
          const next = projection === 'globe' ? 'flat' : 'globe'
          setProjection(next)
          try { localStorage.setItem('loadfactor:projection', next) } catch { /* session preference */ }
        }}
      >
        <Icon name="globe" />
      </button>
      <button
        data-testid="toggle-rivals"
        aria-label={showRivals ? 'hide rival networks' : 'show rival networks'}
        title={showRivals ? 'hide rival networks' : 'show rival networks'}
        className={showRivals ? 'active' : ''}
        onClick={() => setShowRivals((v) => !v)}
      >
        <Icon name="rivals" />
      </button>

    </div>
  )
}

export function QuarterResultCaption({ quarterResult }: { quarterResult: { up: number; down: number } | null }) {
  return (
    <>
      {quarterResult !== null && quarterResult.up + quarterResult.down > 0 && (
        <div className="map-quarter-result" role="status" data-testid="map-quarter-result">
          Last quarter{' '}
          {quarterResult.up > 0 && <span className="pos">▲ {quarterResult.up} {quarterResult.up === 1 ? 'route' : 'routes'} earned more</span>}
          {quarterResult.up > 0 && quarterResult.down > 0 && ' · '}
          {quarterResult.down > 0 && <span className="neg">▼ {quarterResult.down} earned less</span>}
        </div>
      )}
    </>
  )
}

export function GlobeStatus({ camera }: { camera: MapCamera }) {
  const { globeLoading, projection, globeError, setGlobeError, setGlobeRetry } = camera
  return (
    <>
      {globeLoading && <div className="map-load-status" role="status">Loading globe…</div>}
      {projection === 'globe' && globeError && <div className="map-load-status" role="status">
        Globe unavailable. <button onClick={() => { setGlobeError(false); setGlobeRetry((n) => n + 1) }}>Try again</button>
      </div>}
    </>
  )
}

export function MapColors({
  lens,
  setLens,
  opportunities,
  owners,
  events,
}: {
  lens: MapLens
  setLens: (lens: MapLens) => void
  opportunities: readonly unknown[]
  owners: readonly MapOwner[]
  events: readonly MapEventEntry[]
}) {
  return (
    <div className="map-data-control">
      <label>Map colors <select aria-label="map colors" value={lens} onChange={(e) => setLens(e.target.value as typeof lens)}>
        <option value="none">Ownership</option><option value="load">Load factor</option><option value="profit">Route margin</option><option value="season">Season</option><option value="demand">Unserved demand</option>
      </select></label>
      <MapLegend
        lens={lens}
        opportunities={opportunities.length}
        owners={owners}
        events={events}
      />
    </div>
  )
}

export function Minimap({
  isGlobe,
  view,
  frameAspect,
  minimapRef,
  targetRef,
  applyView,
}: {
  isGlobe: boolean
  view: ViewBox
  frameAspect: number
  minimapRef: RefObject<HTMLDivElement | null>
  targetRef: RefObject<ViewBox>
  applyView: (target: ViewBox, immediate: boolean) => void
}) {
  return (
    <>
      {/* Minimap inset: once zoomed in, a world thumbnail shows where the
          viewport sits — click (or drag) to jump the view there. Flat map
          only; the globe orients itself. */}
      {!isGlobe && view.w < W * 0.85 && (
        <div className="minimap-wrap">
        <svg
          className="minimap"
          viewBox={`0 0 ${W} ${H}`}
          data-testid="minimap"
          role="img"
          aria-label="Minimap — click to move the view"
          onMouseDown={(e) => e.preventDefault()} // a jump, never a selection
          onPointerDown={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            const mx = ((e.clientX - rect.left) / rect.width) * W
            const my = ((e.clientY - rect.top) / rect.height) * H
            const t = targetRef.current
            applyView({ ...t, x: mx - t.w / 2, y: my - t.h / 2 }, true)
          }}
        >
          <rect x={0} y={0} width={W} height={H} className="map-sea" />
          <path d={WORLD_PATH} className="minimap-land" />
        </svg>
          {/* The viewport marker is an ordinary div, not a rect inside the
              SVG. Writing a transform onto an SVG element re-runs SVG layout,
              so even as a pure translate this little inset was repainting on
              every frame of a drag: hiding it took frames over 32ms from 51
              to 22 under a 6x CPU throttle. A div on its own layer is a
              compositor move, like the map. The translate is a percentage of
              the marker's OWN box, which is exactly view.w wide — so
              translating it 100% of itself moves it one view across the
              world, and no pixel measurement is needed. */}
          {/* The marker outlines what the frame SHOWS — the viewBox minus
              what `slice` crops — so it never claims the cropped edges. */}
          {(() => {
            const vis = visibleRect(view, frameAspect)
            return (
              <div
                ref={minimapRef}
                className="minimap-viewport"
                data-testid="minimap-viewport"
                style={{
                  width: `${(vis.w / W) * 100}%`,
                  height: `${(vis.h / H) * 100}%`,
                  transform: `translate3d(${(vis.x / vis.w) * 100}%, ${(vis.y / vis.h) * 100}%, 0)`,
                }}
              />
            )
          })()}
        </div>
      )}
    </>
  )
}
