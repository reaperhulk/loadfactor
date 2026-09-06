import type { OperationsSummary as Summary } from '../engine/types'
import { money } from './format'

export function OperationsSummary({ summary, forecast = false }: { summary: Summary; forecast?: boolean }) {
  return (
    <section className="operations-summary" data-testid="operations-summary">
      <h3>{forecast ? 'Planned operations' : 'Operations this quarter'}</h3>
      <dl className="operations-metrics">
        <div>
          <dt>Round trips completed</dt>
          <dd>
            {summary.completedTrips.toLocaleString('en-US')}{' '}
            <small>/ {summary.scheduledTrips.toLocaleString('en-US')}</small>
          </dd>
        </div>
        <div>
          <dt>Covered by other aircraft</dt>
          <dd>
            {summary.coveredTrips.toLocaleString('en-US')}{' '}
            <small>({summary.charterTrips} paid recovery)</small>
          </dd>
        </div>
        <div>
          <dt>Cancelled round trips</dt>
          <dd className={summary.cancelledTrips ? 'neg' : 'pos'}>
            {summary.cancelledTrips.toLocaleString('en-US')}
          </dd>
        </div>
        <div>
          <dt>Fleet availability</dt>
          <dd>{(summary.availabilityBp / 100).toFixed(1)}%</dd>
        </div>
      </dl>
      <p className="dim">
        Repairs {money(summary.repairCost)} · checks {money(summary.checkCost)} · recovery{' '}
        {money(summary.recoveryCost)}. Included in company costs.
      </p>
      {summary.affectedPassengers > 0 && (
        <p className="dim">
          About {summary.affectedPassengers.toLocaleString('en-US')} passengers affected by cancellations or
          reduced seats; separate from passengers carried.
        </p>
      )}
    </section>
  )
}
