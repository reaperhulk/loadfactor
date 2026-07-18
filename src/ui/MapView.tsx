// SVG world map: equirectangular projection, cities as dots, routes as lines.
// Click two cities to open a route. Presentation-only trig/floats are fine
// here — the engine never sees screen coordinates.

import { useState } from 'react'
import { CITIES, getCity } from '../data/cities'
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

export function MapView({ state }: { state: GameState }) {
  const [selected, setSelected] = useState<string | null>(null)
  const player = state.airlines[0]!

  const onCityClick = (cityId: string): void => {
    if (selected === null) {
      setSelected(cityId)
    } else if (selected === cityId) {
      setSelected(null)
    } else {
      dispatch({ type: 'open_route', from: selected, to: cityId })
      setSelected(null)
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
        airline.routes.map((r) => {
          const a = getCity(r.from)
          const b = getCity(r.to)
          return (
            <line
              key={`${airline.id}-${r.id}`}
              x1={x(a.lon)}
              y1={y(a.lat)}
              x2={x(b.lon)}
              y2={y(b.lat)}
              className="route-rival"
            />
          )
        }),
      )}
      {player.routes.map((r) => {
        const a = getCity(r.from)
        const b = getCity(r.to)
        return (
          <line
            key={r.id}
            x1={x(a.lon)}
            y1={y(a.lat)}
            x2={x(b.lon)}
            y2={y(b.lat)}
            className="route-player"
          />
        )
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
