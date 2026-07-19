// The city dossier: everything you can know and do about one airport, in
// context — ratings, slots, active events, the richest pairs from here, your
// presence, and slot negotiations. Opens when a city is clicked on the map.

import { useMemo, useState } from 'react'
import { CITIES, distanceKm, getCity } from '../data/cities'
import { NEG_MIN_SPEND, SEASON_TOUR_BP_PER_POINT, SLOT_IDLE_QUARTERS_TO_LOSE, SLOT_IDLE_THRESHOLD } from '../data/constants'
import { getEventDef } from '../data/events'
import type { GameState } from '../engine'
import { baseFare, pairWeeklyDemand, seasonalBp } from '../engine/market'
import { negotiationDifficulty, scarcityChanceBp } from '../engine/negotiation'
import { airlinesOnPair, networkCities, slotsAllocated, slotsFree, slotsHeld, slotsUsed } from '../engine/queries'
import { cityMass, cityTier } from './MapView'
import { dispatch } from './session'
import { money } from './format'

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
  // Straight to the launch dialog for a specific pair (the market rows).
  onPlanPair?: (from: string, to: string) => void
  onClose: () => void
}

export function CityPanel({ state, cityId, routeFrom, onPlanRoute, onPlanPair, onClose }: CityPanelProps) {
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

  // The richest pairs from this city right now (165 demand evaluations —
  // memoized so panel re-renders don't rescan the world). Market $ = weekly
  // demand × base fare: compare markets by money, not just bodies.
  const network = networkCities(player)
  const pairs = useMemo(
    () =>
      CITIES.filter((c) => c.id !== cityId)
        .map((c) => {
          const km = distanceKm(cityId, c.id)
          const demand = pairWeeklyDemand(state, cityId, c.id)
          return {
            to: c.id,
            km,
            demand,
            marketK: Math.floor((demand * baseFare(km)) / 1000), // $k/wk
            competitors: airlinesOnPair(state, cityId, c.id, 0),
            mine: airlinesOnPair(state, cityId, c.id) - airlinesOnPair(state, cityId, c.id, 0) > 0,
            openable:
              (network.has(cityId) || network.has(c.id)) &&
              slotsFree(player, cityId) > 0 &&
              slotsFree(player, c.id) > 0,
          }
        })
        .sort((a, b) => b.marketK - a.marketK)
        .slice(0, 8),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, cityId],
  )

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
            {networkCities(player).has(cityId) && <span className="pos"> · in your network</span>}
          </span>
        </div>
        <button onClick={onClose} aria-label="close city panel" data-testid="city-panel-close">
          ✕
        </button>
      </header>

      <Rating label="population" value={city.pop} />
      <Rating label="business" value={city.biz} />
      <Rating label="tourism" value={city.tour} />
      {city.tour >= 4 && (
        <p className="dim" data-testid="city-season">
          Season: tourism demand peaks Q{city.lat >= 0 ? 3 : 1} (+
          {((city.tour * SEASON_TOUR_BP_PER_POINT) / 100).toFixed(1)}%), dips Q{city.lat >= 0 ? 1 : 3}
          {seasonalBp(city.id, state.turn) !== 10000 && (
            <strong className={seasonalBp(city.id, state.turn) > 10000 ? 'pos' : 'neg'}>
              {' '}
              — {seasonalBp(city.id, state.turn) > 10000 ? 'in season now' : 'off season now'}
            </strong>
          )}
        </p>
      )}

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
        {rivalsHeld > 0 && (
          <span className="dim" data-testid="slot-holders">
            {' '}
            (
            {state.airlines
              .slice(1)
              .map((a) => ({ name: a.name, n: slotsHeld(a, cityId) }))
              .filter((h) => h.n > 0)
              .map((h) => `${h.name} ${h.n}`)
              .join(' · ')}
            )
          </span>
        )}
      </div>

      {cityId !== player.hq && held - used >= SLOT_IDLE_THRESHOLD && (
        <div className="neg" data-testid="slot-idle-warning">
          ⚠ {held - used} slots idle — the authority reclaims one after {SLOT_IDLE_QUARTERS_TO_LOSE} idle quarters (
          {SLOT_IDLE_QUARTERS_TO_LOSE - (player.slotIdle[cityId] ?? 0)}q left)
        </div>
      )}

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
              Negotiate ({(scarcityChanceBp(state, cityId, spend) / 100).toFixed(0)}%)
            </button>
            <span className="dim">difficulty {money(difficulty)}</span>
          </>
        )}
      </div>

      <h3>Top markets from here</h3>
      <table className="city-pairs">
        <thead>
          <tr className="dim">
            <th>pair</th>
            <th>km</th>
            <th>pax/wk</th>
            <th title="weekly demand × base fare">market</th>
            <th>status</th>
          </tr>
        </thead>
        <tbody>
          {pairs.map((p) => (
            <tr key={p.to}>
              <td>
                {cityId}–{p.to}
              </td>
              <td>{p.km}km</td>
              <td>{p.demand}</td>
              <td>{money(p.marketK)}</td>
              <td className="dim">
                {p.mine
                  ? '✓ yours'
                  : p.competitors > 0
                    ? `⚔ ${p.competitors} rival${p.competitors > 1 ? 's' : ''}`
                    : p.openable
                      ? 'open now'
                      : 'need slots'}
              </td>
              <td>
                {onPlanPair && p.openable && !p.mine && (
                  <button data-testid={`city-plan-${p.to}`} onClick={() => onPlanPair(cityId, p.to)}>
                    plan ✈
                  </button>
                )}
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
