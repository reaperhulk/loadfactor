import { lazy, Suspense } from 'react'
import type { FlowFocus } from './PassengerFlows'
const PassengerFlows = lazy(() => import('./PassengerFlows').then(m=>({default:m.PassengerFlows})))
// The route dossier: one route's full story — trend lines, the competitive
// picture on the pair, controls, and the fleet flying it. Opens from the
// Routes table or by clicking an arc on the map.

import { useEffect, useRef } from 'react'
import { getAircraftType } from '../data/aircraft'
import { distanceKm, pairKey } from '../data/cities'
import { FARE_DEMAND_BP, ROUTE_MEMORY_QUARTERS } from '../data/constants'
import type { GameState } from '../engine'
import { fareFor, pairWeeklyDemand, routeShareWeight, routeSpoolBp, seasonalBp } from '../engine/market'
import {
  isGrounded,
  cabinSeats,
  roundTripsPerWeek,
  routeWeeklyCapacity,
} from '../engine/queries'
import { RoutePlanner } from './RoutePlanner'
import { ConfirmButton } from './ConfirmButton'
import { Sparkline } from './Sparkline'
import { assignAndSchedule } from './assign'
import { FuelExposure, RouteWhatIf } from './RouteWhatIf'
import { rulesOf } from '../engine/version'
import { HubLegend, SpoolLegend } from './legends'
import { viewSeat, dispatch } from './session'
import { money } from './format'

interface RouteDossierProps {
  onHighlight?: (focus:FlowFocus)=>void
  state: GameState
  routeId: number
  onClose: () => void
  onSelectRoute?: (routeId: number) => void
}

export function RouteDossier({ state, routeId, onClose, onSelectRoute, onHighlight }: RouteDossierProps) {
  const panel = useRef<HTMLElement>(null)
  useEffect(() => { panel.current?.scrollTo(0, 0) }, [routeId])
  useEffect(() => { panel.current?.querySelector<HTMLButtonElement>('[data-testid=route-dossier-close]')?.focus({ preventScroll: true }) }, [])
  const player = state.airlines[viewSeat()]!
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
        me: airline.id === viewSeat(),
        capacity: routeWeeklyCapacity(airline, theirRoute, state.turn),
        pax: theirRoute.lastPax,
        fare: fareFor(km, theirRoute.fareLevel),
        serviceLevel: theirRoute.serviceLevel,
        weight: routeShareWeight(airline, theirRoute),
      }
    })
    .filter((c): c is NonNullable<typeof c> => c !== null)
  const totalPax = contenders.reduce((sum, c) => sum + c.pax, 0)
  const myWeight = contenders.find((c) => c.me)?.weight ?? 0

  const assigned = player.fleet.filter((a) => (a.routeId === route.id || a.secondaryRouteId === route.id))
  // Idle airframes with the legs for this route — one pick adds them to the
  // schedule (assign + frequency bump in one intent).
  const idleCapable = player.fleet.filter((a) => a.routeId === null && !a.reserve && !isGrounded(a, state.turn) && getAircraftType(a.type).rangeKm >= km)
  // Surface the market model: connecting traffic actually flown over this leg
  // last quarter, and elasticity of the current fare posture.
  const elasticityBp = FARE_DEMAND_BP[route.fareLevel + 2]!
  const profitTrend = route.history.map((h) => h.revenue - h.cost)
  const lfTrend = route.history.map((h) => h.loadFactorBp)

  return (
    <aside ref={panel} onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() } }} className="city-panel route-dossier" data-testid="route-dossier">
      <header className="city-panel-head">
        <div>
          <h2>
            {route.from}–{route.to}
          </h2>
          <span className="dim">
            {km}km · demand {demand}/wk · fare ${fareFor(km, route.fareLevel)}
            {routeSpoolBp(player, route, state.turn) < 10000 && (
              <span className="neg" data-testid="route-ramping">
                {' '}
                · ramping — attaches {routeSpoolBp(player, route, state.turn) / 100}% of its share this quarter
              </span>
            )}
            {(() => {
              // Seasonal pairs: say which way the calendar is leaning.
              const bp = Math.floor(
                (seasonalBp(route.from, state.turn) * seasonalBp(route.to, state.turn)) / 10000,
              )
              if (bp > 10100)
                return (
                  <span className="pos" data-testid="route-season">
                    {' '}
                    · 🌞 high season (+{((bp - 10000) / 100).toFixed(1)}%)
                  </span>
                )
              if (bp < 9900)
                return (
                  <span className="neg" data-testid="route-season">
                    {' '}
                    · ❄ off season ({((bp - 10000) / 100).toFixed(1)}%)
                  </span>
                )
              return null
            })()}
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

      <section className="route-actuals"><span className="eyebrow">Last quarter · actual</span>{route.history.length === 0 ? <p className="dim">Not flown yet</p> : <dl className="entity-facts"><div><dt>Contribution</dt><dd className={route.lastRevenue >= route.lastCost ? 'pos' : 'neg'}>{money(route.lastRevenue-route.lastCost)}</dd></div><div><dt>Load factor</dt><dd>{(route.lastLoadFactorBp/100).toFixed(0)}%</dd></div></dl>}</section>
      <RoutePlanner key={`${route.id}-${route.fareLevel}-${route.serviceLevel}-${route.frequency}`} state={state} route={route} />
      {route.lastSegments && <section className="segment-results"><h3>Who flies with you</h3>
        <p>Business {route.lastSegments.business.toLocaleString()} · Leisure {route.lastSegments.leisure.toLocaleString()} · Budget {route.lastSegments.budget.toLocaleString()}</p>
        <p>Connections contribute {money(route.lastTransferRevenue ?? 0)} of route revenue. Removing a feeder also removes its connecting traffic from the other leg.</p>
        <p className="dim">Passengers choose among direct flights and every viable one-stop. One connecting journey uses a seat on each leg; reported passengers count boardings.</p>
      </section>}
      <Suspense fallback={null}><PassengerFlows state={state} routeId={routeId} onHighlight={onHighlight} /></Suspense>
      <h3>Trend (last {route.history.length}q)</h3>
      <div className="trend-row">
        <span className="dim">load</span>
        <Sparkline points={lfTrend} min={0} max={10000} className="sparkline spark-lf" />
        <span>{(route.lastLoadFactorBp / 100).toFixed(0)}%</span>
      </div>
      <div className="trend-row">
        <span className="dim">contribution</span>
        <Sparkline points={profitTrend} className="sparkline spark-profit" />
        <span className={route.lastRevenue - route.lastCost >= 0 ? 'pos' : 'neg'}>
          {money(route.lastRevenue - route.lastCost)}/q
        </span>
      </div>

      <div className="dim" data-testid="route-economics-notes">
        Connecting boardings last quarter: {route.lastTransferPax} · {rulesOf(state) === 1
          ? `fare posture ${elasticityBp >= 10000 ? 'attracts' : 'sheds'} ${Math.abs((elasticityBp - 10000) / 100).toFixed(0)}% of demand`
          : 'business, leisure and budget passengers respond differently to fares and service'}
        <FuelExposure state={state} routeId={route.id} />
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

      <RouteWhatIf state={state} route={route} mode="fare" />
      <RouteWhatIf state={state} route={route} mode="service" />
      <RouteWhatIf state={state} route={route} mode="closure" />

      <SpoolLegend />
      <HubLegend />

      <details className="entity-actions"><summary>Close this route</summary><p className="hint">Removes the schedule and releases assigned aircraft. The market remembers this pair for {ROUTE_MEMORY_QUARTERS} quarters.</p><ConfirmButton label="close route" confirmLabel="really close it?" onConfirm={() => { dispatch({ type:'close_route', routeId:route.id }); onClose() }} /></details>

      <h3>The pair{contenders.length > 1 ? ' — contested' : ''}</h3>
      <table data-testid="pair-battle">
        <thead>
          <tr className="dim">
            <th />
            <th>share</th>
            <th>seats/wk</th>
            <th>fare</th>
            <th>svc</th>
            {rulesOf(state) === 1 && <th>appeal</th>}
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
              {rulesOf(state) === 1 && <td className={!c.me && myWeight > 0 && c.weight > myWeight ? 'neg' : ''}>
                {myWeight > 0 ? Math.round((c.weight * 100) / myWeight) : c.weight > 0 ? '∞' : '—'}
              </td>}
            </tr>
          ))}
        </tbody>
      </table>
      {rulesOf(state) === 1 && contenders.length > 1 && (
        <p className="hint">
          Share splits by appeal (yours = 100): schedule × cabin × fare posture × service × brand.
          Out-schedule, undercut, out-serve, or out-market them to take riders.
        </p>
      )}

      {rulesOf(state) >= 2 && <p className="hint">Shares compare boardings on these direct services. Business, leisure and budget passengers also compare connecting itineraries across competing hubs.</p>}

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
