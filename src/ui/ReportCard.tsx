// The quarterly report card: what just happened, at a glance — shown after
// every End Quarter. Built purely from the session's reportEvents plus the
// player's stats history (this quarter vs last).

import { getAircraftType } from '../data/aircraft'
import { pairKey } from '../data/cities'
import { getEventDef } from '../data/events'
import type { GameEvent, GameState } from '../engine'
import { quarterOf, yearOf } from '../engine/queries'
import { COST_LABELS, money } from './format'

function delta(now: number, prev: number | undefined): string {
  if (prev === undefined) return ''
  const d = now - prev
  if (d === 0) return '±0'
  return d > 0 ? `▲ ${money(d)}` : `▼ ${money(-d)}`
}

interface ReportCardProps {
  state: GameState
  events: GameEvent[]
  onClose: () => void
}

export function ReportCard({ state, events, onClose }: ReportCardProps) {
  const player = state.airlines[0]!
  const now = player.history[player.history.length - 1]
  const prev = player.history[player.history.length - 2]
  if (!now) return null

  const routeResults = events.filter(
    (e): e is Extract<GameEvent, { type: 'route_result' }> => e.type === 'route_result' && e.airline === 0,
  )
  let best: (typeof routeResults)[number] | null = null
  let worst: (typeof routeResults)[number] | null = null
  for (const r of routeResults) {
    if (best === null || r.revenue - r.cost > best.revenue - best.cost) best = r
    if (worst === null || r.revenue - r.cost < worst.revenue - worst.cost) worst = r
  }
  const routeName = (routeId: number): string => {
    const r = player.routes.find((x) => x.id === routeId)
    return r ? `${r.from}–${r.to}` : 'closed route'
  }

  let transferPax = 0
  for (const r of routeResults) transferPax += r.transferPax

  const deliveries = events.filter(
    (e): e is Extract<GameEvent, { type: 'aircraft_delivered' }> =>
      e.type === 'aircraft_delivered' && e.airline === 0,
  )
  const slotWins = events.filter(
    (e): e is Extract<GameEvent, { type: 'slots_granted' }> => e.type === 'slots_granted' && e.airline === 0,
  )
  const slotLosses = events.filter(
    (e): e is Extract<GameEvent, { type: 'slot_lost' }> => e.type === 'slot_lost' && e.airline === 0,
  )
  const negotiationFails = events.filter(
    (e): e is Extract<GameEvent, { type: 'negotiation_failed' }> =>
      e.type === 'negotiation_failed' && e.airline === 0,
  )
  // Rivals moving onto pairs the player serves — the quarter's declarations
  // of war belong on the front page.
  const myPairs = new Set(player.routes.map((r) => pairKey(r.from, r.to)))
  const incursions = events.filter(
    (e): e is Extract<GameEvent, { type: 'route_opened' }> =>
      e.type === 'route_opened' && e.airline !== 0 && myPairs.has(pairKey(e.from, e.to)),
  )
  const worldNews = events.filter(
    (e): e is Extract<GameEvent, { type: 'world_event_started' }> => e.type === 'world_event_started',
  )
  const rivalReports = events.filter(
    (e): e is Extract<GameEvent, { type: 'quarter_report' }> => e.type === 'quarter_report' && e.airline !== 0,
  )

  return (
    <div className="gameover-overlay report-overlay" data-testid="report-card" onClick={onClose}>
      <div className="gameover-card report-card" onClick={(e) => e.stopPropagation()}>
        <h2>
          {yearOf(state)} Q{quarterOf(state)} report
        </h2>
        <table className="report-lines">
          <tbody>
            <tr>
              <td>Revenue</td>
              <td>{money(now.revenue)}</td>
              <td className="dim">{delta(now.revenue, prev?.revenue)}</td>
            </tr>
            <tr>
              <td>Costs</td>
              <td>{money(now.costs)}</td>
              <td className="dim">{delta(now.costs, prev?.costs)}</td>
            </tr>
            <tr>
              <td>Profit</td>
              <td className={now.profit >= 0 ? 'pos' : 'neg'}>{money(now.profit)}</td>
              <td className="dim">{delta(now.profit, prev?.profit)}</td>
            </tr>
            {now.revenue > 0 && (
              <tr>
                <td className="dim">margin</td>
                <td className={now.profit >= 0 ? 'pos' : 'neg'}>
                  {((now.profit * 100) / now.revenue).toFixed(1)}%
                </td>
                <td />
              </tr>
            )}
            <tr>
              <td>Passengers</td>
              <td>{now.pax.toLocaleString('en-US')}</td>
              <td className="dim">{prev ? delta(now.pax, prev.pax).replace('$', '').replace('M', 'M') : ''}</td>
            </tr>
            {transferPax > 0 && (
              <tr>
                <td className="dim">of which connecting</td>
                <td className="dim">{transferPax.toLocaleString('en-US')}</td>
                <td />
              </tr>
            )}
            <tr>
              <td>Net worth</td>
              <td>{money(now.netWorth)}</td>
              <td className="dim">{delta(now.netWorth, prev?.netWorth)}</td>
            </tr>
          </tbody>
        </table>

        {(() => {
          // The quarter's biggest cost move, from the exact engine breakdown.
          if (!prev) return null
          let bigKey: keyof typeof now.breakdown | null = null
          let bigDelta = 0
          for (const key of Object.keys(now.breakdown) as (keyof typeof now.breakdown)[]) {
            const d = now.breakdown[key] - prev.breakdown[key]
            if (Math.abs(d) > Math.abs(bigDelta)) {
              bigDelta = d
              bigKey = key
            }
          }
          if (bigKey === null || Math.abs(bigDelta) < 500) return null
          return (
            <p className="dim" data-testid="cost-mover">
              Biggest cost move: {COST_LABELS[bigKey]}{' '}
              <span className={bigDelta > 0 ? 'neg' : 'pos'}>
                {bigDelta > 0 ? '▲' : '▼'} {money(Math.abs(bigDelta))}
              </span>
            </p>
          )
        })()}

        {best && (
          <p>
            Best route: <strong>{routeName(best.routeId)}</strong>{' '}
            <span className="pos">{money(best.revenue - best.cost)}</span>
            {worst && worst.routeId !== best.routeId && (
              <>
                {' · '}worst: <strong>{routeName(worst.routeId)}</strong>{' '}
                <span className={worst.revenue - worst.cost >= 0 ? 'pos' : 'neg'}>
                  {money(worst.revenue - worst.cost)}
                </span>
              </>
            )}
          </p>
        )}

        {(deliveries.length > 0 || slotWins.length > 0 || slotLosses.length > 0 || negotiationFails.length > 0) && (
          <p>
            {[
              ...deliveries.map((d) => `${getAircraftType(d.aircraftType).name} delivered`),
              ...slotWins.map((s) => `${s.slots} slots won at ${s.city}`),
              ...slotLosses.map((s) => `idle slot forfeited at ${s.city}`),
              ...negotiationFails.map((n) => `negotiation failed at ${n.city}`),
            ].join(' · ')}
          </p>
        )}

        {incursions.length > 0 && (
          <p className="neg" data-testid="report-incursions">
            ⚔{' '}
            {incursions
              .map((i) => `${state.airlines[i.airline]?.name ?? 'A rival'} moved onto ${i.from}–${i.to}`)
              .join(' · ')}
          </p>
        )}

        {worldNews.length > 0 && (
          <p className="dim">
            World:{' '}
            {worldNews
              .map((w) => `${getEventDef(w.eventId).name}${w.city ? ` (${w.city})` : w.region ? ` (${w.region.toUpperCase()})` : ''}`)
              .join(' · ')}
          </p>
        )}

        {rivalReports.length > 0 && (
          <p className="dim">
            {rivalReports
              .map((r) => `${state.airlines[r.airline]?.name}: ${money(r.profit)} profit`)
              .join(' · ')}
          </p>
        )}

        <button data-testid="report-card-close" onClick={onClose}>
          Continue (space)
        </button>
      </div>
    </div>
  )
}
