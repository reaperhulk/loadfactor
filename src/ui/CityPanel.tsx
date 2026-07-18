// The city dossier: everything you can know and do about one airport, in
// context — ratings, slots, active events, the richest pairs from here, your
// presence, and slot negotiations. Opens when a city is clicked on the map.

import { useState } from 'react'
import { CITIES, distanceKm, getCity } from '../data/cities'
import { NEG_MIN_SPEND } from '../data/constants'
import { getEventDef } from '../data/events'
import type { GameState } from '../engine'
import { baseFare, pairWeeklyDemand } from '../engine/market'
import { negotiationChanceBp, negotiationDifficulty } from '../engine/negotiation'
import { airlinesOnPair, slotsAllocated, slotsFree, slotsHeld, slotsUsed } from '../engine/queries'
import { cityMass, cityTier } from './MapView'
import { dispatch } from './session'

function money(k: number): string {
  return k >= 1000 || k <= -1000 ? `$${(k / 1000).toFixed(1)}M` : `$${k}k`
}

const REGION_NAMES: Record<string, string> = {
  na: 'North America',
  sa: 'South America',
  eu: 'Europe',
  me: 'Middle East',
  af: 'Africa',
  as: 'Asia',
  oc: 'Oceania',
}

function Rating({ label, value }: { label: string; value: number }) {
  return (
    <div className="rating">
      <span className="rating-label">{label}</span>
      <span className="rating-track">
        <span className="rating-fill" style={{ width: `${value * 10}%` }} />
      </span>
      <span className="rating-value">{value}</span>
    </div>
  )
}

interface CityPanelProps {
  state: GameState
  cityId: string
  routeFrom: string | null
  onPlanRoute: (from: string) => void
  onClose: () => void
}

export function CityPanel({ state, cityId, routeFrom, onPlanRoute, onClose }: CityPanelProps) {
  const city = getCity(cityId)
  const player = state.airlines[0]!
  const [spend, setSpend] = useState(1000)

  const held = slotsHeld(player, cityId)
  const used = slotsUsed(player, cityId)
  const allocated = slotsAllocated(state, cityId)
  const rivalsHeld = allocated - held
  const negotiating = player.negotiations.some((n) => n.city === cityId)
  const poolFull = allocated >= city.slotPool
  const difficulty = negotiationDifficulty(cityId)

  const activeEvents = state.world.events.filter((e) => {
    const def = getEventDef(e.id)
    if (def.demandModBp === undefined) return false
    return e.city === cityId || (e.region !== null && e.region === city.region)
  })

  // The five richest pairs from this city right now.
  const pairs = CITIES.filter((c) => c.id !== cityId)
    .map((c) => ({
      to: c.id,
      km: distanceKm(cityId, c.id),
      demand: pairWeeklyDemand(state, cityId, c.id),
      competitors: airlinesOnPair(state, cityId, c.id, 0),
      mine: airlinesOnPair(state, cityId, c.id) - airlinesOnPair(state, cityId, c.id, 0) > 0,
    }))
    .sort((a, b) => b.demand - a.demand)
    .slice(0, 5)

  const myRoutes = player.routes.filter((r) => r.from === cityId || r.to === cityId)

  return (
    <aside className="city-panel" data-testid="city-panel" aria-label={`${city.name} details`}>
      <header className="city-panel-head">
        <div>
          <h2>
            {city.name} <span className="dim">{city.id}</span>
          </h2>
          <span className="dim">
            {REGION_NAMES[city.region]} · {['', 'major hub', 'regional', 'small field'][cityTier(city)]} · mass{' '}
            {cityMass(city)}
          </span>
        </div>
        <button onClick={onClose} aria-label="close city panel" data-testid="city-panel-close">
          ✕
        </button>
      </header>

      <Rating label="population" value={city.pop} />
      <Rating label="business" value={city.biz} />
      <Rating label="tourism" value={city.tour} />

      {activeEvents.length > 0 && (
        <div className="city-events">
          {activeEvents.map((e) => {
            const def = getEventDef(e.id)
            const pct = ((def.demandModBp ?? 10000) - 10000) / 100
            return (
              <span key={e.id} className={pct >= 0 ? 'pos' : 'neg'}>
                {def.name}: demand {pct >= 0 ? '+' : ''}
                {pct.toFixed(0)}% ({e.quartersLeft}q left)
              </span>
            )
          })}
        </div>
      )}

      <div className="city-slots" data-testid="city-slots">
        <strong>Slots</strong> — pool {city.slotPool} · rivals hold {rivalsHeld} · you hold {held} (using {used})
      </div>

      {held > 0 && (
        <button
          className={routeFrom === cityId ? 'plan-route armed' : 'plan-route'}
          data-testid="plan-route"
          disabled={slotsFree(player, cityId) < 1}
          onClick={() => onPlanRoute(cityId)}
          title={slotsFree(player, cityId) < 1 ? 'no free slots here' : 'then click a destination on the map'}
        >
          {routeFrom === cityId ? 'Click a destination…' : '✈ Open route from here'}
        </button>
      )}

      <div className="city-negotiate">
        {negotiating ? (
          <span className="dim" data-testid="negotiating-note">
            Negotiating for slots…
          </span>
        ) : poolFull ? (
          <span className="dim">Slot pool is full.</span>
        ) : (
          <>
            <label>
              $k:{' '}
              <input
                type="number"
                value={spend}
                min={NEG_MIN_SPEND}
                step={100}
                onChange={(e) => setSpend(Number(e.target.value))}
                data-testid="negotiate-spend"
              />
            </label>
            <button
              data-testid="panel-negotiate"
              disabled={player.cash < spend || spend < NEG_MIN_SPEND}
              onClick={() => dispatch({ type: 'negotiate_slots', city: cityId, spend })}
            >
              Negotiate ({(negotiationChanceBp(cityId, spend) / 100).toFixed(0)}%)
            </button>
            <span className="dim">difficulty {money(difficulty)}</span>
          </>
        )}
      </div>

      <h3>Top demand from here</h3>
      <table className="city-pairs">
        <tbody>
          {pairs.map((p) => (
            <tr key={p.to}>
              <td>
                {cityId}–{p.to}
              </td>
              <td>{p.km}km</td>
              <td>{p.demand}/wk</td>
              <td>~${baseFare(p.km)}</td>
              <td className="dim">
                {p.mine ? 'yours' : p.competitors > 0 ? `${p.competitors} rival${p.competitors > 1 ? 's' : ''}` : 'open'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {myRoutes.length > 0 && (
        <>
          <h3>Your routes here</h3>
          <table>
            <tbody>
              {myRoutes.map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.from}–{r.to}
                  </td>
                  <td>{(r.lastLoadFactorBp / 100).toFixed(0)}% full</td>
                  <td className={r.lastRevenue - r.lastCost >= 0 ? 'pos' : 'neg'}>
                    {money(r.lastRevenue - r.lastCost)}/q
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </aside>
  )
}
