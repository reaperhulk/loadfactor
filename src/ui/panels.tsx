// Management panels: routes, fleet, airports, finance, and the quarterly
// report. Every button is a Command dispatch — no state is touched directly.

import { useState } from 'react'
import { getAircraftType, typesOnSale } from '../data/aircraft'
import { CITIES, distanceKm } from '../data/cities'
import { NEG_MIN_SPEND } from '../data/constants'
import type { GameEvent, GameState } from '../engine'
import { negotiationDifficulty } from '../engine/negotiation'
import { debtCeiling, slotsHeld, slotsUsed, totalDebt, yearOf } from '../engine/queries'
import { dispatch } from './session'

function money(k: number): string {
  return k >= 1000 || k <= -1000 ? `$${(k / 1000).toFixed(1)}M` : `$${k}k`
}

export function RoutesPanel({ state }: { state: GameState }) {
  const player = state.airlines[0]!
  if (player.routes.length === 0) {
    return <p className="hint">No routes yet. Click two cities on the map to open one.</p>
  }
  return (
    <div className="table-scroll"><table>
      <thead>
        <tr>
          <th>Route</th>
          <th>km</th>
          <th>Fare</th>
          <th>Service</th>
          <th>Planes</th>
          <th>Load</th>
          <th>P&L</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {player.routes.map((r) => {
          const planes = player.fleet.filter((a) => a.routeId === r.id).length
          return (
            <tr key={r.id} data-testid={`route-${r.from}-${r.to}`}>
              <td>
                {r.from}–{r.to}
              </td>
              <td>{distanceKm(r.from, r.to)}</td>
              <td>
                <button onClick={() => dispatch({ type: 'set_fare', routeId: r.id, fareLevel: r.fareLevel - 1 })}>
                  −
                </button>
                {r.fareLevel > 0 ? `+${r.fareLevel}` : r.fareLevel}
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
              <td>
                <span className="lf-bar">
                  <span className="lf-fill" style={{ width: `${r.lastLoadFactorBp / 100}%` }} />
                </span>
                {(r.lastLoadFactorBp / 100).toFixed(0)}%
              </td>
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
            <th>Assignment</th>
          </tr>
        </thead>
        <tbody>
          {player.fleet.map((a) => {
            const type = getAircraftType(a.type)
            return (
              <tr key={a.id}>
                <td>
                  {type.name} <span className="dim">({type.seats} seats, {type.rangeKm}km)</span>
                </td>
                <td>{(a.ageQuarters / 4).toFixed(1)}y</td>
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
              <td colSpan={2}>on order — delivers in {o.quartersLeft} quarter(s)</td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <h3>Order new aircraft ({year})</h3>
      <div className="shop">
        {typesOnSale(year).map((t) => (
          <button
            key={t.id}
            disabled={player.cash < t.price}
            onClick={() => dispatch({ type: 'order_aircraft', aircraftType: t.id })}
            title={`${t.seats} seats · ${t.rangeKm}km range · delivers in ${t.deliveryQuarters} quarters`}
          >
            {t.name} — {money(t.price)}
          </button>
        ))}
      </div>
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
      <p>
        Debt {money(debt)} of {money(ceiling)} ceiling
      </p>
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
