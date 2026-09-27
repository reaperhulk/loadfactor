// The airports: markers (buttons behind one roving tab stop, with their
// selection, negotiation, network and HQ marks) and, above every marker, the
// collision-placed labels.

import { distanceKm, type City } from '../../../data/cities'
import type { Airline, GameState } from '../../../engine'
import { slotsHeld } from '../../../engine/queries'
import { labelBox, placeLabels, type Box, type LabelPlacement } from '../../labels'
import { cityMass, cityTier } from '../../mapStyle'
import { viewSeat } from '../../session'
import type { GlobePoint } from '../globe'
import { slotsUsedAt } from '../projection'

export function CityMarkers({
  state,
  player,
  visible,
  sitePos,
  network,
  routeFrom,
  idleReachKm,
  selected,
  focusCity,
  setFocusCity,
  tabStop,
  dotRadius,
  pressure,
  uiScale,
  handleCityClick,
}: {
  state: GameState
  player: Airline
  visible: readonly City[]
  sitePos: ReadonlyMap<string, { id: string; x: number; y: number }>
  network: ReadonlySet<string>
  routeFrom: string | null
  idleReachKm: number
  selected: string | null
  focusCity: string | null
  setFocusCity: (id: string) => void
  tabStop: string | null
  dotRadius: (c: City) => number
  pressure: (cityId: string) => number
  uiScale: number
  handleCityClick: (cityId: string, detail?: number) => void
}) {
  return (
    <>
      {visible.map((c) => {
        const held = slotsHeld(player, c.id)
        // In route-planning mode, legal destinations light up as targets —
        // and a route must touch the network (HQ or a served city).
        const inNetwork = network.has(c.id)
        const isTarget =
          routeFrom !== null &&
          routeFrom !== c.id &&
          (network.has(routeFrom) || inNetwork) &&
          held > slotsUsedAt(player.routes, c.id) &&
          distanceKm(routeFrom, c.id) <= idleReachKm &&
          !player.routes.some(
            (r) =>
              (r.from === c.id && r.to === routeFrom) || (r.from === routeFrom && r.to === c.id),
          )
        const site = sitePos.get(c.id)
        if (site === undefined) return null
        const p = { X: site.x, Y: site.y }
        const r = dotRadius(c)
        const load = pressure(c.id)
        const served = player.routes.some((rt) => rt.from === c.id || rt.to === c.id)
        const status =
          c.id === player.hq
            ? 'your headquarters'
            : served
              ? 'served by you'
              : held > 0
                ? 'your slots, not yet served'
                : 'not served by you'
        return (
          <g
            key={c.id}
            onClick={(e) => {
              e.stopPropagation() // precise hit — don't also run the nearest-city resolver
              handleCityClick(c.id, e.detail)
            }}
            onFocus={() => {
              if (focusCity !== c.id) setFocusCity(c.id)
            }}
            className="city"
            role="button"
            tabIndex={c.id === tabStop ? 0 : -1}
            data-city={c.id}
            aria-label={`${c.name} (${c.id}), ${status}${isTarget ? ', a route can open here' : ''}${load >= 1 ? ', airport full' : ''}`}
            aria-pressed={selected === c.id}
          >
            {selected === c.id && (
              <circle cx={p.X} cy={p.Y} r={r + 5 / uiScale} className="selection-ring" />
            )}
            {/* The keyboard's focus ring, drawn only on the one tab stop
                and shown only while it holds keyboard focus. */}
            {c.id === tabStop && <circle cx={p.X} cy={p.Y} r={r + 7 / uiScale} className="city-focus-ring" />}
            {player.slotRequests.some((r) => r.city === c.id) && (
              <circle
                cx={p.X}
                cy={p.Y}
                r={r + 4 / uiScale}
                className="negotiating-ring"
                data-testid={`negotiating-${c.id}`}
              />
            )}
            {/* A rival has announced it will court this authority next
                quarter. Knowing BEFORE you commit is the difference between
                a bidding war and an ambush. */}
            {state.airlines.some((a) => a.id !== viewSeat() && !a.bankrupt && a.slotInterest === c.id) && (
              <circle
                cx={p.X}
                cy={p.Y}
                r={r + 6.5 / uiScale}
                className="rival-negotiating-ring"
                data-testid={`rival-negotiating-${c.id}`}
              />
            )}
            {inNetwork && <circle cx={p.X} cy={p.Y} r={r + 2.5 / uiScale} className="city-network-ring" />}
            {c.id === player.hq && (
              <text
                x={p.X}
                y={p.Y - r - 4 / uiScale}
                className="hq-marker"
                fontSize={11 / uiScale}
                textAnchor="middle"
                data-testid="hq-marker"
              >
                ★
              </text>
            )}
            <circle
              data-testid={`city-${c.id}`}
              cx={p.X}
              cy={p.Y}
              r={r}
              className={
                (selected === c.id
                  ? 'city-dot selected'
                  : isTarget
                    ? 'city-dot target'
                    : held > 0
                      ? 'city-dot slotted'
                      : 'city-dot') +
                ` tier-${cityTier(c)}` +
                // Capacity pressure, straight from the slot model: an airport
                // filling up is a place you have to move on, and the map is
                // where that decision starts.
                (load >= 1 ? ' full' : load >= 0.75 ? ' tight' : '')
              }
            />
          </g>
        )
      })}
    </>
  )
}


// Label width in ems, measured once per name in the map's own type — a fixed
// per-character guess was off by a fifth between platforms, and that is the
// margin two neighbouring names need to not overlap. Falls back to a generous
// estimate where there is no canvas (unit tests).
const labelEmCache = new Map<string, number>()
let measureCtx: CanvasRenderingContext2D | null | undefined
function labelEms(text: string): number {
  let em = labelEmCache.get(text)
  if (em !== undefined) return em
  if (measureCtx === undefined) {
    try {
      measureCtx = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d')
      if (measureCtx !== null) {
        const family = getComputedStyle(document.body).fontFamily || 'sans-serif'
        measureCtx.font = `600 100px ${family}`
      }
    } catch {
      measureCtx = null
    }
  }
  const measured = measureCtx?.measureText(text).width
  em = measured !== undefined && measured > 0 ? measured / 100 : text.length * 0.74
  labelEmCache.set(text, em)
  return em
}

export interface CityLabelLayout {
  fs: number
  labels: (LabelPlacement & { box: Box })[]
}

// Where every city name goes. Priority is the order names claim space in: the
// HQ, the selected airport, then the player's own network, then everything
// else, heaviest market first. Only the HQ and the selected airport are
// always named; any other name that finds no free side of its marker is
// hidden until a zoom gives it room (GIG/GRU, YUL/YYZ at world view). The
// boxes are shared with the traffic canvas, which fades a plane crossing a
// name so the glyphs never hide the airports they fly between.
export function layoutCityLabels({
  visible,
  labeled,
  pt,
  dotRadius,
  uiScale,
  hq,
  selected,
  network,
}: {
  visible: readonly City[]
  labeled: ReadonlySet<string>
  pt: (lon: number, lat: number) => GlobePoint
  dotRadius: (c: City) => number
  uiScale: number
  hq: string
  selected: string | null
  network: ReadonlySet<string>
}): CityLabelLayout {
  const fs = 11 / uiScale
  const gap = 3 / uiScale
  // The halo's stroke paints a pixel past the glyphs on each side.
  const halo = 2 / uiScale
  const rank = (c: City): number => (c.id === hq ? 0 : c.id === selected ? 1 : network.has(c.id) ? 2 : 3)
  const sites = visible
    .filter((c) => labeled.has(c.id))
    .sort((a, b) => rank(a) - rank(b) || cityMass(b) - cityMass(a) || (a.id < b.id ? -1 : 1))
    .map((c) => ({ c, p: pt(c.lon, c.lat) }))
    .filter(({ p }) => p.vis)
    .map(({ c, p }) => ({
      id: c.id,
      x: p.X,
      y: p.Y,
      r: dotRadius(c),
      w: labelEms(c.id) * fs + halo,
      optional: c.id !== hq && c.id !== selected,
    }))
  const width = new Map(sites.map((s) => [s.id, s.w]))
  return {
    fs,
    labels: placeLabels(sites, fs, gap).map((l) => ({ ...l, box: labelBox(l, width.get(l.id)!, fs) })),
  }
}

// Labels draw in their own layer ABOVE every dot, with a halo — a
// neighboring city's dot can never sit on top of a name.
export function CityLabels({ layout }: { layout: CityLabelLayout }) {
  return (
    <>
      {layout.labels.map((l) => (
        <text
          key={`label-${l.id}`}
          x={l.x}
          y={l.y}
          fontSize={layout.fs}
          textAnchor={l.anchor}
          className="city-label"
          data-label={l.id}
        >
          {l.id}
        </text>
      ))}
    </>
  )
}
