// The route arcs: rival networks, the demand lens's unflown markets,
// announced raids, and the player's own network — each memoized on the data
// and the projection, never on the flat viewBox, so a zoom ease or a
// selection elsewhere does not rebuild the map's heaviest layers.

import { useMemo } from 'react'
import type { MutableRefObject } from 'react'
import { CITIES, distanceKm, pairKey } from '../../../data/cities'
import { MIN_ROUTE_KM } from '../../../data/constants'
import type { Airline, GameState, Route } from '../../../engine'
import { pairWeeklyDemand, seasonalBp } from '../../../engine/market'
import { networkCities, pairWeeklySeats, slotCities } from '../../../engine/queries'
import { rivalColorClass, type MapLens } from '../../mapStyle'
import { viewSeat } from '../../session'
import type { GlobePoint, GlobeView } from '../globe'
import { capWidth, haulClass } from '../projection'
import type { RouteTrend } from '../quarterResult'

export function useRouteLayers({
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
  suppressClickRef,
}: {
  state: GameState
  seat: number
  player: Airline
  showRivals: boolean
  lens: MapLens
  isGlobe: boolean
  globe: GlobeView
  projKey: string
  routePathFor: (fromId: string, toId: string) => string
  cityPt: (cityId: string) => GlobePoint
  pulseUi: number
  newRouteIds: ReadonlySet<number>
  acquiredRouteIds: ReadonlySet<number> | undefined
  selectedRouteId: number | undefined
  flowRouteIds: number[] | undefined
  selected: string | null
  onRouteClick: ((routeId: number) => void) | undefined
  quarterResult: { byRoute: ReadonlyMap<number, RouteTrend> } | null
  // Set when a drag ends, so the click that follows it selects nothing.
  suppressClickRef: MutableRefObject<boolean>
}) {
  const lensClass = (r: Route): string => {
    if (lens === 'season') {
      // The calendar's lean on this pair right now (tourism seasonality).
      const bp = Math.floor((seasonalBp(r.from, state.turn) * seasonalBp(r.to, state.turn)) / 10000)
      return bp > 10100 ? ' lens-good' : bp < 9900 ? ' lens-bad' : ''
    }
    if (lens === 'none' || lens === 'demand' || r.lastCapacity === 0) return ''
    if (lens === 'load') {
      return r.lastLoadFactorBp >= 8000 ? ' lens-good' : r.lastLoadFactorBp >= 5500 ? ' lens-mid' : ' lens-bad'
    }
    const marginBp = r.lastRevenue > 0 ? Math.floor(((r.lastRevenue - r.lastCost) * 10000) / r.lastRevenue) : -1
    return marginBp >= 1500 ? ' lens-good' : marginBp >= 0 ? ' lens-mid' : ' lens-bad'
  }
  // Every pair any rival serves — player arcs on these run contested-hot.
  const rivalPairs = new Set(
    state.airlines.filter((a) => a.id !== viewSeat()).flatMap((a) => a.routes.map((r) => pairKey(r.from, r.to))),
  )

  const rivalArcsLayer = useMemo(() => {
    if (!showRivals) return null
    return state.airlines.filter((a) => a.id !== viewSeat()).map((airline) =>
      airline.routes.map((r) => {
        const d = routePathFor(r.from, r.to)
        if (d === '') return null
        return (
          <path
            key={`${airline.id}-${r.id}`}
            d={d}
            className={`route-rival ${rivalColorClass(airline.id)}`}
            style={{ '--cap-w': capWidth(airline, r, true, state.turn) } as React.CSSProperties}
          />
        )
      }),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, seat, showRivals, isGlobe, globe, projKey])

  // Demand lens: the richest markets nobody is flying from the player's own
  // network — the map as a spatial puzzle, not a list. Faint arcs, thicker
  // where more weekly demand goes unmet by everyone's seats combined.
  const opportunities = useMemo(() => {
    if (lens !== 'demand') return []
    const anchors = [...new Set([...networkCities(player), ...slotCities(player)])].sort()
    const served = new Set(player.routes.map((r) => pairKey(r.from, r.to)))
    const seen = new Set<string>()
    const out: { from: string; to: string; demand: number; score: number }[] = []
    for (const a of anchors) {
      for (const c of CITIES) {
        if (c.id === a) continue
        const key = pairKey(a, c.id)
        if (served.has(key) || seen.has(key)) continue
        seen.add(key)
        if (distanceKm(a, c.id) < MIN_ROUTE_KM) continue
        const demand = pairWeeklyDemand(state, a, c.id)
        const score = demand - pairWeeklySeats(state, a, c.id)
        if (score <= 0) continue
        out.push({ from: a < c.id ? a : c.id, to: a < c.id ? c.id : a, demand, score })
      }
    }
    return out.sort((x, y) => y.score - x.score || `${x.from}-${x.to}`.localeCompare(`${y.from}-${y.to}`)).slice(0, 12)
  }, [state, player, lens])
  const opportunityArcsLayer = useMemo(() => {
    if (opportunities.length === 0) return null
    const top = opportunities[0]!.score
    return opportunities.map((o) => {
      const d = routePathFor(o.from, o.to)
      if (d === '') return null
      return (
        <path
          key={`opp-${o.from}-${o.to}`}
          d={d}
          className="route-opportunity"
          data-testid={`opportunity-${o.from}-${o.to}`}
          style={{ '--cap-w': 0.7 + (2.6 * o.score) / Math.max(1, top) } as React.CSSProperties}
        >
          <title>{`${o.from}–${o.to}: ${o.demand.toLocaleString('en-US')} pax/wk demand, ${o.score.toLocaleString('en-US')} unmet`}</title>
        </path>
      )
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opportunities, isGlobe, globe, projKey])

  // Announced raids on the viewer's own markets: the threat drawn on the
  // pair itself, in the raider's color, before its first flight.
  const threatArcsLayer = useMemo(() => {
    const seatId = viewSeat()
    return state.airlines
      .filter((a) => a.id !== seatId && !a.bankrupt && a.campaign?.kind === 'raid' && a.campaign.target === seatId && a.campaign.pair && state.turn < a.campaign.untilTurn)
      .map((a) => {
        const [from, to] = a.campaign!.pair!.split('-') as [string, string]
        const d = routePathFor(from, to)
        if (d === '') return null
        return (
          <path key={`threat-${a.id}`} d={d} className={`route-threat ${rivalColorClass(a.id)}`} data-testid={`threat-${from}-${to}`}>
            <title>{`${a.name} has announced a raid on ${from}–${to}`}</title>
          </path>
        )
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, isGlobe, globe, projKey])

  // A selected city pulls its own arcs forward: the rest of the network drops
  // to context so the hub's spokes read at a glance. A selected route or a
  // flow highlight already does its own focusing and takes precedence.
  const cityFocus = selectedRouteId === undefined && !flowRouteIds?.length && selected !== null && player.routes.some((r) => r.from === selected || r.to === selected) ? selected : null
  const playerArcsLayer = useMemo(() => {
    return player.routes.map((r) => {
      const km = distanceKm(r.from, r.to)
      const isNew = newRouteIds.has(r.id)
      const isAcquired = acquiredRouteIds?.has(r.id) ?? false
      const contested = rivalPairs.has(pairKey(r.from, r.to))
      const trend = quarterResult?.byRoute.get(r.id)
      const d = routePathFor(r.from, r.to)
      if (d === '') return null
      return (
        <g key={r.id} className="route-group"
            onClick={(e) => {
              e.stopPropagation() // an arc click must not select a nearby city
              if (suppressClickRef.current) {
                suppressClickRef.current = false
                return
              }
              onRouteClick?.(r.id)
            }}
        >
          <path
            d={d}
            pathLength={1}
            data-acquired={isAcquired || undefined}
            className={`route-player ${haulClass(km)}${r.id === selectedRouteId || flowRouteIds?.includes(r.id) ? ' route-selected' : flowRouteIds?.length ? ' route-context' : cityFocus !== null && r.from !== cityFocus && r.to !== cityFocus ? ' route-context' : ''}${isNew ? ' route-new' : ''}${isAcquired ? ' route-acquired' : ''}${contested ? ' route-contested' : ''}${lensClass(r)}${trend === 'up' ? ' route-result-up' : trend === 'down' ? ' route-result-down' : ''}`}
            style={
              {
                '--cap-w': capWidth(player, r, false, state.turn),
                // Two more facts ride the same line: how full it flies (opacity
                // — a limp route is literally faint) and whether it earns (a
                // losing arc goes red). Width was already seats/wk, so an arc
                // now says size, fullness and health at once.
                '--load-o': (0.34 + (0.62 * r.lastLoadFactorBp) / 10000).toFixed(3),
              } as React.CSSProperties
            }
            data-losing={r.lastCapacity > 0 && r.lastRevenue < r.lastCost ? '' : undefined}
            data-testid={isNew ? 'route-line-new' : undefined}

          />
          <path d={d} className="route-hit" data-testid={`route-hit-${r.id}`} aria-hidden="true" />
          {isNew &&
            [r.from, r.to].map((cityId) => {
              const p = cityPt(cityId)
              if (!p.vis) return null
              return <circle key={cityId} cx={p.X} cy={p.Y} r={10 / pulseUi} className="endpoint-pulse" />
            })}
        </g>
      )
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, seat, isGlobe, globe, projKey, newRouteIds, acquiredRouteIds, lens, pulseUi, onRouteClick, selectedRouteId, flowRouteIds, cityFocus, quarterResult])

  return { rivalArcsLayer, opportunities, opportunityArcsLayer, threatArcsLayer, playerArcsLayer }
}
