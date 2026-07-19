// The quarterly report card: what just happened, at a glance — shown after
// every End Quarter. Built purely from the session's reportEvents plus the
// player's stats history (this quarter vs last).

import { AIRCRAFT, getAircraftType } from '../data/aircraft'
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
            {(() => {
              // Position in the race, and whether this quarter moved it.
              const rankAt = (pick: (a: (typeof state.airlines)[number]) => number): number => {
                const alive = state.airlines.filter((a) => !a.bankrupt)
                alive.sort((a, b) => pick(b) - pick(a))
                return alive.findIndex((a) => a.id === 0) + 1
              }
              const rankNow = rankAt((a) => a.history[a.history.length - 1]?.netWorth ?? 0)
              const rankPrev = prev ? rankAt((a) => a.history[a.history.length - 2]?.netWorth ?? 0) : rankNow
              if (rankNow === 0) return null
              return (
                <tr>
                  <td>Position</td>
                  <td className={rankNow === 1 ? 'pos' : ''}>#{rankNow}</td>
                  <td className={rankNow < rankPrev ? 'pos' : rankNow > rankPrev ? 'neg' : 'dim'}>
                    {rankNow < rankPrev ? `▲ from #${rankPrev}` : rankNow > rankPrev ? `▼ from #${rankPrev}` : '±0'}
                  </td>
                </tr>
              )
            })()}
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

        {(() => {
          // Records are reward moments: call them out the quarter they land.
          if (player.history.length < 5) return null
          const older = player.history.slice(0, -1)
          const records: string[] = []
          if (now.pax > Math.max(...older.map((h) => h.pax))) records.push('most passengers ever')
          if (now.profit > 0 && now.profit > Math.max(...older.map((h) => h.profit)))
            records.push('best profit ever')
          if (records.length === 0) return null
          return (
            <p className="pos" data-testid="report-records">
              🎉 Record quarter — {records.join(' · ')}
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

        {(() => {
          // Espionage-lite: rivals winning slots at YOUR airports are staging
          // for something — say so before the routes appear.
          const myCities = new Set<string>()
          for (const r of player.routes) {
            myCities.add(r.from)
            myCities.add(r.to)
          }
          for (const c of Object.keys(player.slots).sort()) if ((player.slots[c] ?? 0) > 0) myCities.add(c)
          const rivalGains = events.filter(
            (e): e is Extract<GameEvent, { type: 'slots_granted' }> =>
              e.type === 'slots_granted' && e.airline !== 0 && myCities.has(e.city),
          )
          if (rivalGains.length === 0) return null
          return (
            <p className="neg" data-testid="report-rival-slots">
              🕵{' '}
              {rivalGains
                .map((g) => `${state.airlines[g.airline]?.name ?? 'A rival'} won ${g.slots} slots at ${g.city} — your airport`)
                .join(' · ')}
            </p>
          )
        })()}

        {(() => {
          // Year in review: when a Q4 resolves (the report shows as the new
          // year's Q1), digest the four quarters just flown against the four
          // before them. The annual rhythm is the era's heartbeat.
          if (quarterOf(state) !== 1 || player.history.length < 4) return null
          const h = player.history
          const yearSlice = h.slice(-4)
          const prevSlice = h.slice(-8, -4)
          const sum = (rows: typeof yearSlice, pick: (q: (typeof h)[number]) => number) =>
            rows.reduce((acc, q) => acc + pick(q), 0)
          const revenue = sum(yearSlice, (q) => q.revenue)
          const profit = sum(yearSlice, (q) => q.profit)
          const pax = sum(yearSlice, (q) => q.pax)
          const prevPax = prevSlice.length === 4 ? sum(prevSlice, (q) => q.pax) : null
          const paxGrowth = prevPax !== null && prevPax > 0 ? Math.round(((pax - prevPax) * 100) / prevPax) : null
          return (
            <div className="year-review" data-testid="year-review">
              <h3>{yearOf(state) - 1} in review</h3>
              <p>
                Revenue {money(revenue)} · profit{' '}
                <span className={profit >= 0 ? 'pos' : 'neg'}>{money(profit)}</span> ·{' '}
                {pax.toLocaleString('en-US')} pax
                {paxGrowth !== null && (
                  <span className={paxGrowth >= 0 ? 'pos' : 'neg'}>
                    {' '}
                    ({paxGrowth >= 0 ? '▲' : '▼'}
                    {Math.abs(paxGrowth)}% vs prior year)
                  </span>
                )}{' '}
                · {player.routes.length} routes · {player.fleet.length} aircraft
              </p>
            </div>
          )
        })()}

        {quarterOf(state) === 1 &&
          AIRCRAFT.some((t) => t.availableFrom === yearOf(state)) && (
            <p className="pos" data-testid="new-aircraft-news">
              🛒{' '}
              {AIRCRAFT.filter((t) => t.availableFrom === yearOf(state))
                .map((t) => `${t.name} enters the market`)
                .join(' · ')}
            </p>
          )}

        {(() => {
          // The macro backdrop: how the economy and fuel indices moved this
          // quarter — the two lines most margin stories trace back to.
          const ih = state.world.indexHistory
          if (ih.length < 2) return null
          const nowIdx = ih[ih.length - 1]!
          const prevIdx = ih[ih.length - 2]!
          const dEcon = nowIdx.economyBp - prevIdx.economyBp
          const dFuel = nowIdx.fuelBp - prevIdx.fuelBp
          if (Math.abs(dEcon) < 100 && Math.abs(dFuel) < 100) return null
          return (
            <p className="dim" data-testid="report-macro">
              Macro: economy {(nowIdx.economyBp / 100).toFixed(0)}%
              {Math.abs(dEcon) >= 100 && (
                <span className={dEcon > 0 ? 'pos' : 'neg'}>
                  {' '}
                  ({dEcon > 0 ? '▲' : '▼'}
                  {Math.abs(dEcon / 100).toFixed(0)})
                </span>
              )}{' '}
              · fuel {(nowIdx.fuelBp / 100).toFixed(0)}%
              {Math.abs(dFuel) >= 100 && (
                <span className={dFuel > 0 ? 'neg' : 'pos'}>
                  {' '}
                  ({dFuel > 0 ? '▲' : '▼'}
                  {Math.abs(dFuel / 100).toFixed(0)})
                </span>
              )}
            </p>
          )
        })()}

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
