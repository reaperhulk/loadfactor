// The route dossier: one route's full story — trend lines, the competitive
// picture on the pair, controls, and the fleet flying it. Opens from the
// Routes table or by clicking an arc on the map.

import { getAircraftType } from '../data/aircraft'
import { distanceKm, pairKey } from '../data/cities'
import { FARE_DEMAND_BP } from '../data/constants'
import type { GameState } from '../engine'
import { fareFor, fuelInflationBp, pairWeeklyDemand, routeShareWeight } from '../engine/market'
import { effFuelBp } from '../engine/worldEvents'
import {
  allocateTrips,
  cabinSeats,
  effectiveFrequency,
  maxRouteFrequency,
  roundTripsPerWeek,
  routeWeeklyCapacity,
} from '../engine/queries'
import { ConfirmButton } from './ConfirmButton'
import { Sparkline } from './Sparkline'
import { assignAndSchedule } from './assign'
import { dispatch } from './session'
import { money } from './format'

interface RouteDossierProps {
  state: GameState
  routeId: number
  onClose: () => void
  onSelectRoute?: (routeId: number) => void
}

export function RouteDossier({ state, routeId, onClose, onSelectRoute }: RouteDossierProps) {
  const player = state.airlines[0]!
  const route = player.routes.find((r) => r.id === routeId)
  if (!route) return null
  const km = distanceKm(route.from, route.to)
  const demand = pairWeeklyDemand(state, route.from, route.to)
  const key = pairKey(route.from, route.to)

  // Everyone on this pair: fielded capacity, last quarter's ridership, and
  // the exact attractiveness weight resolution splits share by.
  const contenders = state.airlines
    .map((airline) => {
      const theirRoute = airline.routes.find((r) => pairKey(r.from, r.to) === key)
      if (!theirRoute) return null
      return {
        name: airline.name,
        me: airline.id === 0,
        capacity: routeWeeklyCapacity(airline, theirRoute),
        pax: theirRoute.lastPax,
        fare: fareFor(km, theirRoute.fareLevel),
        serviceLevel: theirRoute.serviceLevel,
        weight: routeShareWeight(airline, theirRoute),
      }
    })
    .filter((c): c is NonNullable<typeof c> => c !== null)
  const totalPax = contenders.reduce((sum, c) => sum + c.pax, 0)
  const myWeight = contenders.find((c) => c.me)?.weight ?? 0

  const assigned = player.fleet.filter((a) => a.routeId === route.id)
  // Idle airframes with the legs for this route — one pick adds them to the
  // schedule (assign + frequency bump in one intent).
  const idleCapable = player.fleet.filter((a) => a.routeId === null && getAircraftType(a.type).rangeKm >= km)
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
        <span>
          {onSelectRoute && player.routes.length > 1 && (
            <>
              <button
                aria-label="previous route"
                data-testid="route-dossier-prev"
                onClick={() => {
                  const idx = player.routes.findIndex((r) => r.id === routeId)
                  const prev = player.routes[(idx - 1 + player.routes.length) % player.routes.length]!
                  onSelectRoute(prev.id)
                }}
              >
                ‹
              </button>{' '}
              <button
                aria-label="next route"
                data-testid="route-dossier-next"
                onClick={() => {
                  const idx = player.routes.findIndex((r) => r.id === routeId)
                  const next = player.routes[(idx + 1) % player.routes.length]!
                  onSelectRoute(next.id)
                }}
              >
                ›
              </button>{' '}
            </>
          )}
          <button onClick={onClose} aria-label="close route dossier" data-testid="route-dossier-close">
            ✕
          </button>
        </span>
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
        {(() => {
          // Fuel exposure: this route's estimated fuel bill at today's index
          // (honoring a hedge), and what a 20% spike would add.
          const base = player.fuelHedge !== null ? player.fuelHedge.bp : effFuelBp(state.world)
          const fuelBp = Math.floor((base * fuelInflationBp(state.turn)) / 10000)
          let weeklyFuel = 0
          for (const alloc of allocateTrips(player, route)) {
            weeklyFuel += Math.floor(
              (alloc.trips * 2 * km * getAircraftType(alloc.type).fuelPerKm * fuelBp) / 10000,
            )
          }
          const quarterFuelK = Math.floor((weeklyFuel * 13) / 1000)
          if (quarterFuelK <= 0) return null
          return (
            <span data-testid="fuel-exposure">
              {' '}
              · fuel ~{money(quarterFuelK)}/q{player.fuelHedge !== null ? ' (hedged)' : ''} — a 20% index
              spike adds {money(Math.floor(quarterFuelK / 5))}
            </span>
          )
        })()}
      </div>

      {route.history.length >= 2 && (
        <details className="dossier-history">
          <summary className="dim">Quarter by quarter ({Math.min(8, route.history.length)}q)</summary>
          <table>
            <thead>
              <tr className="dim">
                <th>q</th>
                <th>pax</th>
                <th>conn</th>
                <th>load</th>
                <th>rev</th>
                <th>P&L</th>
              </tr>
            </thead>
            <tbody>
              {route.history.slice(-8).map((h) => (
                <tr key={h.turn}>
                  <td className="dim">t{h.turn}</td>
                  <td>{h.pax.toLocaleString('en-US')}</td>
                  <td className="dim">{h.transferPax}</td>
                  <td>{(h.loadFactorBp / 100).toFixed(0)}%</td>
                  <td>{money(h.revenue)}</td>
                  <td className={h.revenue - h.cost >= 0 ? 'pos' : 'neg'}>{money(h.revenue - h.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      {(() => {
        // Fare what-if: the engine's own share/elasticity math replayed at
        // each posture, holding everyone else fixed. Direct traffic only —
        // connections and cabin yield ride on top, so treat it as relative.
        const othersWeight = contenders.filter((c) => !c.me).reduce((sum, c) => sum + c.weight, 0)
        const myCapacity = routeWeeklyCapacity(player, route)
        if (myCapacity === 0) return null
        const rows = [-2, -1, 0, 1, 2].map((level) => {
          const weight = routeShareWeight(player, { ...route, fareLevel: level })
          const total = weight + othersWeight
          let pax = total > 0 ? Math.floor((demand * weight) / total) : 0
          pax = Math.floor((pax * FARE_DEMAND_BP[level + 2]!) / 10000)
          pax = Math.min(pax, myCapacity)
          const fare = fareFor(km, level)
          return { level, fare, pax, revenueK: Math.floor((pax * fare) / 1000) }
        })
        const best = Math.max(...rows.map((r) => r.revenueK))
        return (
          <details className="dossier-history" data-testid="fare-whatif">
            <summary className="dim">What-if: fare posture</summary>
            <table>
              <thead>
                <tr className="dim">
                  <th>fare</th>
                  <th>est. pax/wk</th>
                  <th>est. revenue/wk</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.level} className={r.level === route.fareLevel ? 'me' : ''}>
                    <td>
                      ${r.fare}
                      {r.level === route.fareLevel && <span className="dim"> (now)</span>}
                    </td>
                    <td>{r.pax.toLocaleString('en-US')}</td>
                    <td className={r.revenueK === best ? 'pos' : ''}>{money(r.revenueK)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="hint">
              Direct traffic at today's demand, rivals held fixed. Costs barely move with fare — the
              best revenue row is usually the best profit row.
            </p>
          </details>
        )
      })()}

      <h3>Controls</h3>
      <div className="dossier-controls">
        <span data-testid="dossier-frequency">
          Schedule{' '}
          <button
            disabled={route.frequency <= 1}
            onClick={() => dispatch({ type: 'set_frequency', routeId: route.id, frequency: route.frequency - 1 })}
          >
            −
          </button>{' '}
          {effectiveFrequency(player, route)}/{maxRouteFrequency(player, route)} rt/wk{' '}
          <button
            disabled={route.frequency >= maxRouteFrequency(player, route)}
            onClick={() => dispatch({ type: 'set_frequency', routeId: route.id, frequency: route.frequency + 1 })}
          >
            +
          </button>
        </span>
        <span>
          Fare{' '}
          <button
            disabled={route.fareLevel <= -2}
            onClick={() => dispatch({ type: 'set_fare', routeId: route.id, fareLevel: route.fareLevel - 1 })}
          >
            −
          </button>{' '}
          ${fareFor(km, route.fareLevel)}{' '}
          <button
            disabled={route.fareLevel >= 2}
            onClick={() => dispatch({ type: 'set_fare', routeId: route.id, fareLevel: route.fareLevel + 1 })}
          >
            +
          </button>
        </span>
        <span>
          Service{' '}
          <button
            disabled={route.serviceLevel <= 1}
            onClick={() => dispatch({ type: 'set_service', routeId: route.id, serviceLevel: route.serviceLevel - 1 })}
          >
            −
          </button>{' '}
          {['', 'basic', 'standard', 'premium'][route.serviceLevel]}{' '}
          <button
            disabled={route.serviceLevel >= 3}
            onClick={() => dispatch({ type: 'set_service', routeId: route.id, serviceLevel: route.serviceLevel + 1 })}
          >
            +
          </button>
        </span>
        <ConfirmButton
          label="close route"
          confirmLabel="really close it?"
          onConfirm={() => dispatch({ type: 'close_route', routeId: route.id })}
        />
      </div>

      <h3>The pair{contenders.length > 1 ? ' — contested' : ''}</h3>
      <table data-testid="pair-battle">
        <thead>
          <tr className="dim">
            <th />
            <th>share</th>
            <th>seats/wk</th>
            <th>fare</th>
            <th>svc</th>
            <th>appeal</th>
          </tr>
        </thead>
        <tbody>
          {contenders.map((c) => (
            <tr key={c.name} className={c.me ? 'me' : ''}>
              <td>{c.me ? 'You' : c.name}</td>
              <td>{totalPax > 0 ? `${Math.round((c.pax * 100) / totalPax)}%` : '—'}</td>
              <td>{c.capacity}</td>
              <td>${c.fare}</td>
              <td className="dim">{['', 'basic', 'std', 'prem'][c.serviceLevel]}</td>
              <td className={!c.me && myWeight > 0 && c.weight > myWeight ? 'neg' : ''}>
                {myWeight > 0 ? Math.round((c.weight * 100) / myWeight) : c.weight > 0 ? '∞' : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {contenders.length > 1 && (
        <p className="hint">
          Share splits by appeal (yours = 100): schedule × cabin × fare posture × service × brand.
          Out-schedule, undercut, out-serve, or out-market them to take riders.
        </p>
      )}

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
                  <td>
                    {type.name}{' '}
                    <span className="dim">
                      {['', 'dense', 'std', 'prem'][a.cabin]} · {cabinSeats(a.type, a.cabin)} seats
                    </span>
                  </td>
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
      {idleCapable.length > 0 && (
        <label className="dossier-add-aircraft">
          Add aircraft:{' '}
          <select
            data-testid="dossier-add-aircraft"
            value=""
            onChange={(e) => {
              if (e.target.value !== '') assignAndSchedule(state, Number(e.target.value), route.id)
            }}
          >
            <option value="">— idle aircraft ({idleCapable.length}) —</option>
            {idleCapable.map((a) => (
              <option key={a.id} value={a.id}>
                {getAircraftType(a.type).name} · {cabinSeats(a.type, a.cabin)} seats ·{' '}
                {roundTripsPerWeek(a.type, km)} rt/wk
              </option>
            ))}
          </select>
        </label>
      )}
    </aside>
  )
}
