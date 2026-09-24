// The airports: markers (buttons behind one roving tab stop, with their
// selection, negotiation, network and HQ marks) and, above every marker, the
// collision-placed labels.

import { distanceKm, type City } from '../../../data/cities'
import type { Airline, GameState } from '../../../engine'
import { slotsHeld } from '../../../engine/queries'
import { placeLabels } from '../../labels'
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

export function CityLabels({
  visible,
  labeled,
  pt,
  dotRadius,
  uiScale,
  hq,
  selected,
}: {
  visible: readonly City[]
  labeled: ReadonlySet<string>
  pt: (lon: number, lat: number) => GlobePoint
  dotRadius: (c: City) => number
  uiScale: number
  hq: string
  selected: string | null
}) {
  return (
    <>
      {/* Labels draw in their own layer ABOVE every dot, with a halo — a
          neighboring city's dot can never sit on top of a name. Mass order
          is the priority order: majors get first pick of the slots. The
          collision pass itself is in labels.ts, which does it against a
          uniform grid rather than by scanning every label already placed;
          the naive version is quadratic and peaks at ~150 labels around
          1.8x zoom, where tier-3 cities unlock but the frame still holds
          most of the world. */}
      {(() => {
        const fs = 11 / uiScale
        const gap = 3 / uiScale
        const sites = visible
          .filter((c) => labeled.has(c.id))
          .sort((a, b) => cityMass(b) - cityMass(a) || (a.id < b.id ? -1 : 1))
          .map((c) => ({ c, p: pt(c.lon, c.lat) }))
          .filter(({ p }) => p.vis)
          .map(({ c, p }) => ({
            id: c.id,
            x: p.X,
            y: p.Y,
            r: dotRadius(c),
            w: c.id.length * fs * 0.66,
            // A major, the HQ or the selected city is always named, even
            // shingled; anything else yields when a cluster of network
            // cities (JFK/PHL/DCA at world view) leaves it no room.
            optional: cityTier(c) !== 1 && c.id !== hq && c.id !== selected,
          }))
        return placeLabels(sites, fs, gap).map((l) => (
          <text
            key={`label-${l.id}`}
            x={l.x}
            y={l.y}
            fontSize={fs}
            textAnchor={l.anchor}
            className="city-label"
          >
            {l.id}
          </text>
        ))
      })()}
    </>
  )
}
