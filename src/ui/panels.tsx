// Management panels: routes, fleet, airports, finance, and the quarterly
// report. Every button is a Command dispatch — no state is touched directly.

import { useState } from 'react'
import { getAircraftType } from '../data/aircraft'
import { CITIES, distanceKm, pairKey } from '../data/cities'
import { MIN_ROUTE_KM, NEG_MIN_SPEND } from '../data/constants'
import type { GameState } from '../engine'
import { baseFare, fareFor, pairWeeklyDemand, seasonalBp } from '../engine/market'
import {
  GROUNDING_AGE_QUARTERS,
  ROUTE_MEMORY_QUARTERS,
  ROUTE_SPOOL_BP,
  CABIN_REFIT_COST_BP,
  MAINT_AGE_BP_PER_QUARTER,
  ORDER_CANCEL_REFUND_BP,
  SLOT_IDLE_QUARTERS_TO_LOSE,
  SLOT_IDLE_THRESHOLD,
  ROUTE_OVERHEAD_QUAD,
} from '../data/constants'
import { inflationBp } from '../engine/market'
import { negotiationDifficulty, scarcityChanceBp } from '../engine/negotiation'
import {
  airlinesOnPair,
  allocateTrips,
  networkCities,
  cabinSeats,
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
  yearOf,
} from '../engine/queries'
import { Shop } from './Shop'
import { assignAllIdle, assignAndSchedule } from './assign'
import { sortHeaderFactory } from './sortHeader'
import { ConfirmButton } from './ConfirmButton'
import { dispatch } from './session'
import { copyTsv, money } from './format'
import {
  CabinLegend,
  ReliabilityLegend,
  ServiceLegend,
  SlotLegend,
} from './legends'

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
  const header = sortHeaderFactory<RouteSortKey>({
    current: sortKey,
    asc: sortAsc,
    setKey: setSortKey,
    setAsc: setSortAsc,
    defaultAscFor: (k) => k === 'name' || k === 'km',
    testPrefix: 'sort-',
  })
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
            'Routes table',
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
  const rows: {
    from: string
    to: string
    km: number
    demand: number
    marketK: number
    rivals: number
    risks: string[]
  }[] = []
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
      const rivals = airlinesOnPair(state, a, b, 0)
      // What the headline number does not say. A ranked list with no risk
      // column makes the top row automatically right; these are the reasons
      // it might not be.
      const risks: string[] = []
      if (rivals > 0) risks.push(`${rivals} incumbent${rivals > 1 ? 's' : ''}`)
      const seasonBp = Math.floor((seasonalBp(a, state.turn) * seasonalBp(b, state.turn)) / 10000)
      if (seasonBp > 10250) risks.push('peak season now — it will fall back')
      else if (seasonBp < 9750) risks.push('off season now — it will recover')
      const mem = player.servedUntil[pairKey(a, b)]
      const remembered = mem !== undefined && state.turn - mem <= ROUTE_MEMORY_QUARTERS
      if (!remembered) risks.push(`ramps from ${ROUTE_SPOOL_BP[0]! / 100}%`)
      if (km > idleReach) risks.push('no idle plane in range')
      rows.push({
        from: a,
        to: b,
        km,
        demand,
        marketK: Math.floor((demand * baseFare(km)) / 1000),
        rivals,
        risks,
      })
    }
  }
  rows.sort((x, y) => y.marketK - x.marketK)
  const top = rows.slice(0, 5)
  // Where to expand next: the richest markets from your network you have NO
  // slots for yet — negotiation targets, ranked by the same market dollars.
  const networkList = [...network].sort()
  const negotiable: { from: string; to: string; marketK: number; courted: string[] }[] = []
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
    if (bestFrom !== '')
      negotiable.push({
        from: bestFrom,
        to: c.id,
        marketK: bestMarket,
        // Announced rival campaigns: the richest target is a different
        // decision when someone else is already walking toward it.
        courted: state.airlines
          .filter((a) => a.id !== 0 && !a.bankrupt && a.slotInterest === c.id)
          .map((a) => a.name),
      })
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
                <td className={r.risks.length === 0 ? 'pos' : 'dim'} data-testid={`risk-${r.from}-${r.to}`}>
                  {r.risks.length === 0 ? 'clean shot' : r.risks.join(' · ')}
                </td>
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
            .map(
              (n) =>
                `${n.to} (${money(n.marketK)}/wk vs ${n.from})${n.courted.length > 0 ? ` ⚠ ${n.courted.join(', ')} bidding` : ''}`,
            )
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
  const fleetHeader = sortHeaderFactory<FleetSortKey>({
    current: fleetSort,
    asc: fleetAsc,
    setKey: setFleetSort,
    setAsc: setFleetAsc,
    defaultAscFor: (k) => k === 'type',
    testPrefix: 'fleet-sort-',
  })
  return (
    <div>
      {player.fleet.some((a) => a.routeId === null) && player.routes.length > 0 && (
        <button
          data-testid="assign-all-idle"
          title="assign every idle airframe to the in-range route most starved for seats"
          onClick={assignAllIdle}
        >
          🛠 put idle fleet to work
        </button>
      )}
      {player.fleet.length > 0 && (() => {
        const rep = player.reputationBp ?? 10000
        const atRisk = player.fleet.filter((a) => a.ageQuarters >= GROUNDING_AGE_QUARTERS).length
        if (atRisk === 0 && rep >= 10000) return null
        return (
          <p className={rep < 9500 ? 'neg' : 'dim'} data-testid="reliability-note">
            {atRisk > 0 && (
              <>
                {atRisk} airframe{atRisk > 1 ? 's' : ''} past {GROUNDING_AGE_QUARTERS / 4} years — old metal
                breaks, and a grounded plane still draws its crew.{' '}
              </>
            )}
            Reputation {(rep / 100).toFixed(0)}%
            {rep < 10000 && ' — repeated groundings cost you appeal on contested pairs'}
          </p>
        )
      })()}
      {player.fleet.length > 0 && (
        <p className="dim" data-testid="renewal-forecast">
          Fleet upkeep {money(maintAt(0))}/q now → {money(maintAt(8))}/q in 2 years on the same metal
          {geriatricNow > 0 && <span className="neg"> · {geriatricNow} geriatric</span>}
          {geriatricSoon > 0 && <span> · {geriatricSoon} more turn geriatric within 2y</span>}{' '}
          <button
            className="link-btn"
            data-testid="copy-fleet"
            title="copy the fleet as TSV — paste into any spreadsheet (raw numbers, $k)"
            onClick={() =>
              copyTsv(
                ['aircraft', 'seats', 'ageQuarters', 'leased', 'cabin', 'maintK', 'valueK', 'route'],
                player.fleet.map((a) => {
                  const t = getAircraftType(a.type)
                  const r = player.routes.find((x) => x.id === a.routeId)
                  return [
                    t.name,
                    cabinSeats(a.type, a.cabin),
                    a.ageQuarters,
                    a.leased ? 1 : 0,
                    a.cabin,
                    Math.floor(
                      (Math.floor((t.maintBase * (10000 + MAINT_AGE_BP_PER_QUARTER * a.ageQuarters)) / 10000) *
                        inflationBp(state.turn)) /
                        10000,
                    ),
                    a.leased ? 0 : resaleValue(a.type, a.ageQuarters),
                    r ? `${r.from}-${r.to}` : 'idle',
                  ]
                }),
                'Fleet table',
              )
            }
          >
            ⎘ copy as spreadsheet
          </button>
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
        const fheader = fleetHeader
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
      <ReliabilityLegend />
      <Shop state={state} />
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
      <SlotLegend />
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

// Split-out screens re-exported so callers keep one panels entry point.
export { FinancePanel } from './FinancePanel'
export { ReportPanel } from './ReportPanel'
