// Competitor intelligence: the net-worth race and a dossier card per rival —
// personality, hubs, fleet composition, network size, momentum.

import { useState } from 'react'
import { getAircraftType } from '../data/aircraft'
import { pairKey } from '../data/cities'
import type { Airline, GameState } from '../engine'
import { netWorth, routeWeeklyCapacity, slotCities } from '../engine/queries'
import { RIVAL_COLORS } from './MapView'
import { RaceChart, Sparkline } from './Sparkline'
import { money } from './format'

const PERSONALITY_BLURBS: Record<string, string> = {
  player: '',
  balanced: 'Balanced — steady expansion on the busiest pairs.',
  price_war: 'Price war — cheap seats and a fast-growing fleet.',
  premium: 'Premium — full service at a markup.',
  fortress: 'Fortress — a dense home-region web first.',
}

function fleetSummary(airline: Airline): string {
  const byType = new Map<string, number>()
  for (const a of airline.fleet) byType.set(a.type, (byType.get(a.type) ?? 0) + 1)
  return (
    [...byType.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([type, n]) => `${n}× ${getAircraftType(type).name}`)
      .join(', ') || 'no aircraft'
  )
}

// Total weekly seats an airline fields across its whole network — the
// hardware race behind the money race.
function fieldedSeats(airline: Airline): number {
  let seats = 0
  for (const r of airline.routes) seats += routeWeeklyCapacity(airline, r)
  return seats
}

// The vitals every airline reports each quarter, side by side. One row per
// airline (you first), best value per column highlighted — the spreadsheet
// answer to "how am I doing relative to them".
function StandingsTable({ state }: { state: GameState }) {
  const worldPax = state.airlines.reduce(
    (sum, a) => sum + (a.history[a.history.length - 1]?.pax ?? 0),
    0,
  )
  const rows = state.airlines.map((a) => {
    const last = a.history[a.history.length - 1]
    const prev = a.history[a.history.length - 2]
    return {
      id: a.id,
      name: a.id === 0 ? `${a.name} (you)` : a.name,
      bankrupt: a.bankrupt,
      netWorth: netWorth(a),
      worthTrend: last && prev ? last.netWorth - prev.netWorth : 0,
      cash: a.cash,
      revenue: last?.revenue ?? 0,
      profit: last?.profit ?? 0,
      marginBp: last && last.revenue > 0 ? Math.floor((last.profit * 10000) / last.revenue) : 0,
      pax: last?.pax ?? 0,
      shareBp: worldPax > 0 ? Math.floor(((last?.pax ?? 0) * 10000) / worldPax) : 0,
      seats: fieldedSeats(a),
      routes: a.routes.length,
      cities: slotCities(a).length,
      fleet: a.fleet.length,
    }
  })
  const best = (key: keyof (typeof rows)[number]): number =>
    Math.max(...rows.filter((r) => !r.bankrupt).map((r) => r[key] as number))
  const cell = (r: (typeof rows)[number], key: keyof (typeof rows)[number], text: string) => (
    <td className={!r.bankrupt && (r[key] as number) === best(key) ? 'pos' : ''}>{text}</td>
  )
  return (
    <div className="table-scroll">
      <table data-testid="standings">
        <thead>
          <tr className="dim">
            <th>airline</th>
            <th>net worth</th>
            <th>cash</th>
            <th>rev/q</th>
            <th>profit/q</th>
            <th>margin</th>
            <th>pax/q</th>
            <th title="share of all passengers flown industry-wide last quarter">share</th>
            <th>seats/wk</th>
            <th>routes</th>
            <th>cities</th>
            <th>fleet</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={r.id === 0 ? 'me' : r.bankrupt ? 'dim' : ''}>
              <td>{r.bankrupt ? `${r.name} ✝` : r.name}</td>
              <td className={!r.bankrupt && r.netWorth === best('netWorth') ? 'pos' : ''}>
                {money(r.netWorth)}
                {!r.bankrupt && r.worthTrend !== 0 && (
                  <span
                    className={r.worthTrend > 0 ? 'pos' : 'neg'}
                    title={`${r.worthTrend > 0 ? '+' : ''}${money(r.worthTrend)} vs last quarter`}
                  >
                    {' '}
                    {r.worthTrend > 0 ? '▲' : '▼'}
                  </span>
                )}
              </td>
              {cell(r, 'cash', money(r.cash))}
              {cell(r, 'revenue', money(r.revenue))}
              {cell(r, 'profit', money(r.profit))}
              {cell(r, 'marginBp', `${(r.marginBp / 100).toFixed(1)}%`)}
              {cell(r, 'pax', r.pax.toLocaleString('en-US'))}
              {cell(r, 'shareBp', `${(r.shareBp / 100).toFixed(1)}%`)}
              {cell(r, 'seats', r.seats.toLocaleString('en-US'))}
              {cell(r, 'routes', String(r.routes))}
              {cell(r, 'cities', String(r.cities))}
              {cell(r, 'fleet', String(r.fleet))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const RACE_METRICS = [
  { key: 'netWorth', label: 'net worth' },
  { key: 'revenue', label: 'revenue' },
  { key: 'pax', label: 'passengers' },
] as const

export function RivalsPanel({ state }: { state: GameState }) {
  const [metric, setMetric] = useState<(typeof RACE_METRICS)[number]['key']>('netWorth')
  const series = state.airlines.map((a, i) => ({
    label: a.name,
    points: a.history.map((h) => h[metric]),
    className: i === 0 ? 'race-me' : `race-rival-${i}`,
  }))
  const mySeats = fieldedSeats(state.airlines[0]!)

  return (
    <div data-testid="rivals-panel">
      <h3>
        The race —{' '}
        {RACE_METRICS.map((m) => (
          <button
            key={m.key}
            className={`link-btn sort-btn${metric === m.key ? ' active' : ''}`}
            data-testid={`race-metric-${m.key}`}
            onClick={() => setMetric(m.key)}
          >
            {m.label}
          </button>
        ))}{' '}
        by quarter
      </h3>
      <RaceChart series={series} format={metric === 'pax' ? (v) => v.toLocaleString('en-US') : undefined} />
      <StandingsTable state={state} />
      <div className="race-legend">
        {state.airlines.map((a, i) => (
          <span key={a.id} className={i === 0 ? 'race-key me' : `race-key rival-${i}`}>
            ■ {a.id === 0 ? 'You' : a.name}
          </span>
        ))}
      </div>
      <div className="rival-cards">
        {state.airlines.slice(1).map((rival) => {
          const last = rival.history[rival.history.length - 1]
          // Pairs where this rival and the player are in direct battle.
          const myPairs = new Set(state.airlines[0]!.routes.map((r) => pairKey(r.from, r.to)))
          const contested = rival.routes.filter((r) => myPairs.has(pairKey(r.from, r.to))).length
          return (
            <div key={rival.id} className="rival-card" data-testid={`rival-${rival.id}`}>
              <h4>
                <span
                  className="rival-chip"
                  style={{ background: RIVAL_COLORS[(rival.id - 1) % RIVAL_COLORS.length] }}
                />
                {rival.name} {rival.bankrupt && <span className="neg">— bankrupt</span>}
              </h4>
              <p className="dim">{PERSONALITY_BLURBS[rival.personality] ?? rival.personality}</p>
              {!rival.bankrupt && (
                <>
                  <p>
                    Net worth {money(netWorth(rival))} · {rival.routes.length} routes ·{' '}
                    {slotCities(rival).length} cities · hub {rival.hq}
                    {rival.marketing > 0 && (
                      <span title="their marketing level buys pair appeal in every shared market">
                        {' '}
                        · brand {['', 'low', 'mid', 'high'][rival.marketing]}
                      </span>
                    )}
                    {contested > 0 && (
                      <span className="neg">
                        {' '}
                        · ⚔ {contested} pair{contested === 1 ? '' : 's'} contested with you
                      </span>
                    )}
                  </p>
                  <p className="dim">
                    Fields {fieldedSeats(rival).toLocaleString('en-US')} seats/wk{' '}
                    {mySeats > 0 && (
                      <span title="their weekly seats vs yours">
                        ({Math.round((fieldedSeats(rival) * 100) / mySeats)}% of your capacity)
                      </span>
                    )}
                    {(() => {
                      // Momentum: passengers now vs a year ago.
                      const h = rival.history
                      if (h.length < 5) return null
                      const now = h[h.length - 1]!.pax
                      const then = h[h.length - 5]!.pax
                      if (then <= 0) return null
                      const pct = Math.round(((now - then) * 100) / then)
                      return (
                        <span className={pct >= 0 ? 'pos' : 'neg'} title="passenger volume vs 4 quarters ago">
                          {' '}
                          · pax {pct >= 0 ? '▲' : '▼'}
                          {Math.abs(pct)}%/y
                        </span>
                      )
                    })()}
                  </p>
                  <p className="dim">{fleetSummary(rival)}</p>
                  {rival.routes.length > 0 && (
                    <p className="dim" data-testid={`rival-${rival.id}-newest`}>
                      {/* Route ids ascend as routes open — the tail is where
                          they're expanding right now. */}
                      Newest routes:{' '}
                      {[...rival.routes]
                        .sort((a, b) => b.id - a.id)
                        .slice(0, 3)
                        .map((r) => `${r.from}–${r.to}`)
                        .join(', ')}
                    </p>
                  )}
                  <div className="trend-row">
                    <span className="dim">profit</span>
                    <Sparkline points={rival.history.slice(-16).map((h) => h.profit)} className="sparkline spark-profit" />
                    <span className={last && last.profit >= 0 ? 'pos' : 'neg'}>
                      {last ? `${money(last.profit)}/q` : '—'}
                    </span>
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
