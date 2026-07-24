// The report newspaper, split out of panels.tsx: the quarter archive, the
// filterable wire, and the annual review.

import { useState } from 'react'
import { getAircraftType } from '../data/aircraft'
import { getScenario } from '../data/scenarios'
import type { GameEvent, GameState } from '../engine'
import { type QuarterRecord } from './session'
import { money } from './format'

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
    case 'slot_lost':
      return e.airline === 0 ? `Idle slot at ${e.city} forfeited` : null
    case 'bidding_war':
      return `Bidding war at ${e.city} — ${e.airlines.map((a) => name(a)).join(' vs ')}`
    case 'rival_acquired':
      return `${name(e.airline)} acquired ${name(e.target)} for ${money(e.price)} (${e.routes} routes, ${e.aircraft} aircraft)`
    case 'world_event_started':
      return `World: ${e.eventId.replace('_', ' ')}${e.city ? ` in ${e.city}` : ''}${e.region ? ` in region ${e.region}` : ''}`
    case 'world_event_ended':
      return `World: ${e.eventId.replace('_', ' ')} ended`
    case 'airline_bankrupt':
      return `${name(e.airline)} went bankrupt`
    case 'airline_restructured':
      return `${name(e.airline)} restructured — ${money(e.debtWiped)} of debt written off, ${e.routesClosed} routes closed, ${e.fleetSold} aircraft sold`
    case 'airline_entered':
      return `${e.name} enters the market from ${e.hq}`
    case 'offer_made':
      return `Offer on the table: ${e.headline}`
    case 'offer_accepted':
      return `Took the deal — ${money(e.costK)} committed`
    case 'offer_declined':
      return `Passed on an offer`
    case 'offer_expired':
      return `Offer lapsed: ${e.headline}`
    case 'deal_ended':
      return `A commitment ran its course${e.city ? ` at ${e.city}` : ''}`
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

// The newspaper's sections: which events land under which filter.
const LOG_FILTERS = [
  { key: 'all', label: 'all news' },
  { key: 'network', label: 'routes' },
  { key: 'airports', label: 'airports' },
  { key: 'fleet', label: 'fleet' },
  { key: 'world', label: 'world' },
  { key: 'money', label: 'money' },
] as const
type LogFilter = (typeof LOG_FILTERS)[number]['key']

function eventSection(e: GameEvent): LogFilter {
  switch (e.type) {
    case 'route_opened':
    case 'route_closed':
      return 'network'
    case 'slots_granted':
    case 'slot_lost':
    case 'negotiation_failed':
    case 'negotiation_started':
    case 'bidding_war':
      return 'airports'
    case 'aircraft_delivered':
    case 'order_cancelled':
    case 'cabin_refit':
      return 'fleet'
    case 'world_event_started':
    case 'world_event_ended':
    case 'airline_bankrupt':
    case 'airline_restructured':
    case 'airline_entered':
    case 'offer_made':
    case 'offer_accepted':
    case 'offer_declined':
    case 'offer_expired':
    case 'deal_ended':
    case 'rival_acquired':
      return 'world'
    default:
      return 'money'
  }
}

// One resolved quarter rendered as the day's paper: the route results table
// on top, the filtered wire log underneath.
function QuarterPage({ state, events }: { state: GameState; events: GameEvent[] }) {
  const [filter, setFilter] = useState<LogFilter>('all')
  const lines = events
    .filter((e) => filter === 'all' || eventSection(e) === filter)
    .map((e) => describeEvent(state, e))
    .filter((l): l is string => l !== null)
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
      <p className="dim">
        {LOG_FILTERS.map((f) => (
          <button
            key={f.key}
            className={`link-btn sort-btn${filter === f.key ? ' active' : ''}`}
            data-testid={`report-filter-${f.key}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </p>
      <ul className="report" data-testid="report">
        {lines.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
        {lines.length === 0 && <li className="dim">Nothing on this wire for that quarter.</li>}
      </ul>
    </div>
  )
}

// The annual review: each completed year's totals from the ledger the
// engine already keeps — where the decades came from, at a glance.
function AnnualReview({ state }: { state: GameState }) {
  const player = state.airlines[0]!
  const startYear = getScenario(state.scenario).startYear
  const years: { year: number; revenue: number; profit: number; pax: number; endWorth: number }[] = []
  for (let i = 0; i + 4 <= player.history.length; i += 4) {
    const slice = player.history.slice(i, i + 4)
    years.push({
      year: startYear + Math.floor((slice[0]!.turn ?? i) / 4),
      revenue: slice.reduce((s, h) => s + h.revenue, 0),
      profit: slice.reduce((s, h) => s + h.profit, 0),
      pax: slice.reduce((s, h) => s + h.pax, 0),
      endWorth: slice[slice.length - 1]!.netWorth,
    })
  }
  if (years.length === 0) return <p className="hint">Finish a full year to read the annual review.</p>
  const bestProfit = Math.max(...years.map((y) => y.profit))
  return (
    <div className="table-scroll">
      <table data-testid="annual-review">
        <thead>
          <tr className="dim">
            <th>year</th>
            <th>revenue</th>
            <th>profit</th>
            <th>passengers</th>
            <th>net worth</th>
          </tr>
        </thead>
        <tbody>
          {years.map((y) => (
            <tr key={y.year}>
              <td>{y.year}</td>
              <td>{money(y.revenue)}</td>
              <td className={y.profit >= 0 ? (y.profit === bestProfit ? 'pos' : '') : 'neg'}>
                {money(y.profit)}
                {y.profit === bestProfit && years.length > 1 && ' ★'}
              </td>
              <td>{y.pax.toLocaleString('en-US')}</td>
              <td>{money(y.endWorth)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function ReportPanel({ state, archive }: { state: GameState; archive: QuarterRecord[] }) {
  // idx === null shows the latest edition; the arrows browse the morgue.
  const [idx, setIdx] = useState<number | null>(null)
  const [view, setView] = useState<'quarter' | 'years'>('quarter')
  if (archive.length === 0) return <p className="hint">End the quarter to see your first report.</p>
  const shown = Math.min(idx ?? archive.length - 1, archive.length - 1)
  const record = archive[shown]!
  const startYear = getScenario(state.scenario).startYear
  const dateOf = (turn: number): string => `${startYear + Math.floor(turn / 4)} Q${(turn % 4) + 1}`
  return (
    <div>
      <p>
        <button
          className={`link-btn sort-btn${view === 'quarter' ? ' active' : ''}`}
          data-testid="report-view-quarter"
          onClick={() => setView('quarter')}
        >
          quarterly
        </button>
        <button
          className={`link-btn sort-btn${view === 'years' ? ' active' : ''}`}
          data-testid="report-view-years"
          onClick={() => setView('years')}
        >
          annual review
        </button>
        {view === 'quarter' && (
          <span className="report-nav">
            {' · '}
            <button
              aria-label="previous quarter"
              data-testid="report-prev"
              disabled={shown === 0}
              onClick={() => setIdx(shown - 1)}
            >
              ‹
            </button>{' '}
            <strong data-testid="report-date">{dateOf(record.turn)}</strong>{' '}
            <button
              aria-label="next quarter"
              data-testid="report-next"
              disabled={shown >= archive.length - 1}
              onClick={() => setIdx(shown + 1 >= archive.length - 1 ? null : shown + 1)}
            >
              ›
            </button>
            {shown < archive.length - 1 && (
              <button className="link-btn" data-testid="report-latest" onClick={() => setIdx(null)}>
                latest
              </button>
            )}
          </span>
        )}
      </p>
      {view === 'quarter' ? (
        <QuarterPage key={shown} state={state} events={record.events} />
      ) : (
        <AnnualReview state={state} />
      )}
    </div>
  )
}
