// SVG world map: equirectangular projection, cities as dots, routes as lines.
// Click two cities to open a route. Presentation-only trig/floats are fine
// here — the engine never sees screen coordinates.

import { CITIES, getCity } from '../data/cities'
import { getEventDef } from '../data/events'
import type { GameState } from '../engine'
import { slotsHeld } from '../engine/queries'
import { dispatch } from './session'

const W = 960
const H = 420

function x(lon: number): number {
  return ((lon + 180) / 360) * W
}

function y(lat: number): number {
  return ((90 - lat) / 180) * ((H * 175) / 180) // clip Antarctica, keep aspect
}

// Quadratic arc between two cities, lifted perpendicular to the chord — reads
// as a flight path instead of a fence line. Pure presentation.
function arcPath(fromId: string, toId: string): string {
  const a = getCity(fromId)
  const b = getCity(toId)
  const x1 = x(a.lon)
  const y1 = y(a.lat)
  const x2 = x(b.lon)
  const y2 = y(b.lat)
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.sqrt(dx * dx + dy * dy) || 1
  const lift = Math.min(40, len * 0.18)
  const mx = (x1 + x2) / 2 + (dy / len) * lift
  const my = (y1 + y2) / 2 - (dx / len) * lift
  return `M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`
}

interface MapViewProps {
  state: GameState
  selected: string | null
  onSelect: (city: string | null) => void
  newRouteIds: ReadonlySet<number>
}

export function MapView({ state, selected, onSelect, newRouteIds }: MapViewProps) {
  const player = state.airlines[0]!

  const onCityClick = (cityId: string): void => {
    if (selected === null) {
      onSelect(cityId)
    } else if (selected === cityId) {
      onSelect(null)
    } else {
      dispatch({ type: 'open_route', from: selected, to: cityId })
      onSelect(null)
    }
  }

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="map"
      role="img"
      aria-label="World route map"
      data-testid="map"
    >
      <rect x={0} y={0} width={W} height={H} className="map-sea" />
      {/* Rival routes, thin, under the player's */}
      {state.airlines.slice(1).map((airline) =>
        airline.routes.map((r) => (
          <path key={`${airline.id}-${r.id}`} d={arcPath(r.from, r.to)} className="route-rival" />
        )),
      )}
      {player.routes.map((r) => {
        const isNew = newRouteIds.has(r.id)
        return (
          <g key={r.id}>
            <path
              d={arcPath(r.from, r.to)}
              pathLength={1}
              className={isNew ? 'route-player route-new' : 'route-player'}
              data-testid={isNew ? 'route-line-new' : undefined}
            />
            {isNew &&
              [r.from, r.to].map((cityId) => {
                const c = getCity(cityId)
                return (
                  <circle
                    key={cityId}
                    cx={x(c.lon)}
                    cy={y(c.lat)}
                    r={10}
                    className="endpoint-pulse"
                  />
                )
              })}
          </g>
        )
      })}
      {/* Active world events glow on the map: gold halo on boosted cities and
          regions (Olympics, fairs, tourism waves), red on conflict zones. */}
      {state.world.events.map((e) => {
        const def = getEventDef(e.id)
        if (def.demandModBp === undefined) return null
        const good = def.demandModBp >= 10000
        const cities = e.city !== null ? [getCity(e.city)] : CITIES.filter((c) => c.region === e.region)
        return cities.map((c) => (
          <circle
            key={`${e.id}-${c.id}`}
            cx={x(c.lon)}
            cy={y(c.lat)}
            r={12}
            className={good ? 'event-halo halo-boom' : 'event-halo halo-bust'}
            data-testid={`event-halo-${c.id}`}
          />
        ))
      })}
      {CITIES.map((c) => {
        const held = slotsHeld(player, c.id)
        const mass = c.pop * 4 + c.biz * 3 + c.tour * 2
        return (
          <g key={c.id} onClick={() => onCityClick(c.id)} className="city">
            <circle
              data-testid={`city-${c.id}`}
              cx={x(c.lon)}
              cy={y(c.lat)}
              r={2 + mass / 18}
              className={
                selected === c.id ? 'city-dot selected' : held > 0 ? 'city-dot slotted' : 'city-dot'
              }
            />
            <text x={x(c.lon) + 6} y={y(c.lat) + 3} className="city-label">
              {c.id}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
