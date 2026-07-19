// Management panels: routes, fleet, airports, finance, and the quarterly
// report. Every button is a Command dispatch — no state is touched directly.

import { useState } from 'react'
import { getAircraftType, typesOnSale } from '../data/aircraft'
import { CITIES, distanceKm } from '../data/cities'
import { NEG_MIN_SPEND } from '../data/constants'
import type { GameEvent, GameState } from '../engine'
import { estimateAircraftQuarterCost, estimateWeeklySeats, fareFor } from '../engine/market'
import {
  CABIN_REFIT_COST_BP,
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
  cabinSeats,
  debtCeiling,
  effectiveFrequency,
  maxRouteFrequency,
  slotsHeld,
  slotsUsed,
  totalDebt,
  yearOf,
} from '../engine/queries'
import { dispatch } from './session'
import { Sparkline } from './Sparkline'

function money(k: number): string {
  return k >= 1000 || k <= -1000 ? `$${(k / 1000).toFixed(1)}M` : `$${k}k`
}

export function RoutesPanel({ state, onInspect }: { state: GameState; onInspect: (routeId: number) => void }) {
  const player = state.airlines[0]!
  if (player.routes.length === 0) {
    return <p className="hint">No routes yet. Click a city on the map, then “Open route from here”.</p>
  }
  const networkOverhead = Math.floor(
    (ROUTE_OVERHEAD_QUAD * player.routes.length * player.routes.length * inflationBp(state.turn)) / 10000,
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
          <th>Route</th>
          <th>km</th>
          <th>Fare</th>
          <th>Service</th>
          <th>Planes</th>
          <th>Freq/wk</th>
          <th>Rivals</th>
          <th>Load</th>
          <th>Rev</th>
          <th>P&L</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {player.routes.map((r) => {
          const km = distanceKm(r.from, r.to)
          const planes = player.fleet.filter((a) => a.routeId === r.id).length
          const freq = `${effectiveFrequency(player, r)}/${maxRouteFrequency(player, r)}`
          const rivalsHere = airlinesOnPair(state, r.from, r.to, 0)
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
              <td>{rivalsHere > 0 ? rivalsHere : '—'}</td>
              <td>
                <span className="lf-bar">
                  <span className="lf-fill" style={{ width: `${r.lastLoadFactorBp / 100}%` }} />
                </span>
                {(r.lastLoadFactorBp / 100).toFixed(0)}%
              </td>
              <td>{money(r.lastRevenue)}</td>
              <td className={r.lastRevenue - r.lastCost >= 0 ? 'pos' : 'neg'}>
                {money(r.lastRevenue - r.lastCost)}
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
            <th>Cabin</th>
            <th>Assignment</th>
          </tr>
        </thead>
        <tbody>
          {player.fleet.map((a) => {
            const type = getAircraftType(a.type)
            return (
              <tr key={a.id}>
                <td>
                  {type.name} {a.leased && <span className="dim">(leased)</span>}{' '}
                  <span className="dim">({cabinSeats(a.type, a.cabin)} seats, {type.rangeKm}km)</span>
                </td>
                <td>{(a.ageQuarters / 4).toFixed(1)}y</td>
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
                      dispatch({
                        type: 'assign_aircraft',
                        aircraftId: a.id,
                        routeId: e.target.value === '' ? null : Number(e.target.value),
                      })
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
              <td colSpan={3}>on order — delivers in {o.quartersLeft} quarter(s)</td>
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
              <th />
            </tr>
          </thead>
          <tbody>
            {typesOnSale(year).map((t) => {
              const cost = km !== null ? estimateAircraftQuarterCost(state, t.id, km) : null
              const seats = km !== null ? estimateWeeklySeats(t.id, km) : null
              const outOfRange = km !== null && cost === -1
              return (
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
              )
            })}
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
                  return (
                    <tr key={o.id}>
                      <td>{t.name}</td>
                      <td>{(o.ageQuarters / 4).toFixed(1)}y old</td>
                      <td>{money(o.price)}</td>
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
      </label>
      <div className="table-scroll"><table>
        <thead>
          <tr>
            <th>City</th>
            <th>Slots held / used</th>
            <th>Difficulty</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {CITIES.map((c) => {
            const held = slotsHeld(player, c.id)
            const used = slotsUsed(player, c.id)
            const negotiating = player.negotiations.some((n) => n.city === c.id)
            return (
              <tr key={c.id}>
                <td>
                  {c.name} <span className="dim">({c.id})</span>
                </td>
                <td>
                  {held} / {used}
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
  return (
    <ul className="report" data-testid="report">
      {lines.map((line, i) => (
        <li key={i}>{line}</li>
      ))}
    </ul>
  )
}
