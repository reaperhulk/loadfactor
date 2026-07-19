// Management panels: routes, fleet, airports, finance, and the quarterly
// report. Every button is a Command dispatch — no state is touched directly.

import { useState } from 'react'
import { AIRCRAFT, getAircraftType, typesOnSale } from '../data/aircraft'
import { CITIES, distanceKm, pairKey } from '../data/cities'
import { MIN_ROUTE_KM, NEG_MIN_SPEND } from '../data/constants'
import type { CostBreakdown, GameEvent, GameState } from '../engine'
import { baseFare, estimateAircraftQuarterCost, estimateWeeklySeats, fareFor, pairWeeklyDemand, seasonalBp } from '../engine/market'
import {
  CABIN_REFIT_COST_BP,
  MAINT_AGE_BP_PER_QUARTER,
  ORDER_CANCEL_REFUND_BP,
  SLOT_IDLE_QUARTERS_TO_LOSE,
  SLOT_IDLE_THRESHOLD,
  HEDGE_MAX_QUARTERS,
  HEDGE_MIN_QUARTERS,
  HEDGE_PREMIUM_PER_AIRCRAFT,
  LEASE_BP_PER_QUARTER,
  MARKETING_BASE_PER_LEVEL,
  MARKETING_PER_ROUTE_PER_LEVEL,
  MARKETING_WEIGHT_BP_PER_LEVEL,
  ROUTE_OVERHEAD_QUAD,
} from '../data/constants'
import { inflationBp } from '../engine/market'
import { negotiationDifficulty, scarcityChanceBp } from '../engine/negotiation'
import {
  airlinesOnPair,
  allocateTrips,
  currentLoanRateBp,
  networkCities,
  cabinSeats,
  debtCeiling,
  effectiveFrequency,
  maxRouteFrequency,
  resaleValue,
  roundTripsPerWeek,
  routeWeeklyCapacity,
  slotCities,
  slotsAllocated,
  slotsFree,
  slotsHeld,
  slotsUsed,
  totalDebt,
  yearOf,
} from '../engine/queries'
import { assignAndSchedule } from './assign'
import { ConfirmButton } from './ConfirmButton'
import { dispatch, getSession } from './session'
import { Sparkline } from './Sparkline'
import { COST_LABELS, copyTsv, money } from './format'
import { CabinLegend, ServiceLegend } from './legends'

// Sort keys for the routes comparison table. Each computes from the same row
// model the cells render, so what you sort is exactly what you see.
type RouteSortKey = 'name' | 'km' | 'load' | 'revenue' | 'profit' | 'margin' | 'rivals'

export function RoutesPanel({
  state,
  onInspect,
  onPlan,
}: {
  state: GameState
  onInspect: (routeId: number) => void
  onPlan?: (from: string, to: string) => void
}) {
  const player = state.airlines[0]!
  const [sortKey, setSortKey] = useState<RouteSortKey>('profit')
  const [sortAsc, setSortAsc] = useState(false)
  if (player.routes.length === 0) {
    // Even before the first route, the opportunities list is the guidance
    // that matters most.
    return (
      <div>
        <p className="hint">No routes yet. Click a city on the map, then “Open route from here”.</p>
        <Opportunities state={state} onPlan={onPlan} />
      </div>
    )
  }
  const networkOverhead = Math.floor(
    (ROUTE_OVERHEAD_QUAD * player.routes.length * player.routes.length * inflationBp(state.turn)) / 10000,
  )
  const rows = player.routes.map((r) => {
    const prev = r.history.length >= 2 ? r.history[r.history.length - 2] : undefined
    const profit = r.lastRevenue - r.lastCost
    return {
      route: r,
      km: distanceKm(r.from, r.to),
      planes: player.fleet.filter((a) => a.routeId === r.id).length,
      rivals: airlinesOnPair(state, r.from, r.to, 0),
      profit,
      marginBp: r.lastRevenue > 0 ? Math.floor((profit * 10000) / r.lastRevenue) : 0,
      profitTrend: prev === undefined ? 0 : profit - (prev.revenue - prev.cost),
    }
  })
  const dir = sortAsc ? 1 : -1
  rows.sort((a, b) => {
    switch (sortKey) {
      case 'name':
        return dir * `${a.route.from}${a.route.to}`.localeCompare(`${b.route.from}${b.route.to}`)
      case 'km':
        return dir * (a.km - b.km)
      case 'load':
        return dir * (a.route.lastLoadFactorBp - b.route.lastLoadFactorBp)
      case 'revenue':
        return dir * (a.route.lastRevenue - b.route.lastRevenue)
      case 'margin':
        return dir * (a.marginBp - b.marginBp)
      case 'rivals':
        return dir * (a.rivals - b.rivals)
      default:
        return dir * (a.profit - b.profit)
    }
  })
  const header = (key: RouteSortKey, label: string) => (
    <th>
      <button
        className={`link-btn sort-btn${sortKey === key ? ' active' : ''}`}
        data-testid={`sort-${key}`}
        onClick={() => {
          if (sortKey === key) setSortAsc(!sortAsc)
          else {
            setSortKey(key)
            setSortAsc(key === 'name' || key === 'km')
          }
        }}
      >
        {label}
        {sortKey === key ? (sortAsc ? ' ▲' : ' ▼') : ''}
      </button>
    </th>
  )
  return (
    <div>
    <p className="dim" data-testid="network-overhead">
      Network management: {money(networkOverhead)}/quarter for {player.routes.length} routes (grows with the
      square of the network — quality beats sprawl){' '}
      <button
        className="link-btn"
        data-testid="copy-routes"
        title="copy this table as TSV — paste into any spreadsheet (raw numbers, $k)"
        onClick={() =>
          copyTsv(
            ['route', 'km', 'fareUsd', 'service', 'planes', 'rivals', 'loadBp', 'revenueK', 'marginBp', 'profitK'],
            rows.map((x) => [
              `${x.route.from}-${x.route.to}`,
              x.km,
              fareFor(x.km, x.route.fareLevel),
              x.route.serviceLevel,
              x.planes,
              x.rivals,
              x.route.lastLoadFactorBp,
              x.route.lastRevenue,
              x.marginBp,
              x.profit,
            ]),
          )
        }
      >
        ⎘ copy as spreadsheet
      </button>
    </p>
    <div className="table-scroll"><table>
      <thead>
        <tr>
          {header('name', 'Route')}
          {header('km', 'km')}
          <th>Fare</th>
          <th>Service</th>
          <th>Planes</th>
          <th>Freq/wk</th>
          {header('rivals', 'Rivals')}
          {header('load', 'Load')}
          {header('revenue', 'Rev')}
          {header('margin', 'Margin')}
          {header('profit', 'P&L')}
          <th />
        </tr>
      </thead>
      <tbody>
        {rows.map(({ route: r, km, planes, rivals: rivalsHere, profit, marginBp, profitTrend }) => {
          const freq = `${effectiveFrequency(player, r)}/${maxRouteFrequency(player, r)}`
          return (
            <tr key={r.id} data-testid={`route-${r.from}-${r.to}`}>
              <td>
                <button
                  className="link-btn"
                  data-testid={`inspect-${r.from}-${r.to}`}
                  onClick={() => onInspect(r.id)}
                  title="open route dossier"
                >
                  {r.from}–{r.to}
                </button>
              </td>
              <td>{km}</td>
              <td>
                <button
                  disabled={r.fareLevel <= -2}
                  onClick={() => dispatch({ type: 'set_fare', routeId: r.id, fareLevel: r.fareLevel - 1 })}
                >
                  −
                </button>
                ${fareFor(km, r.fareLevel)}
                <button
                  disabled={r.fareLevel >= 2}
                  onClick={() => dispatch({ type: 'set_fare', routeId: r.id, fareLevel: r.fareLevel + 1 })}
                >
                  +
                </button>
              </td>
              <td>
                <button
                  disabled={r.serviceLevel <= 1}
                  onClick={() => dispatch({ type: 'set_service', routeId: r.id, serviceLevel: r.serviceLevel - 1 })}
                >
                  −
                </button>
                {['', 'basic', 'standard', 'premium'][r.serviceLevel]}
                <button
                  disabled={r.serviceLevel >= 3}
                  onClick={() => dispatch({ type: 'set_service', routeId: r.id, serviceLevel: r.serviceLevel + 1 })}
                >
                  +
                </button>
              </td>
              <td>{planes}</td>
              <td>{freq}</td>
              <td className={rivalsHere > 0 ? 'neg' : 'dim'}>{rivalsHere > 0 ? `⚔ ${rivalsHere}` : '—'}</td>
              <td>
                <span className="lf-bar">
                  <span className="lf-fill" style={{ width: `${r.lastLoadFactorBp / 100}%` }} />
                </span>
                {(r.lastLoadFactorBp / 100).toFixed(0)}%
              </td>
              <td>{money(r.lastRevenue)}</td>
              <td className={marginBp >= 0 ? 'pos' : 'neg'}>{(marginBp / 100).toFixed(0)}%</td>
              <td className={profit >= 0 ? 'pos' : 'neg'}>
                {money(profit)}
                {profitTrend !== 0 && (
                  <span className={profitTrend > 0 ? 'pos' : 'neg'} title="vs previous quarter">
                    {' '}
                    {profitTrend > 0 ? '▲' : '▼'}
                  </span>
                )}
              </td>
              <td>
                <ConfirmButton
                  label="close"
                  confirmLabel="sure?"
                  onConfirm={() => dispatch({ type: 'close_route', routeId: r.id })}
                />
              </td>
            </tr>
          )
        })}
      </tbody>
    </table></div>
    <ServiceLegend />
    <Opportunities state={state} onPlan={onPlan} />
    </div>
  )
}

// The planning tool the bots keep to themselves: the richest unserved pairs
// you could open from your current slots and network, market-dollars first.
function Opportunities({ state, onPlan }: { state: GameState; onPlan?: (from: string, to: string) => void }) {
  const player = state.airlines[0]!
  const network = networkCities(player)
  const cities = slotCities(player)
  const served = new Set(player.routes.map((r) => pairKey(r.from, r.to)))
  let idleReach = 0
  for (const a of player.fleet) {
    if (a.routeId === null) idleReach = Math.max(idleReach, getAircraftType(a.type).rangeKm)
  }
  const rows: { from: string; to: string; km: number; demand: number; marketK: number; rivals: number }[] = []
  for (let i = 0; i < cities.length; i++) {
    for (let j = i + 1; j < cities.length; j++) {
      const a = cities[i]!
      const b = cities[j]!
      if (served.has(pairKey(a, b))) continue
      if (!network.has(a) && !network.has(b)) continue
      if (slotsFree(player, a) < 1 || slotsFree(player, b) < 1) continue
      const km = distanceKm(a, b)
      if (km < MIN_ROUTE_KM) continue
      const demand = pairWeeklyDemand(state, a, b)
      rows.push({
        from: a,
        to: b,
        km,
        demand,
        marketK: Math.floor((demand * baseFare(km)) / 1000),
        rivals: airlinesOnPair(state, a, b, 0),
      })
    }
  }
  rows.sort((x, y) => y.marketK - x.marketK)
  const top = rows.slice(0, 5)
  // Where to expand next: the richest markets from your network you have NO
  // slots for yet — negotiation targets, ranked by the same market dollars.
  const networkList = [...network].sort()
  const negotiable: { from: string; to: string; marketK: number }[] = []
  for (const c of CITIES) {
    if (slotsHeld(player, c.id) > 0) continue
    if (slotsAllocated(state, c.id) >= c.slotPool) continue
    let bestFrom = ''
    let bestMarket = 0
    for (const a of networkList) {
      const km = distanceKm(a, c.id)
      if (km < MIN_ROUTE_KM) continue
      const m = Math.floor((pairWeeklyDemand(state, a, c.id) * baseFare(km)) / 1000)
      if (m > bestMarket) {
        bestMarket = m
        bestFrom = a
      }
    }
    if (bestFrom !== '') negotiable.push({ from: bestFrom, to: c.id, marketK: bestMarket })
  }
  negotiable.sort((x, y) => y.marketK - x.marketK)
  if (top.length === 0 && negotiable.length === 0) return null
  return (
    <div data-testid="opportunities">
      <h3>Opportunities — unserved pairs you hold slots for</h3>
      <div className="table-scroll">
        <table>
          <tbody>
            {top.map((r) => (
              <tr key={`${r.from}-${r.to}`}>
                <td>
                  {r.from}–{r.to}
                </td>
                <td>{r.km}km</td>
                <td>
                  {r.demand}/wk
                  {(() => {
                    // A seasonal pair's demand number is a snapshot, not a
                    // promise — flag which way the calendar is leaning.
                    const bp = Math.floor(
                      (seasonalBp(r.from, state.turn) * seasonalBp(r.to, state.turn)) / 10000,
                    )
                    if (bp > 10100) return <span className="pos" title="tourism high season — demand dips off-season"> 🌞</span>
                    if (bp < 9900) return <span className="neg" title="tourism off season — demand rises in season"> ❄</span>
                    return null
                  })()}
                </td>
                <td title="weekly demand × base fare">{money(r.marketK)}/wk</td>
                <td className={r.rivals > 0 ? 'neg' : 'pos'}>
                  {r.rivals > 0 ? `⚔ ${r.rivals} rival${r.rivals > 1 ? 's' : ''}` : 'open market'}
                </td>
                <td className="dim">{r.km > idleReach ? 'needs an idle aircraft with range' : 'launchable now'}</td>
                <td>
                  {onPlan && r.km <= idleReach && (
                    <button data-testid={`plan-${r.from}-${r.to}`} onClick={() => onPlan(r.from, r.to)}>
                      plan ✈
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {negotiable.length > 0 && (
        <p className="dim" data-testid="negotiation-targets">
          Worth negotiating:{' '}
          {negotiable
            .slice(0, 3)
            .map((n) => `${n.to} (${money(n.marketK)}/wk vs ${n.from})`)
            .join(' · ')}{' '}
          — win slots there from the airports tab or the city panel.
        </p>
      )}
    </div>
  )
}

type FleetSortKey = 'type' | 'age' | 'util' | 'maint' | 'value'

export function FleetPanel({ state }: { state: GameState }) {
  const player = state.airlines[0]!
  const year = yearOf(state)
  const [fleetSort, setFleetSort] = useState<FleetSortKey>('type')
  const [fleetAsc, setFleetAsc] = useState(true)
  // Renewal forecast: what the fleet costs to keep today, what the same
  // metal will cost in two years of aging and inflation, and how many
  // airframes cross into geriatric territory on the way.
  const maintAt = (turnsAhead: number): number => {
    let total = 0
    for (const a of player.fleet) {
      const t = getAircraftType(a.type)
      const aged = Math.floor(
        (t.maintBase * (10000 + MAINT_AGE_BP_PER_QUARTER * (a.ageQuarters + turnsAhead))) / 10000,
      )
      total += Math.floor((aged * inflationBp(state.turn + turnsAhead)) / 10000)
    }
    return total
  }
  const geriatricNow = player.fleet.filter((a) => a.ageQuarters >= 48).length
  const geriatricSoon = player.fleet.filter((a) => a.ageQuarters >= 40 && a.ageQuarters < 48).length
  return (
    <div>
      {player.fleet.some((a) => a.routeId === null) && player.routes.length > 0 && (
        <button
          data-testid="assign-all-idle"
          title="assign every idle airframe to the in-range route most starved for seats"
          onClick={() => {
            // Greedy pass, one plane at a time against live state so each
            // assignment sees the capacity the previous one just added.
            for (let guard = 0; guard < 50; guard++) {
              const s = getSession()?.state
              if (!s) return
              const p = s.airlines[0]!
              const idle = p.fleet.find((a) => a.routeId === null)
              if (!idle) return
              const t = getAircraftType(idle.type)
              let bestRoute: (typeof p.routes)[number] | null = null
              let bestGap = 0
              for (const r of p.routes) {
                if (distanceKm(r.from, r.to) > t.rangeKm) continue
                const gap = pairWeeklyDemand(s, r.from, r.to) - routeWeeklyCapacity(p, r)
                if (gap > bestGap) {
                  bestGap = gap
                  bestRoute = r
                }
              }
              if (!bestRoute) return
              assignAndSchedule(s, idle.id, bestRoute.id)
            }
          }}
        >
          🛠 put idle fleet to work
        </button>
      )}
      {player.fleet.length > 0 && (
        <p className="dim" data-testid="renewal-forecast">
          Fleet upkeep {money(maintAt(0))}/q now → {money(maintAt(8))}/q in 2 years on the same metal
          {geriatricNow > 0 && <span className="neg"> · {geriatricNow} geriatric</span>}
          {geriatricSoon > 0 && <span> · {geriatricSoon} more turn geriatric within 2y</span>}
        </p>
      )}
      {(() => {
        // Row models first so sorting works on exactly what the cells show.
        const fleetRows = player.fleet.map((a) => {
          const type = getAircraftType(a.type)
          const route = player.routes.find((r) => r.id === a.routeId)
          const alloc = route ? allocateTrips(player, route).find((x) => x.aircraftId === a.id) : undefined
          const maxTrips = route ? roundTripsPerWeek(a.type, distanceKm(route.from, route.to)) : 0
          const utilBp = alloc && maxTrips > 0 ? Math.floor((alloc.trips * 10000) / maxTrips) : 0
          const maint = Math.floor(
            (Math.floor((type.maintBase * (10000 + MAINT_AGE_BP_PER_QUARTER * a.ageQuarters)) / 10000) *
              inflationBp(state.turn)) /
              10000,
          )
          const value = a.leased ? 0 : resaleValue(a.type, a.ageQuarters)
          return { a, type, route, utilBp, maint, value }
        })
        const fdir = fleetAsc ? 1 : -1
        fleetRows.sort((x, y) => {
          switch (fleetSort) {
            case 'age':
              return fdir * (x.a.ageQuarters - y.a.ageQuarters)
            case 'util':
              return fdir * (x.utilBp - y.utilBp)
            case 'maint':
              return fdir * (x.maint - y.maint)
            case 'value':
              return fdir * (x.value - y.value)
            default:
              return fdir * (x.type.name.localeCompare(y.type.name) || x.a.id - y.a.id)
          }
        })
        const fheader = (key: FleetSortKey, label: string, title?: string) => (
          <th title={title}>
            <button
              className={`link-btn sort-btn${fleetSort === key ? ' active' : ''}`}
              data-testid={`fleet-sort-${key}`}
              onClick={() => {
                if (fleetSort === key) setFleetAsc(!fleetAsc)
                else {
                  setFleetSort(key)
                  setFleetAsc(key === 'type')
                }
              }}
            >
              {label}
              {fleetSort === key ? (fleetAsc ? ' ▲' : ' ▼') : ''}
            </button>
          </th>
        )
        return (
      <div className="table-scroll"><table>
        <thead>
          <tr>
            {fheader('type', 'Aircraft')}
            {fheader('age', 'Age')}
            {fheader('util', 'Utilization', 'round trips flown vs what this airframe could fly on its route')}
            {fheader('maint', 'Maint/q', 'this quarter’s maintenance — escalates with age and inflation')}
            {fheader('value', 'Value')}
            <th>Cabin</th>
            <th>Assignment</th>
          </tr>
        </thead>
        <tbody>
          {fleetRows.map(({ a, type, route, utilBp, maint, value }) => {
            const geriatric = a.ageQuarters >= 48
            return (
              <tr key={a.id}>
                <td>
                  {type.name} {a.leased && <span className="dim">(leased)</span>}{' '}
                  <span className="dim">({cabinSeats(a.type, a.cabin)} seats, {type.rangeKm}km)</span>
                </td>
                <td className={geriatric ? 'neg' : ''} title={geriatric ? 'maintenance hog — consider retiring' : undefined}>
                  {(a.ageQuarters / 4).toFixed(1)}y
                </td>
                <td>
                  {route ? (
                    <>
                      <span className="lf-bar">
                        <span className="lf-fill" style={{ width: `${utilBp / 100}%` }} />
                      </span>
                      {Math.round(utilBp / 100)}%
                    </>
                  ) : (
                    <>
                      <span className="neg" title="idle metal still draws salaries and ownership">
                        parked
                      </span>
                      {(() => {
                        // Best use for this airframe: the in-range route most
                        // starved for seats — one click assigns and schedules.
                        let bestRoute: (typeof player.routes)[number] | null = null
                        let bestGap = 0
                        for (const r of player.routes) {
                          const rkm = distanceKm(r.from, r.to)
                          if (rkm > type.rangeKm) continue
                          const gap = pairWeeklyDemand(state, r.from, r.to) - routeWeeklyCapacity(player, r)
                          if (gap > bestGap) {
                            bestGap = gap
                            bestRoute = r
                          }
                        }
                        if (!bestRoute) return null
                        return (
                          <button
                            className="link-btn"
                            data-testid={`suggest-${a.id}`}
                            title={`${bestGap.toLocaleString('en-US')} unmet weekly seats there`}
                            onClick={() => assignAndSchedule(state, a.id, bestRoute.id)}
                          >
                            → {bestRoute.from}–{bestRoute.to}?
                          </button>
                        )
                      })()}
                    </>
                  )}
                </td>
                <td className={geriatric ? 'neg' : 'dim'}>{money(maint)}</td>
                <td className="dim">{a.leased ? '—' : money(value)}</td>
                <td>
                  <select
                    value={a.cabin}
                    aria-label="cabin fit"
                    title={`refit costs ${money(Math.floor((type.price * CABIN_REFIT_COST_BP) / 10000))}`}
                    onChange={(e) => dispatch({ type: 'refit_cabin', aircraftId: a.id, cabin: Number(e.target.value) })}
                  >
                    <option value={1}>dense</option>
                    <option value={2}>standard</option>
                    <option value={3}>premium</option>
                  </select>
                </td>
                <td>
                  <select
                    value={a.routeId ?? ''}
                    onChange={(e) =>
                      e.target.value === ''
                        ? dispatch({ type: 'assign_aircraft', aircraftId: a.id, routeId: null })
                        : assignAndSchedule(state, a.id, Number(e.target.value))
                    }
                  >
                    <option value="">— idle —</option>
                    {player.routes.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.from}–{r.to}
                      </option>
                    ))}
                  </select>
                  <ConfirmButton
                    label={a.leased ? 'return' : 'sell'}
                    confirmLabel="sure?"
                    onConfirm={() => dispatch({ type: 'sell_aircraft', aircraftId: a.id })}
                  />
                </td>
              </tr>
            )
          })}
          {player.orders.map((o) => {
            const refund = o.leased
              ? 0
              : Math.floor((getAircraftType(o.type).price * ORDER_CANCEL_REFUND_BP) / 10000)
            return (
              <tr key={`order-${o.id}`} className="dim">
                <td>{getAircraftType(o.type).name}</td>
                <td colSpan={5}>
                  on order — delivers in {o.quartersLeft} quarter(s)
                </td>
                <td>
                  <ConfirmButton
                    data-testid={`cancel-order-${o.id}`}
                    label={o.leased ? 'cancel lease' : `cancel (${money(refund)} back)`}
                    confirmLabel="sure?"
                    onConfirm={() => dispatch({ type: 'cancel_order', orderId: o.id })}
                  />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table></div>
        )
      })()}
      <CabinLegend />
      <h3>Order new aircraft ({year})</h3>
      <Shop state={state} />
    </div>
  )
}

// The showroom: full specs, and — pick one of your routes — an honest
// estimate of what each type would cost and carry there per quarter.
function Shop({ state }: { state: GameState }) {
  const player = state.airlines[0]!
  const year = yearOf(state)
  const [routeId, setRouteId] = useState<number | ''>('')
  const route = player.routes.find((r) => r.id === routeId)
  const km = route ? distanceKm(route.from, route.to) : null
  return (
    <div>
      <label>
        Estimate economics on:{' '}
        <select
          data-testid="shop-route"
          value={routeId}
          onChange={(e) => setRouteId(e.target.value === '' ? '' : Number(e.target.value))}
        >
          <option value="">— pick a route —</option>
          {player.routes.map((r) => (
            <option key={r.id} value={r.id}>
              {r.from}–{r.to}
            </option>
          ))}
        </select>
      </label>
      <div className="table-scroll">
        <table data-testid="shop-table">
          <thead>
            <tr>
              <th>Type</th>
              <th>Seats</th>
              <th>Range</th>
              <th>Speed</th>
              <th>Fuel $/km</th>
              <th>Maint/q</th>
              <th>Delivery</th>
              <th>Price</th>
              {km !== null && <th>Est. cost/q here</th>}
              {km !== null && <th>Seats/wk here</th>}
              {km !== null && <th title="quarterly cost divided by quarterly seats — lower is better">$/seat here</th>}
              {km !== null && <th title="load factor where this airframe breaks even at your route's fare">B/E load</th>}
              <th />
            </tr>
          </thead>
          <tbody>
            {(() => {
              // Compute the comparison rows once so the best value per
              // column can be highlighted — comparison at a glance.
              const rows = typesOnSale(year).map((t) => {
                const cost = km !== null ? estimateAircraftQuarterCost(state, t.id, km) : null
                const seats = km !== null ? estimateWeeklySeats(t.id, km) : null
                const outOfRange = km !== null && cost === -1
                // $ per seat per quarter and the breakeven load factor at
                // this route's current fare (both honest engine estimates).
                const seatsPerQuarter = seats !== null && seats > 0 ? seats * 13 : 0
                const perSeat =
                  !outOfRange && cost !== null && seatsPerQuarter > 0
                    ? Math.round((cost * 1000) / seatsPerQuarter)
                    : null
                const fare = route && km !== null ? fareFor(km, route.fareLevel) : null
                const breakevenBp =
                  !outOfRange && cost !== null && fare !== null && seatsPerQuarter > 0
                    ? Math.floor((cost * 1000 * 10000) / (seatsPerQuarter * fare))
                    : null
                return { t, cost, seats, outOfRange, perSeat, breakevenBp }
              })
              const bestPerSeat = Math.min(...rows.map((r) => r.perSeat ?? Infinity))
              const bestBreakeven = Math.min(...rows.map((r) => r.breakevenBp ?? Infinity))
              return rows.map(({ t, cost, seats, outOfRange, perSeat, breakevenBp }) => (
                <tr key={t.id} className={outOfRange ? 'dim' : ''}>
                  <td>{t.name}</td>
                  <td>{t.seats}</td>
                  <td>{t.rangeKm}km</td>
                  <td>{t.speedKmh}km/h</td>
                  <td>${t.fuelPerKm}</td>
                  <td>{money(t.maintBase)}</td>
                  <td>{t.deliveryQuarters}q</td>
                  <td>{money(t.price)}</td>
                  {km !== null && <td>{outOfRange ? 'out of range' : money(cost!)}</td>}
                  {km !== null && <td>{outOfRange ? '—' : seats}</td>}
                  {km !== null && (
                    <td className={perSeat !== null && perSeat === bestPerSeat ? 'pos' : ''}>
                      {perSeat === null ? '—' : `$${perSeat}`}
                    </td>
                  )}
                  {km !== null && (
                    <td
                      className={
                        breakevenBp === null
                          ? ''
                          : breakevenBp === bestBreakeven
                            ? 'pos'
                            : breakevenBp > 10000
                              ? 'neg'
                              : ''
                      }
                      title={breakevenBp !== null && breakevenBp > 10000 ? 'cannot break even at this fare' : undefined}
                    >
                      {breakevenBp === null ? '—' : `${Math.round(breakevenBp / 100)}%`}
                    </td>
                  )}
                  <td>
                    <button
                      disabled={player.cash < t.price}
                      title={player.cash < t.price ? `need ${money(t.price)} cash — you have ${money(player.cash)}` : undefined}
                      data-testid={`order-${t.id}`}
                      onClick={() => dispatch({ type: 'order_aircraft', aircraftType: t.id })}
                    >
                      order
                    </button>{' '}
                    <button
                      data-testid={`lease-${t.id}`}
                      title="no capital outlay; quarterly payments, no resale value"
                      onClick={() => dispatch({ type: 'lease_aircraft', aircraftType: t.id })}
                    >
                      lease {money(Math.floor((t.price * LEASE_BP_PER_QUARTER) / 10000))}/q
                    </button>
                  </td>
                </tr>
              ))
            })()}
          </tbody>
        </table>
      </div>
      {(() => {
        // The horizon: airframes entering the market in the next few years —
        // fleet planning is an era decision, not an impulse buy.
        const coming = AIRCRAFT.filter((t) => t.availableFrom > year && t.availableFrom <= year + 4).sort(
          (a, b) => a.availableFrom - b.availableFrom,
        )
        if (coming.length === 0) return null
        return (
          <p className="dim" data-testid="shop-horizon">
            On the horizon:{' '}
            {coming.map((t) => `${t.name} (${t.availableFrom} · ${t.seats} seats · ${t.rangeKm}km)`).join(' · ')}
          </p>
        )
      })()}
      {state.world.usedMarket.length > 0 && (
        <>
          <h3>Used market (this quarter)</h3>
          <div className="table-scroll">
            <table data-testid="used-market">
              <tbody>
                {state.world.usedMarket.map((o) => {
                  const t = getAircraftType(o.type)
                  const discountBp = 10000 - Math.floor((o.price * 10000) / t.price)
                  return (
                    <tr key={o.id}>
                      <td>{t.name}</td>
                      <td>{(o.ageQuarters / 4).toFixed(1)}y old</td>
                      <td>
                        {money(o.price)}{' '}
                        <span className="pos" title={`vs ${money(t.price)} new`}>
                          −{(discountBp / 100).toFixed(0)}%
                        </span>
                      </td>
                      <td>
                        <button
                          disabled={player.cash < o.price}
                          data-testid={`buy-used-${o.id}`}
                          onClick={() => dispatch({ type: 'buy_used', offerId: o.id })}
                        >
                          buy — flies next quarter
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

export function AirportsPanel({ state }: { state: GameState }) {
  const player = state.airlines[0]!
  const [spend, setSpend] = useState(1000)
  const [onlyMine, setOnlyMine] = useState(true)
  const [query, setQuery] = useState('')
  // Your airports first (held slots, then usage), the rest of the world by
  // city mass — one list, comparable, filterable, searchable.
  const q = query.trim().toLowerCase()
  const cities = [...CITIES]
    .filter((c) => q === '' || c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q))
    .filter(
      (c) =>
        q !== '' || // a search overrides the only-mine filter — you searched for a reason
        !onlyMine ||
        slotsHeld(player, c.id) > 0 ||
        player.negotiations.some((n) => n.city === c.id),
    )
    .sort((a, b) => {
      const ha = slotsHeld(player, a.id)
      const hb = slotsHeld(player, b.id)
      if (ha !== hb) return hb - ha
      const ma = a.pop * 4 + a.biz * 3 + a.tour * 2
      const mb = b.pop * 4 + b.biz * 3 + b.tour * 2
      return mb - ma
    })
  return (
    <div>
      <label>
        Negotiation budget:{' '}
        <input
          type="number"
          value={spend}
          min={NEG_MIN_SPEND}
          step={100}
          onChange={(e) => setSpend(Number(e.target.value))}
        />{' '}
        $k
      </label>{' '}
      <label className="dim">
        <input
          type="checkbox"
          data-testid="airports-only-mine"
          checked={onlyMine}
          onChange={(e) => setOnlyMine(e.target.checked)}
        />{' '}
        only my airports
      </label>{' '}
      <input
        placeholder="find a city…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        data-testid="airports-search"
      />
      <div className="table-scroll"><table>
        <thead>
          <tr>
            <th>City</th>
            <th>Slots held / used</th>
            <th title="slots allocated across all airlines vs the city's pool">Pool</th>
            <th title="last quarter's passengers on your routes touching this city">Pax/q</th>
            <th title="last quarter's route P&L attributed here (half to each endpoint)">P&L/q</th>
            <th>Difficulty</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {cities.map((c) => {
            const held = slotsHeld(player, c.id)
            const used = slotsUsed(player, c.id)
            const allocated = slotsAllocated(state, c.id)
            const negotiating = player.negotiations.some((n) => n.city === c.id)
            // The city as a business: traffic and P&L across every route
            // touching it (each route splits evenly between its endpoints).
            let cityPax = 0
            let cityProfitHalves = 0
            for (const r of player.routes) {
              if (r.from !== c.id && r.to !== c.id) continue
              cityPax += r.lastPax
              cityProfitHalves += r.lastRevenue - r.lastCost
            }
            const cityProfit = Math.floor(cityProfitHalves / 2)
            // Use it or lose it: idle slots (HQ exempt) are on a countdown.
            const atRisk = c.id !== player.hq && held - used >= SLOT_IDLE_THRESHOLD
            return (
              <tr key={c.id}>
                <td>
                  {c.name} <span className="dim">({c.id})</span>
                </td>
                <td>
                  {held} / {used}
                  {atRisk && (
                    <span className="neg" title="idle slots are reclaimed — open routes or lose one">
                      {' '}
                      ⚠ {SLOT_IDLE_QUARTERS_TO_LOSE - (player.slotIdle[c.id] ?? 0)}q
                    </span>
                  )}
                </td>
                <td className={allocated >= c.slotPool ? 'neg' : 'dim'}>
                  {allocated}/{c.slotPool}
                </td>
                <td className="dim">{cityPax > 0 ? cityPax.toLocaleString('en-US') : '—'}</td>
                <td className={cityPax === 0 ? 'dim' : cityProfit >= 0 ? 'pos' : 'neg'}>
                  {cityPax > 0 ? money(cityProfit) : '—'}
                </td>
                <td>
                  <button
                    className="link-btn"
                    title="set the negotiation budget to this city's difficulty"
                    data-testid={`suggest-budget-${c.id}`}
                    onClick={() => setSpend(negotiationDifficulty(c.id))}
                  >
                    {money(negotiationDifficulty(c.id))}
                  </button>
                </td>
                <td>
                  {negotiating ? (
                    <span className="dim" title="resolves at quarter end">
                      🤝 negotiating…
                    </span>
                  ) : (
                    <button
                      disabled={player.cash < spend || allocated >= c.slotPool}
                      title={allocated >= c.slotPool ? 'slot pool is full' : 'chance at this budget'}
                      onClick={() => dispatch({ type: 'negotiate_slots', city: c.id, spend })}
                    >
                      negotiate ({(scarcityChanceBp(state, c.id, spend) / 100).toFixed(0)}%)
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table></div>
    </div>
  )
}

// The cost buckets in a stable presentation order, labelled from the shared
// format module so every surface names them identically.
const COST_BUCKETS: readonly { key: keyof CostBreakdown; label: string }[] = (
  ['fuel', 'salaries', 'ownership', 'maintenance', 'fees', 'service', 'flightPay', 'overhead', 'admin', 'marketing', 'interest'] as const
).map((key) => ({ key, label: COST_LABELS[key] }))

// One color per bucket, shared by the mix bands and the structure table so
// the chart and the numbers read as one exhibit.
const BUCKET_COLORS: Record<keyof CostBreakdown, string> = {
  fuel: '#d0636e',
  salaries: '#58c98a',
  ownership: '#4fa3ff',
  maintenance: '#9d7bd8',
  fees: '#d8a052',
  service: '#8fbf6f',
  flightPay: '#c9b458',
  overhead: '#5b6b8c',
  admin: '#7a8fb3',
  marketing: '#e07ab8',
  interest: '#b3564f',
}

// How the cost mix evolved: each quarter is a 100%-stacked slice of its
// breakdown. Structure drift (fuel creeping up, ownership swelling after a
// buying spree) is visible at a glance; absolutes live in the table below.
function CostMixHistory({ state }: { state: GameState }) {
  const player = state.airlines[0]!
  const hist = player.history.slice(-16).filter((h) => h.costs > 0)
  if (hist.length < 2) return null
  const w = 360
  const h = 72
  const bw = w / hist.length
  return (
    <div className="cost-mix" data-testid="cost-mix">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label="cost mix by quarter">
        {hist.map((q, i) => {
          let yTop = h
          return COST_BUCKETS.map((b) => {
            const v = q.breakdown[b.key]
            if (v <= 0) return null
            const bh = (v / q.costs) * h
            yTop -= bh
            return (
              <rect
                key={`${q.turn}-${b.key}`}
                x={i * bw}
                y={yTop}
                width={bw + 0.4}
                height={bh}
                fill={BUCKET_COLORS[b.key]}
              >
                <title>{`t${q.turn} ${b.label}: ${money(v)} (${Math.round((v * 100) / q.costs)}%)`}</title>
              </rect>
            )
          })
        })}
      </svg>
      <span className="dim">cost mix, last {hist.length}q →</span>
    </div>
  )
}

// Where the money went last quarter: exact engine attribution (the buckets
// sum to reported costs), largest first, with proportional bars and the
// quarter-over-quarter move per bucket.
function CostStructure({ state }: { state: GameState }) {
  const player = state.airlines[0]!
  const now = player.history[player.history.length - 1]
  const prev = player.history[player.history.length - 2]
  if (!now || now.costs <= 0) return null
  const rows = COST_BUCKETS.map((b) => ({
    ...b,
    value: now.breakdown[b.key],
    prevValue: prev?.breakdown[b.key],
  }))
    .filter((r) => r.value > 0 || (r.prevValue ?? 0) > 0)
    .sort((a, b) => b.value - a.value)
  const max = Math.max(...rows.map((r) => r.value), 1)
  return (
    <div className="cost-structure" data-testid="cost-structure">
      <h3>Cost structure — {money(now.costs)} last quarter</h3>
      <div className="table-scroll"><table>
        <tbody>
          {rows.map((r) => {
            const delta = r.prevValue === undefined ? null : r.value - r.prevValue
            return (
              <tr key={r.key}>
                <td>
                  <span className="bucket-chip" style={{ background: BUCKET_COLORS[r.key] }} /> {r.label}
                </td>
                <td className="cost-bar-cell">
                  <span className="cost-bar" style={{ width: `${Math.round((r.value * 100) / max)}%` }} />
                </td>
                <td>{money(r.value)}</td>
                <td className="dim">{Math.round((r.value * 100) / now.costs)}%</td>
                <td className={delta === null || delta === 0 ? 'dim' : delta > 0 ? 'neg' : 'pos'}>
                  {delta === null || delta === 0 ? '±0' : delta > 0 ? `▲ ${money(delta)}` : `▼ ${money(-delta)}`}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table></div>
    </div>
  )
}

export function FinancePanel({ state }: { state: GameState }) {
  const player = state.airlines[0]!
  const [amount, setAmount] = useState(5000)
  const ceiling = debtCeiling(player)
  const debt = totalDebt(player)
  return (
    <div>
      {player.history.length >= 2 && (
        <div className="finance-trends">
          <div className="trend-row">
            <span className="dim">net worth</span>
            <Sparkline points={player.history.map((h) => h.netWorth)} width={180} />
            <span>{money(player.history[player.history.length - 1]!.netWorth)}</span>
          </div>
          <div className="trend-row">
            <span className="dim">profit</span>
            <Sparkline points={player.history.map((h) => h.profit)} width={180} className="sparkline spark-profit" />
            <span
              className={player.history[player.history.length - 1]!.profit >= 0 ? 'pos' : 'neg'}
            >
              {money(player.history[player.history.length - 1]!.profit)}/q
            </span>
          </div>
        </div>
      )}
      {state.world.indexHistory.length >= 2 && (
        <div data-testid="world-indices">
          <h3>The world</h3>
          <div className="trend-row">
            <span className="dim">economy</span>
            <Sparkline
              points={state.world.indexHistory.map((h) => h.economyBp)}
              width={180}
              className="sparkline spark-profit"
            />
            <span className={state.world.economyBp >= 10000 ? 'pos' : 'neg'}>
              {(state.world.economyBp / 100).toFixed(0)}%
            </span>
          </div>
          <div className="trend-row">
            <span className="dim" title="effective fuel index, event shocks included">
              fuel
            </span>
            <Sparkline
              points={state.world.indexHistory.map((h) => h.fuelBp)}
              width={180}
              className="sparkline spark-lf"
            />
            <span
              className={
                (state.world.indexHistory[state.world.indexHistory.length - 1]?.fuelBp ?? 10000) > 11000
                  ? 'neg'
                  : 'dim'
              }
            >
              {((state.world.indexHistory[state.world.indexHistory.length - 1]?.fuelBp ?? 10000) / 100).toFixed(0)}%
            </span>
          </div>
        </div>
      )}
      <CostStructure state={state} />
      <CostMixHistory state={state} />
      <p>
        Debt {money(debt)} of {money(ceiling)} ceiling
      </p>
      <div className="city-negotiate" data-testid="hedge-panel">
        {player.fuelHedge !== null ? (
          <span>
            ⛽ Fuel hedged at index {(player.fuelHedge.bp / 100).toFixed(0)}% for{' '}
            {player.fuelHedge.quartersLeft} more quarter(s)
            {player.fuelHedge.quartersLeft === 1 && (
              <span className="neg"> — expires next quarter, you'll be back on the market index</span>
            )}
          </span>
        ) : (
          <>
            <span>Fuel hedge:</span>
            {[4, 8].map((q) => (
              <button
                key={q}
                data-testid={`hedge-${q}`}
                disabled={
                  player.fleet.length === 0 ||
                  q < HEDGE_MIN_QUARTERS ||
                  q > HEDGE_MAX_QUARTERS ||
                  player.cash < HEDGE_PREMIUM_PER_AIRCRAFT * player.fleet.length * q
                }
                title="lock today's fuel index for your whole fleet"
                onClick={() => dispatch({ type: 'hedge_fuel', quarters: q })}
              >
                {q}q — {money(HEDGE_PREMIUM_PER_AIRCRAFT * player.fleet.length * q)}
              </button>
            ))}
          </>
        )}
      </div>
      <div className="city-negotiate" data-testid="marketing-panel">
        <span title="brand spend buys pair appeal in every share battle: schedule × cabin × fare × service × brand">
          Marketing:
        </span>
        {[0, 1, 2, 3].map((level) => (
          <button
            key={level}
            data-testid={`marketing-${level}`}
            className={player.marketing === level ? 'active sort-btn' : 'sort-btn'}
            disabled={player.marketing === level}
            onClick={() => dispatch({ type: 'set_marketing', level })}
          >
            {['off', 'low', 'mid', 'high'][level]}
            {level > 0 &&
              ` ${money(
                level *
                  Math.floor(
                    ((MARKETING_BASE_PER_LEVEL + MARKETING_PER_ROUTE_PER_LEVEL * player.routes.length) *
                      inflationBp(state.turn)) /
                      10000,
                  ),
              )}/q`}
          </button>
        ))}
        <span className="dim">
          +{(MARKETING_WEIGHT_BP_PER_LEVEL / 100).toFixed(0)}% appeal per level on every pair
        </span>
      </div>
      <label>
        Amount:{' '}
        <input type="number" value={amount} min={100} step={100} onChange={(e) => setAmount(Number(e.target.value))} />{' '}
        $k
      </label>
      <button onClick={() => dispatch({ type: 'take_loan', amount })}>take loan</button>{' '}
      <span className="dim" data-testid="loan-rate">
        today's rate {(currentLoanRateBp(state) / 100).toFixed(1)}%/yr
        <span title="the rate follows the economy — borrow in booms, not busts">
          {' '}
          ({state.world.economyBp >= 10000 ? 'cheap money' : 'tight money'})
        </span>
      </span>
      <div className="table-scroll"><table>
        <tbody>
          {player.loans.map((l) => (
            <tr key={l.id}>
              <td>{money(l.principal)}</td>
              <td>{(l.annualRateBp / 100).toFixed(1)}%/yr</td>
              <td>
                <button onClick={() => dispatch({ type: 'repay_loan', loanId: l.id, amount })}>
                  repay {money(Math.min(amount, l.principal))}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <h3>History</h3>
      <div className="table-scroll"><table>
        <thead>
          <tr>
            <th>Q</th>
            <th>Revenue</th>
            <th>Costs</th>
            <th>Profit</th>
            <th>Net worth</th>
          </tr>
        </thead>
        <tbody>
          {player.history.slice(-8).reverse().map((h) => (
            <tr key={h.turn}>
              <td>{h.turn + 1}</td>
              <td>{money(h.revenue)}</td>
              <td>{money(h.costs)}</td>
              <td className={h.profit >= 0 ? 'pos' : 'neg'}>{money(h.profit)}</td>
              <td>{money(h.netWorth)}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </div>
  )
}

function describeEvent(state: GameState, e: GameEvent): string | null {
  const name = (idx: number): string => state.airlines[idx]?.name ?? `airline ${idx}`
  switch (e.type) {
    case 'command_rejected':
      return e.airline === 0 ? `Rejected: ${e.reason}` : null
    case 'route_opened':
      return `${name(e.airline)} opened ${e.from}–${e.to}`
    case 'route_closed':
      return e.airline === 0 ? `Closed route` : null
    case 'aircraft_delivered':
      return `${name(e.airline)} took delivery of a ${getAircraftType(e.aircraftType).name}`
    case 'slots_granted':
      return `${name(e.airline)} won ${e.slots} slots at ${e.city}`
    case 'negotiation_failed':
      return e.airline === 0 ? `Slot talks at ${e.city} failed` : null
    case 'world_event_started':
      return `World: ${e.eventId.replace('_', ' ')}${e.city ? ` in ${e.city}` : ''}${e.region ? ` in region ${e.region}` : ''}`
    case 'world_event_ended':
      return `World: ${e.eventId.replace('_', ' ')} ended`
    case 'airline_bankrupt':
      return `${name(e.airline)} went bankrupt`
    case 'quarter_report':
      return e.airline === 0
        ? `Quarter closed: revenue ${money(e.revenue)}, profit ${money(e.profit)}, net worth ${money(e.netWorth)}`
        : null
    case 'game_over':
      return e.result === 'won' ? `VICTORY: ${e.reason}` : `DEFEAT: ${e.reason}`
    default:
      return null
  }
}

export function ReportPanel({ state, events }: { state: GameState; events: GameEvent[] }) {
  const lines = events.map((e) => describeEvent(state, e)).filter((l): l is string => l !== null)
  if (lines.length === 0) return <p className="hint">End the quarter to see your first report.</p>
  // Structured results first: every route's quarter in one comparable table,
  // sorted by profit; the narrative log below for everything else.
  const results = events
    .filter(
      (e): e is Extract<GameEvent, { type: 'route_result' }> => e.type === 'route_result' && e.airline === 0,
    )
    .sort((a, b) => b.revenue - b.cost - (a.revenue - a.cost))
  const player = state.airlines[0]!
  const routeName = (routeId: number): string => {
    const r = player.routes.find((x) => x.id === routeId)
    return r ? `${r.from}–${r.to}` : '(closed)'
  }
  return (
    <div>
      {results.length > 0 && (
        <div className="table-scroll">
          <table data-testid="report-results">
            <thead>
              <tr className="dim">
                <th>route</th>
                <th>pax</th>
                <th>conn</th>
                <th>load</th>
                <th>rev</th>
                <th>cost</th>
                <th>P&L</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.routeId}>
                  <td>{routeName(r.routeId)}</td>
                  <td>{r.pax.toLocaleString('en-US')}</td>
                  <td className="dim">{r.transferPax}</td>
                  <td>{(r.loadFactorBp / 100).toFixed(0)}%</td>
                  <td>{money(r.revenue)}</td>
                  <td>{money(r.cost)}</td>
                  <td className={r.revenue - r.cost >= 0 ? 'pos' : 'neg'}>{money(r.revenue - r.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ul className="report" data-testid="report">
        {lines.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
    </div>
  )
}
