// The finance desk, split out of panels.tsx: loans, hedging, marketing, and
// the cost-mix exhibits that explain where every dollar went.

import { useState } from 'react'
import {
  DOMINANCE_PARITY_MULT_BP,
  DOMINANCE_SCRUTINY_BP,
  DOMINANCE_SCRUTINY_MAX_BP,
  HEDGE_MAX_QUARTERS,
  HEDGE_MIN_QUARTERS,
  HEDGE_PREMIUM_PER_AIRCRAFT,
  MARKETING_BASE_PER_LEVEL,
  MARKETING_PER_ROUTE_PER_LEVEL,
  MARKETING_WEIGHT_BP_PER_LEVEL,
} from '../data/constants'
import type { CostBreakdown, GameState } from '../engine'
import { inflationBp } from '../engine/market'
import { currentLoanRateBp, debtCeiling, routeWeeklyCapacity, totalDebt } from '../engine/queries'
import { HedgeLegend, MarketingLegend, RivalryLegend } from './legends'
import { Sparkline } from './Sparkline'
import { dispatch } from './session'
import { COST_LABELS, money } from './format'

// The cost buckets in a stable presentation order, labelled from the shared
// format module so every surface names them identically.
const COST_BUCKETS: readonly { key: keyof CostBreakdown; label: string }[] = (
  ['fuel', 'salaries', 'ownership', 'maintenance', 'fees', 'service', 'flightPay', 'overhead', 'admin', 'marketing', 'interest'] as const
).map((key) => ({ key, label: COST_LABELS[key] }))

// One color per bucket, shared by the mix bands and the structure table so
// the chart and the numbers read as one exhibit.
const BUCKET_COLORS: Record<keyof CostBreakdown, string> = {
  fuel: '#d0636e',
  salaries: '#58c98a',
  ownership: '#4fa3ff',
  maintenance: '#9d7bd8',
  fees: '#d8a052',
  service: '#8fbf6f',
  flightPay: '#c9b458',
  overhead: '#5b6b8c',
  admin: '#7a8fb3',
  marketing: '#e07ab8',
  interest: '#b3564f',
}

// How the cost mix evolved: each quarter is a 100%-stacked slice of its
// breakdown. Structure drift (fuel creeping up, ownership swelling after a
// buying spree) is visible at a glance; absolutes live in the table below.
function CostMixHistory({ state }: { state: GameState }) {
  const player = state.airlines[0]!
  const hist = player.history.slice(-16).filter((h) => h.costs > 0)
  if (hist.length < 2) return null
  const w = 360
  const h = 72
  const bw = w / hist.length
  return (
    <div className="cost-mix" data-testid="cost-mix">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label="cost mix by quarter">
        {hist.map((q, i) => {
          let yTop = h
          return COST_BUCKETS.map((b) => {
            const v = q.breakdown[b.key]
            if (v <= 0) return null
            const bh = (v / q.costs) * h
            yTop -= bh
            return (
              <rect
                key={`${q.turn}-${b.key}`}
                x={i * bw}
                y={yTop}
                width={bw + 0.4}
                height={bh}
                fill={BUCKET_COLORS[b.key]}
              >
                <title>{`t${q.turn} ${b.label}: ${money(v)} (${Math.round((v * 100) / q.costs)}%)`}</title>
              </rect>
            )
          })
        })}
      </svg>
      <span className="dim">cost mix, last {hist.length}q →</span>
    </div>
  )
}

// Where the money went last quarter: exact engine attribution (the buckets
// sum to reported costs), largest first, with proportional bars and the
// quarter-over-quarter move per bucket.
function CostStructure({ state }: { state: GameState }) {
  const player = state.airlines[0]!
  const now = player.history[player.history.length - 1]
  const prev = player.history[player.history.length - 2]
  if (!now || now.costs <= 0) return null
  const rows = COST_BUCKETS.map((b) => ({
    ...b,
    value: now.breakdown[b.key],
    prevValue: prev?.breakdown[b.key],
  }))
    .filter((r) => r.value > 0 || (r.prevValue ?? 0) > 0)
    .sort((a, b) => b.value - a.value)
  const max = Math.max(...rows.map((r) => r.value), 1)
  return (
    <div className="cost-structure" data-testid="cost-structure">
      <h3>Cost structure — {money(now.costs)} last quarter</h3>
      <div className="table-scroll"><table>
        <tbody>
          {rows.map((r) => {
            const delta = r.prevValue === undefined ? null : r.value - r.prevValue
            return (
              <tr key={r.key}>
                <td>
                  <span className="bucket-chip" style={{ background: BUCKET_COLORS[r.key] }} /> {r.label}
                </td>
                <td className="cost-bar-cell">
                  <span className="cost-bar" style={{ width: `${Math.round((r.value * 100) / max)}%` }} />
                </td>
                <td>{money(r.value)}</td>
                <td className="dim">{Math.round((r.value * 100) / now.costs)}%</td>
                <td className={delta === null || delta === 0 ? 'dim' : delta > 0 ? 'neg' : 'pos'}>
                  {delta === null || delta === 0 ? '±0' : delta > 0 ? `▲ ${money(delta)}` : `▼ ${money(-delta)}`}
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
      {state.world.indexHistory.length >= 2 && (
        <div data-testid="world-indices">
          <h3>The world</h3>
          <div className="trend-row">
            <span className="dim">economy</span>
            <Sparkline
              points={state.world.indexHistory.map((h) => h.economyBp)}
              width={180}
              className="sparkline spark-profit"
            />
            <span className={state.world.economyBp >= 10000 ? 'pos' : 'neg'}>
              {(state.world.economyBp / 100).toFixed(0)}%
            </span>
          </div>
          <div className="trend-row">
            <span className="dim" title="effective fuel index, event shocks included">
              fuel
            </span>
            <Sparkline
              points={state.world.indexHistory.map((h) => h.fuelBp)}
              width={180}
              className="sparkline spark-lf"
            />
            <span
              className={
                (state.world.indexHistory[state.world.indexHistory.length - 1]?.fuelBp ?? 10000) > 11000
                  ? 'neg'
                  : 'dim'
              }
            >
              {((state.world.indexHistory[state.world.indexHistory.length - 1]?.fuelBp ?? 10000) / 100).toFixed(0)}%
            </span>
          </div>
        </div>
      )}
      <CostStructure state={state} />
      <CostMixHistory state={state} />
      <p>
        Debt {money(debt)} of {money(ceiling)} ceiling
      </p>
      <div className="city-negotiate" data-testid="hedge-panel">
        {player.fuelHedge !== null ? (
          <span>
            ⛽ Fuel hedged at index {(player.fuelHedge.bp / 100).toFixed(0)}% for{' '}
            {player.fuelHedge.quartersLeft} more quarter(s)
            {player.fuelHedge.quartersLeft === 1 && (
              <span className="neg"> — expires next quarter, you'll be back on the market index</span>
            )}
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
      <div className="city-negotiate" data-testid="marketing-panel">
        <span title="brand spend buys pair appeal in every share battle: schedule × cabin × fare × service × brand">
          Marketing:
        </span>
        {[0, 1, 2, 3].map((level) => (
          <button
            key={level}
            data-testid={`marketing-${level}`}
            className={player.marketing === level ? 'active sort-btn' : 'sort-btn'}
            disabled={player.marketing === level}
            onClick={() => dispatch({ type: 'set_marketing', level })}
          >
            {['off', 'low', 'mid', 'high'][level]}
            {level > 0 &&
              ` ${money(
                level *
                  Math.floor(
                    ((MARKETING_BASE_PER_LEVEL + MARKETING_PER_ROUTE_PER_LEVEL * player.routes.length) *
                      inflationBp(state.turn)) /
                      10000,
                  ),
              )}/q`}
          </button>
        ))}
        <span className="dim">
          +{(MARKETING_WEIGHT_BP_PER_LEVEL / 100).toFixed(0)}% appeal per level on every pair
        </span>
      </div>
      {(() => {
        // Where the player sits against regulatory scrutiny right now.
        const seatsOf = (a: (typeof state.airlines)[number]): number => {
          let n = 0
          for (const r of a.routes) n += routeWeeklyCapacity(a, r)
          return n
        }
        const mine = seatsOf(player)
        let industry = 0
        let live = 0
        for (const a of state.airlines) {
          industry += seatsOf(a)
          if (!a.bankrupt) live++
        }
        if (industry === 0 || mine === 0) return null
        const shareBp = Math.floor((mine * 10000) / industry)
        const thresholdBp = Math.floor(
          (Math.floor(10000 / Math.max(1, live)) * DOMINANCE_PARITY_MULT_BP) / 10000,
        )
        const over = shareBp > thresholdBp
        return (
          <p className={over ? 'neg' : 'dim'} data-testid="scrutiny-note">
            Market share {(shareBp / 100).toFixed(0)}% of industry seats — scrutiny starts at{' '}
            {(thresholdBp / 100).toFixed(0)}%
            {over
              ? ` · regulators are charging you ${(
                  Math.min(
                    DOMINANCE_SCRUTINY_MAX_BP,
                    Math.floor(((shareBp - thresholdBp) * DOMINANCE_SCRUTINY_BP) / 10000),
                  ) / 100
                ).toFixed(2)}% of revenue`
              : ' · clear for now'}
          </p>
        )
      })()}
      <RivalryLegend />
      <MarketingLegend />
      <HedgeLegend />
      <label>
        Amount:{' '}
        <input type="number" value={amount} min={100} step={100} onChange={(e) => setAmount(Number(e.target.value))} />{' '}
        $k
      </label>
      <button onClick={() => dispatch({ type: 'take_loan', amount })}>take loan</button>{' '}
      <span className="dim" data-testid="loan-rate">
        today's rate {(currentLoanRateBp(state) / 100).toFixed(1)}%/yr
        <span title="the rate follows the economy — borrow in booms, not busts">
          {' '}
          ({state.world.economyBp >= 10000 ? 'cheap money' : 'tight money'})
        </span>
      </span>
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
