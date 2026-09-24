// Marks on the map that are not the network itself: ocean names, hub glows,
// fresh slot pings, world-event halos and the planning range ring.

import { getCity } from '../../../data/cities'
import { MAP_LAT_MAX, MAP_LAT_MIN } from '../../../data/worldmap.gen'
import type { EventHalos } from '../eventHalos'
import { regionHaloShape } from '../eventHalos'
import type { GlobePoint } from '../globe'
import { H, W } from '../projection'

type Project = (lon: number, lat: number) => GlobePoint
type ProjectCity = (cityId: string) => GlobePoint

// Geographic labels sit below the operating network, never in its hit layer.
export function OceanLabels({ pt, uiScale }: { pt: Project; uiScale: number }) {
  return (
    <>
      {[
        { name: 'NORTH ATLANTIC', lon: -40, lat: 28 },
        { name: 'SOUTH ATLANTIC', lon: -20, lat: -28 },
        { name: 'INDIAN OCEAN', lon: 77, lat: -24 },
        { name: 'NORTH PACIFIC', lon: -151, lat: 27 },
        { name: 'SOUTH PACIFIC', lon: -132, lat: -25 },
      ].map((ocean) => {
        const p = pt(ocean.lon, ocean.lat)
        return p.vis && <text key={ocean.name} x={p.X} y={p.Y} textAnchor="middle" fontSize={10 / uiScale}
          className="map-ocean-label" style={{ letterSpacing: 2 / uiScale }}>{ocean.name}</text>
      })}
    </>
  )
}

export function HubGlows({ hubVolume, cityPt, uiScale }: { hubVolume: ReadonlyMap<string, number>; cityPt: ProjectCity; uiScale: number }) {
  return (
    <>
      {/* Transfer hubs glow in proportion to the connecting pax flowing
          over them last quarter. */}
      {[...hubVolume.entries()]
        .filter(([, v]) => v >= 500)
        .map(([cityId, v]) => {
          const p = cityPt(cityId)
          if (!p.vis) return null
          return (
            <circle
              key={`hub-${cityId}`}
              cx={p.X}
              cy={p.Y}
              r={(5 + Math.min(14, Math.sqrt(v) / 6)) / uiScale}
              className="hub-glow"
              data-testid={`hub-glow-${cityId}`}
            >
              <title>{`${cityId}: ${v.toLocaleString('en-US')} connecting pax last quarter`}</title>
            </circle>
          )
        })}
    </>
  )
}

export function SlotPings({ newSlotCities, cityPt, uiScale }: { newSlotCities: ReadonlySet<string>; cityPt: ProjectCity; uiScale: number }) {
  return (
    <>
      {/* Fresh slot wins ping gold at the airport. */}
      {[...newSlotCities].sort().map((cityId) => {
        const p = cityPt(cityId)
        if (!p.vis) return null
        return (
          <circle
            key={`slots-${cityId}`}
            cx={p.X}
            cy={p.Y}
            r={11 / uiScale}
            className="slots-ping"
            data-testid={`slots-ping-${cityId}`}
          />
        )
      })}
    </>
  )
}

export function EventHaloLayer({ halos, pt, uiScale }: { halos: EventHalos; pt: Project; uiScale: number }) {
  return (
    <>
      {/* Active world events glow on the map: gold halo on boosted cities and
          regions (Olympics, fairs, tourism waves), red on conflict zones. */}
      {halos.regions.map((h) => {
        const shape = regionHaloShape(
          h.core.map((c) => pt(c.lon, c.lat)).filter((p) => p.vis),
          14 / uiScale,
        )
        if (shape === null) return null
        return (
          <g key={h.key} className={h.good ? 'event-region halo-boom' : 'event-region halo-bust'} data-testid={`event-region-${h.region}`}>
            <ellipse cx={shape.cx} cy={shape.cy} rx={shape.rx} ry={shape.ry} className="event-region-halo" />
            <text x={shape.cx} y={shape.cy - shape.ry - 4 / uiScale} fontSize={10 / uiScale} textAnchor="middle" className="event-region-label">
              {h.name}
            </text>
          </g>
        )
      })}
      {halos.cities.map((h) => {
        const p = pt(h.city.lon, h.city.lat)
        if (!p.vis) return null
        return (
          <circle
            key={h.key}
            cx={p.X}
            cy={p.Y}
            r={12 / uiScale}
            className={h.good ? 'event-halo halo-boom' : 'event-halo halo-bust'}
            data-testid={`event-halo-${h.city.id}`}
          />
        )
      })}
    </>
  )
}

export function RangeRing({ isGlobe, routeFrom, idleReachKm, pt }: { isGlobe: boolean; routeFrom: string | null; idleReachKm: number; pt: Project }) {
  return (
    <>
      {/* Planning a route: a dashed ring shows how far the longest-legged
          idle airframe can fly from the origin — why a target is (or isn't)
          reachable, drawn instead of guessed. Flat map only; the globe's
          great-circle disc would lie near the poles. */}
      {!isGlobe &&
        routeFrom !== null &&
        idleReachKm > 0 &&
        (() => {
          const origin = getCity(routeFrom)
          const p = pt(origin.lon, origin.lat)
          if (!p.vis) return null
          // Local px-per-km at the origin's latitude (equirectangular).
          const kmPerLonDeg = 111.32 * Math.max(0.2, Math.cos((origin.lat * Math.PI) / 180))
          const rx = (idleReachKm / kmPerLonDeg) * (W / 360)
          const ry = (idleReachKm / 111.32) * (H / (MAP_LAT_MAX - MAP_LAT_MIN)) // px per lat degree, mirrors y()
          return (
            <ellipse
              cx={p.X}
              cy={p.Y}
              rx={rx}
              ry={ry}
              className="range-ring"
              data-testid="range-ring"
            />
          )
        })()}
    </>
  )
}
