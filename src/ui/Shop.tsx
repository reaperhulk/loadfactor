// The aircraft showroom, split out of panels.tsx: full specs plus honest
// per-route economics estimates for each type on sale.

import { useState } from 'react'
import { AIRCRAFT, getAircraftType, typesOnSale } from '../data/aircraft'
import { distanceKm } from '../data/cities'
import { LEASE_BP_PER_QUARTER } from '../data/constants'
import type { GameState } from '../engine'
import { estimateAircraftQuarterCost, estimateWeeklySeats, fareFor } from '../engine/market'
import { yearOf } from '../engine/queries'
import { dispatch } from './session'
import { money } from './format'

// The showroom: full specs, and — pick one of your routes — an honest
// estimate of what each type would cost and carry there per quarter.
export function Shop({ state }: { state: GameState }) {
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
