// Management panels: routes, fleet, airports, finance, and the quarterly
// report. Every button is a Command dispatch — no state is touched directly.

import { useState } from 'react'
import { getAircraftType, typesOnSale } from '../data/aircraft'
import { CITIES, distanceKm } from '../data/cities'
import { NEG_MIN_SPEND } from '../data/constants'
import type { CostBreakdown, GameEvent, GameState } from '../engine'
import { estimateAircraftQuarterCost, estimateWeeklySeats, fareFor } from '../engine/market'
import {
  CABIN_REFIT_COST_BP,
  SLOT_IDLE_QUARTERS_TO_LOSE,
  SLOT_IDLE_THRESHOLD,
  HEDGE_MAX_QUARTERS,
  HEDGE_MIN_QUARTERS,
  HEDGE_PREMIUM_PER_AIRCRAFT,
  LEASE_BP_PER_QUARTER,
  ROUTE_OVERHEAD_QUAD,
} from '../data/constants'
import { inflationBp } from '../engine/market'
import { negotiationDifficulty } from '../engine/negotiation'
import {
  airlinesOnPair,
  allocateTrips,
  cabinSeats,
  debtCeiling,
  effectiveFrequency,
  maxRouteFrequency,
  resaleValue,
  roundTripsPerWeek,
  slotsAllocated,
  slotsHeld,
  slotsUsed,
  totalDebt,
  yearOf,
} from '../engine/queries'
import { assignAndSchedule } from './assign'
import { dispatch } from './session'
import { Sparkline } from './Sparkline'
import { COST_LABELS, money } from './format'

// Sort keys for the routes comparison table. Each computes from the same row
// model the cells render, so what you sort is exactly what you see.
type RouteSortKey = 'name' | 'km' | 'load' | 'revenue' | 'profit' | 'margin' | 'rivals'

export function RoutesPanel({ state, onInspect }: { state: GameState; onInspect: (routeId: number) => void }) {
  const player = state.airlines[0]!
  const [sortKey, setSortKey] = useState<RouteSortKey>('profit')
  const [sortAsc, setSortAsc] = useState(false)
  if (player.routes.length === 0) {
    return <p className="hint">No routes yet. Click a city on the map, then “Open route from here”.</p>
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
      square of the network — quality beats sprawl)
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
                <button onClick={() => dispatch({ type: 'set_fare', routeId: r.id, fareLevel: r.fareLevel - 1 })}>
                  −
                </button>
                ${fareFor(km, r.fareLevel)}
                <button onClick={() => dispatch({ type: 'set_fare', routeId: r.id, fareLevel: r.fareLevel + 1 })}>
                  +
                </button>
              </td>
              <td>
                <button
                  onClick={() => dispatch({ type: 'set_service', routeId: r.id, serviceLevel: r.serviceLevel - 1 })}
                >
                  −
                </button>
                {['', 'basic', 'standard', 'premium'][r.serviceLevel]}
                <button
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
                <button onClick={() => dispatch({ type: 'close_route', routeId: r.id })}>close</button>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table></div>
    </div>
  )
}

export function FleetPanel({ state }: { state: GameState }) {
  const player = state.airlines[0]!
  const year = yearOf(state)
  return (
    <div>
      <div className="table-scroll"><table>
        <thead>
          <tr>
            <th>Aircraft</th>
            <th>Age</th>
            <th title="round trips flown vs what this airframe could fly on its route">Utilization</th>
            <th>Value</th>
            <th>Cabin</th>
            <th>Assignment</th>
          </tr>
        </thead>
        <tbody>
          {player.fleet.map((a) => {
            const type = getAircraftType(a.type)
            const route = player.routes.find((r) => r.id === a.routeId)
            const alloc = route ? allocateTrips(player, route).find((x) => x.aircraftId === a.id) : undefined
            const maxTrips = route ? roundTripsPerWeek(a.type, distanceKm(route.from, route.to)) : 0
            const utilBp = alloc && maxTrips > 0 ? Math.floor((alloc.trips * 10000) / maxTrips) : 0
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
                    <span className="neg" title="idle metal still draws salaries and ownership">
                      parked
                    </span>
                  )}
                </td>
                <td className="dim">{a.leased ? '—' : money(resaleValue(a.type, a.ageQuarters))}</td>
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
                  <button onClick={() => dispatch({ type: 'sell_aircraft', aircraftId: a.id })}>sell</button>
                </td>
              </tr>
            )
          })}
          {player.orders.map((o) => (
            <tr key={`order-${o.id}`} className="dim">
              <td>{getAircraftType(o.type).name}</td>
              <td colSpan={5}>on order — delivers in {o.quartersLeft} quarter(s)</td>
            </tr>
          ))}
        </tbody>
      </table></div>
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
  // Your airports first (held slots, then usage), the rest of the world by
  // city mass — one list, comparable, filterable.
  const cities = [...CITIES]
    .filter((c) => !onlyMine || slotsHeld(player, c.id) > 0 || player.negotiations.some((n) => n.city === c.id))
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
      </label>
      <div className="table-scroll"><table>
        <thead>
          <tr>
            <th>City</th>
            <th>Slots held / used</th>
            <th title="slots allocated across all airlines vs the city's pool">Pool</th>
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
                <td>{money(negotiationDifficulty(c.id))}</td>
                <td>
                  {negotiating ? (
                    <span className="dim">negotiating…</span>
                  ) : (
                    <button
                      disabled={player.cash < spend}
                      onClick={() => dispatch({ type: 'negotiate_slots', city: c.id, spend })}
                    >
                      negotiate
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
  ['fuel', 'salaries', 'ownership', 'maintenance', 'fees', 'service', 'flightPay', 'overhead', 'admin', 'interest'] as const
).map((key) => ({ key, label: COST_LABELS[key] }))

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
      <table>
        <tbody>
          {rows.map((r) => {
            const delta = r.prevValue === undefined ? null : r.value - r.prevValue
            return (
              <tr key={r.key}>
                <td>{r.label}</td>
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
      </table>
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
      <CostStructure state={state} />
      <p>
        Debt {money(debt)} of {money(ceiling)} ceiling
      </p>
      <div className="city-negotiate" data-testid="hedge-panel">
        {player.fuelHedge !== null ? (
          <span>
            ⛽ Fuel hedged at index {(player.fuelHedge.bp / 100).toFixed(0)}% for{' '}
            {player.fuelHedge.quartersLeft} more quarter(s)
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
      <label>
        Amount:{' '}
        <input type="number" value={amount} min={100} step={100} onChange={(e) => setAmount(Number(e.target.value))} />{' '}
        $k
      </label>
      <button onClick={() => dispatch({ type: 'take_loan', amount })}>take loan</button>
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
