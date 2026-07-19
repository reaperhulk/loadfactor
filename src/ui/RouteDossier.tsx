// The route dossier: one route's full story — trend lines, the competitive
// picture on the pair, controls, and the fleet flying it. Opens from the
// Routes table or by clicking an arc on the map.

import { getAircraftType } from '../data/aircraft'
import { distanceKm, pairKey } from '../data/cities'
import { FARE_DEMAND_BP } from '../data/constants'
import type { GameState } from '../engine'
import { fareFor, pairWeeklyDemand } from '../engine/market'
import { effectiveFrequency, maxRouteFrequency, roundTripsPerWeek, routeWeeklyCapacity } from '../engine/queries'
import { Sparkline } from './Sparkline'
import { dispatch } from './session'

function money(k: number): string {
  return k >= 1000 || k <= -1000 ? `$${(k / 1000).toFixed(1)}M` : `$${k}k`
}

interface RouteDossierProps {
  state: GameState
  routeId: number
  onClose: () => void
}

export function RouteDossier({ state, routeId, onClose }: RouteDossierProps) {
  const player = state.airlines[0]!
  const route = player.routes.find((r) => r.id === routeId)
  if (!route) return null
  const km = distanceKm(route.from, route.to)
  const demand = pairWeeklyDemand(state, route.from, route.to)
  const key = pairKey(route.from, route.to)

  // Everyone on this pair, with their fielded weekly capacity.
  const contenders = state.airlines
    .map((airline) => {
      const theirRoute = airline.routes.find((r) => pairKey(r.from, r.to) === key)
      if (!theirRoute) return null
      return {
        name: airline.name,
        me: airline.id === 0,
        capacity: routeWeeklyCapacity(airline, theirRoute),
        fare: fareFor(km, theirRoute.fareLevel),
        serviceLevel: theirRoute.serviceLevel,
      }
    })
    .filter((c): c is NonNullable<typeof c> => c !== null)

  const assigned = player.fleet.filter((a) => a.routeId === route.id)
  // Surface the market model: connecting traffic actually flown over this leg
  // last quarter, and elasticity of the current fare posture.
  const elasticityBp = FARE_DEMAND_BP[route.fareLevel + 2]!
  const profitTrend = route.history.map((h) => h.revenue - h.cost)
  const lfTrend = route.history.map((h) => h.loadFactorBp)

  return (
    <aside className="city-panel route-dossier" data-testid="route-dossier">
      <header className="city-panel-head">
        <div>
          <h2>
            {route.from}–{route.to}
          </h2>
          <span className="dim">
            {km}km · demand {demand}/wk · fare ${fareFor(km, route.fareLevel)}
          </span>
        </div>
        <button onClick={onClose} aria-label="close route dossier" data-testid="route-dossier-close">
          ✕
        </button>
      </header>

      <h3>Trend (last {route.history.length}q)</h3>
      <div className="trend-row">
        <span className="dim">load</span>
        <Sparkline points={lfTrend} min={0} max={10000} className="sparkline spark-lf" />
        <span>{(route.lastLoadFactorBp / 100).toFixed(0)}%</span>
      </div>
      <div className="trend-row">
        <span className="dim">profit</span>
        <Sparkline points={profitTrend} className="sparkline spark-profit" />
        <span className={route.lastRevenue - route.lastCost >= 0 ? 'pos' : 'neg'}>
          {money(route.lastRevenue - route.lastCost)}/q
        </span>
      </div>

      <div className="dim" data-testid="route-economics-notes">
        Connecting pax last quarter: {route.lastTransferPax} · fare posture{' '}
        {elasticityBp >= 10000 ? 'attracts' : 'sheds'} {Math.abs((elasticityBp - 10000) / 100).toFixed(0)}% of demand
      </div>

      <h3>Controls</h3>
      <div className="dossier-controls">
        <span data-testid="dossier-frequency">
          Schedule{' '}
          <button
            onClick={() => dispatch({ type: 'set_frequency', routeId: route.id, frequency: route.frequency - 1 })}
          >
            −
          </button>{' '}
          {effectiveFrequency(player, route)}/{maxRouteFrequency(player, route)} rt/wk{' '}
          <button
            onClick={() => dispatch({ type: 'set_frequency', routeId: route.id, frequency: route.frequency + 1 })}
          >
            +
          </button>
        </span>
        <span>
          Fare{' '}
          <button onClick={() => dispatch({ type: 'set_fare', routeId: route.id, fareLevel: route.fareLevel - 1 })}>
            −
          </button>{' '}
          ${fareFor(km, route.fareLevel)}{' '}
          <button onClick={() => dispatch({ type: 'set_fare', routeId: route.id, fareLevel: route.fareLevel + 1 })}>
            +
          </button>
        </span>
        <span>
          Service{' '}
          <button
            onClick={() => dispatch({ type: 'set_service', routeId: route.id, serviceLevel: route.serviceLevel - 1 })}
          >
            −
          </button>{' '}
          {['', 'basic', 'standard', 'premium'][route.serviceLevel]}{' '}
          <button
            onClick={() => dispatch({ type: 'set_service', routeId: route.id, serviceLevel: route.serviceLevel + 1 })}
          >
            +
          </button>
        </span>
        <button onClick={() => dispatch({ type: 'close_route', routeId: route.id })}>close route</button>
      </div>

      <h3>The pair</h3>
      <table>
        <tbody>
          {contenders.map((c) => (
            <tr key={c.name} className={c.me ? 'me' : ''}>
              <td>{c.me ? 'You' : c.name}</td>
              <td>{c.capacity} seats/wk</td>
              <td>${c.fare}</td>
              <td className="dim">{['', 'basic', 'standard', 'premium'][c.serviceLevel]}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Fleet on this route</h3>
      {assigned.length === 0 ? (
        <p className="hint">No aircraft assigned — this route flies nothing.</p>
      ) : (
        <table>
          <tbody>
            {assigned.map((a) => {
              const type = getAircraftType(a.type)
              return (
                <tr key={a.id}>
                  <td>{type.name}</td>
                  <td>{roundTripsPerWeek(a.type, km)} rt/wk</td>
                  <td>
                    <button onClick={() => dispatch({ type: 'assign_aircraft', aircraftId: a.id, routeId: null })}>
                      unassign
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </aside>
  )
}
