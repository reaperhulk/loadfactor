import type { GameEvent, QuarterStats } from '../engine'
import { comparePlan, type ApprovedPlan } from './planReview'
import { COST_LABELS, money } from './format'

export function PlanReview({ plan, actual, events, onInspect }: { plan?: ApprovedPlan; actual: QuarterStats; events: GameEvent[]; onInspect?: (id: number) => void }) {
  if (!plan || plan.turn !== actual.turn) return <p className="hint">No approved forecast was saved for this quarter.</p>
  const comparison = comparePlan(plan, actual, events)
  const top = comparison.movements.slice(0, 3)
  const other = comparison.movements.slice(3).reduce((n, r) => n + r.delta, 0)
  return <section className="plan-review" data-testid="plan-review">
    <h3>Your plan → the result</h3>
    <dl className="decision-metrics">
      <div><dt>Planned profit</dt><dd>{money(plan.profit)}</dd></div>
      <div><dt>Actual profit</dt><dd>{money(actual.profit)}</dd></div>
      <div><dt>Difference</dt><dd className={comparison.profitDelta >= 0 ? 'pos' : 'neg'}>{money(comparison.profitDelta)}</dd></div>
      <div><dt>Cash vs plan</dt><dd className={comparison.cashDelta >= 0 ? 'pos' : 'neg'}>{money(comparison.cashDelta)}</dd></div>
    </dl>
    {top.length > 0 ? <><p className="eyebrow">What changed profit</p><ul className="decision-movements">{[...top, ...(other ? [{ key: 'other', delta: other }] : [])].map(row => <li key={row.key}><span>{row.key === 'revenue' ? 'Passenger revenue' : row.key === 'other' ? 'Other costs combined' : COST_LABELS[row.key as keyof typeof COST_LABELS]}</span><strong className={row.delta >= 0 ? 'pos' : 'neg'}>{row.delta > 0 ? '+' : ''}{money(row.delta)}</strong></li>)}</ul></> : <p>The quarter matched the planned profit.</p>}
    {comparison.routes.some(r => r.delta !== 0) && <details><summary>Routes with the largest differences</summary><ul className="decision-movements">{comparison.routes.filter(r => r.delta !== 0).slice(0, 3).map(r => <li key={r.id}><span>{onInspect ? <button className="link-btn" onClick={() => onInspect(r.id)}>{r.name} →</button> : r.name}<small>{r.paxDelta > 0 ? '+' : ''}{r.paxDelta.toLocaleString('en-US')} boardings vs plan</small></span><strong className={r.delta >= 0 ? 'pos' : 'neg'}>{money(r.delta)}</strong></li>)}</ul></details>}
    <p className="hint">Positive amounts improve profit. Cost differences include changes in prices and flying. The forecast held fuel, demand and rival plans fixed; deliveries and disruptions can also change the result.</p>
  </section>
}
