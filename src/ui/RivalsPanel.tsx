// Competitor intelligence: the net-worth race and a dossier card per rival —
// personality, hubs, fleet composition, network size, momentum.

import { getAircraftType } from '../data/aircraft'
import { pairKey } from '../data/cities'
import type { Airline, GameState } from '../engine'
import { netWorth, slotCities } from '../engine/queries'
import { RIVAL_COLORS } from './MapView'
import { RaceChart, Sparkline } from './Sparkline'

function money(k: number): string {
  return k >= 1000 || k <= -1000 ? `$${(k / 1000).toFixed(1)}M` : `$${k}k`
}

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

export function RivalsPanel({ state }: { state: GameState }) {
  const series = state.airlines.map((a, i) => ({
    label: a.name,
    points: a.history.map((h) => h.netWorth),
    className: i === 0 ? 'race-me' : `race-rival-${i}`,
  }))

  return (
    <div data-testid="rivals-panel">
      <h3>The race — net worth by quarter</h3>
      <RaceChart series={series} />
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
                    {contested > 0 && (
                      <span className="neg">
                        {' '}
                        · ⚔ {contested} pair{contested === 1 ? '' : 's'} contested with you
                      </span>
                    )}
                  </p>
                  <p className="dim">{fleetSummary(rival)}</p>
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
