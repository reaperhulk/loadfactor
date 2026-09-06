import type { OperationsSummary as Summary, Route } from '../engine/types'
import { money } from './format'

export function OperationsSummary({ summary, forecast = false, routes = [] }: { summary: Summary; forecast?: boolean; routes?: Pick<Route, 'id' | 'from' | 'to'>[] }) {
  const affected = summary.routes.filter(r => r.covered > 0 || r.cancelled > 0 || r.unservedSeats > 0)
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
      {affected.length > 0 && <details className="operations-route-detail" data-testid="operations-route-detail">
        <summary>{affected.length} routes with cover or disruption</summary>
        <div className="table-scroll"><table><thead><tr><th>Route</th><th>Completed</th><th>Covered</th><th>Cancelled</th></tr></thead><tbody>{affected.map(r => {
          const route = routes.find(route => route.id === r.routeId)
          return <tr key={r.routeId}><td>{route ? `${route.from}–${route.to}` : `Route #${r.routeId}`}</td><td>{r.completed}/{r.scheduled}</td><td>{r.covered}</td><td className={r.cancelled ? 'neg' : ''}>{r.cancelled}</td></tr>
        })}</tbody></table></div>
        <p className="dim">Counts are round trips. Covered flights are included in completed flights.</p>
      </details>}
      {summary.affectedPassengers > 0 && (
        <p className="dim">
          About {summary.affectedPassengers.toLocaleString('en-US')} passengers affected by cancellations or
          reduced seats; separate from passengers carried.
        </p>
      )}
    </section>
  )
}
