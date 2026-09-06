import type { GameState } from '../engine'
import { useMemo } from 'react'
import { OperationsSummary } from './OperationsSummary'
import { forecastQuarter } from '../engine/forecast'
import { isGrounded, quarterOf, yearOf } from '../engine/queries'
import { usePlanningDraftCount } from './planningDrafts'
import { Dialog } from './Dialog'
import { money } from './format'
import { viewSeat } from './session'

export function QuarterReview({ state, forecast, onClose, onConfirm }: {
  state: GameState; forecast: ReturnType<typeof forecastQuarter>; onClose: () => void; onConfirm: () => void
}) {
  const adverse = useMemo(() => state.airlines[viewSeat()]!.operationsPolicy ? forecastQuarter(state, viewSeat(), [], { operations: 'adverse' }) : undefined, [state])
  const drafts = usePlanningDraftCount()
  const airline = state.airlines[viewSeat()]!
  const idle = airline.fleet.filter((a) => a.routeId === null && !a.reserve && !isGrounded(a, state.turn)).length
  const losing = forecast.routes.filter((r) => r.lastRevenue < r.lastCost).length
  return <Dialog label="Review quarter" className="gameover-overlay" testId="quarter-review" onClose={onClose}>
    <div className="report-card quarter-review">
      <div className="dialog-heading"><div><span className="eyebrow">{yearOf(state)} Q{quarterOf(state)} · planning</span><h2>Review your next quarter</h2></div><button onClick={onClose} aria-label="Close quarter review">×</button></div>
      {drafts > 0 && <p role="status" className="draft-warning">{drafts} unapplied changes are excluded from this forecast and will not fly. Return to planning to apply or discard them.</p>}
      <p className="review-profit"><small>Planned company net profit</small><strong className={forecast.profit >= 0 ? 'pos' : 'neg'}>{money(forecast.profit)}</strong></p>
      <dl className="cash-bridge" data-testid="review-cash-bridge">
        <div><dt>Cash now</dt><dd>{money(airline.cash)}</dd></div>
        <div><dt>Net profit after all company costs</dt><dd>{money(forecast.profit)}</dd></div>
        <div><dt>Loan principal paid</dt><dd>−{money(forecast.debtPayment)}</dd></div>
        <div className="bridge-total"><dt>Planned ending cash</dt><dd className={forecast.cashAfter < 0 ? 'neg' : ''}>{money(forecast.cashAfter)}</dd></div>
      </dl>
      {(idle > 0 || losing > 0 || forecast.cashAfter < 0) && <section className="review-attention"><h3>Before you fly</h3>
        {forecast.cashAfter < 0 && <p className="neg">This plan ends with negative cash. Review borrowing and costs.</p>}
        {idle > 0 && <p>{idle} unassigned aircraft still incur crew and ownership costs.</p>}
        {losing > 0 && <p>{losing} routes forecast a loss before fixed company costs.</p>}
      </section>}
      {forecast.operations && <OperationsSummary summary={forecast.operations} forecast />}
      {adverse?.operations && <p className="review-attention" data-testid="operations-adverse">Stress case · one additional three-day repair: {adverse.operations.cancelledTrips} cancelled round trips; {money(adverse.profit)} company profit. This is an illustration, not a prediction of the next repair.</p>}
      <p className="hint">Forecast at current fuel, demand and rival schedules. Deliveries, competitor moves and disruptions can change the result.</p>
      <div className="dialog-actions"><button onClick={onClose}>Back to planning</button><button className="end-quarter" data-testid="confirm-quarter" onClick={onConfirm}>Fly this quarter <span aria-hidden="true">→</span></button></div>
    </div>
  </Dialog>
}
