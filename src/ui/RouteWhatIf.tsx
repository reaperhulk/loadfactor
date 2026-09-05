import { useMemo, useState } from 'react'
import type { GameState, Route } from '../engine'
import { forecastQuarter } from '../engine/forecast'
import { fareFor } from '../engine/market'
import { distanceKm } from '../data/cities'
import { money } from './format'
import { viewSeat } from './session'

export function FuelExposure({ state, routeId }: { state: GameState; routeId: number }) {
  const seat = viewSeat()
  const change = useMemo(() => {
    const before = forecastQuarter(state, seat).routes.find((r) => r.id === routeId)
    const after = forecastQuarter(state, seat, [], { fuelBp: Math.floor(state.world.fuelBp * 1.2) }).routes.find((r) => r.id === routeId)
    return (after?.lastCost ?? 0) - (before?.lastCost ?? 0)
  }, [state, seat, routeId])
  return <span data-testid="fuel-exposure"> · A 20% fuel-index increase changes this route's costs by {money(change)}/q, including current hedges and supply contracts.</span>
}

export function RouteWhatIf({ state, route, mode }: { state: GameState; route: Route; mode: 'fare' | 'service' | 'closure' }) {
  const [expanded, setExpanded] = useState(false)
  const seat = viewSeat()
  const rows = useMemo(() => {
    if (!expanded) return []
    return (mode === 'fare' ? [-2,-1,0,1,2] : mode === 'service' ? [1,2,3] : [0,1]).map((level) => {
      const forecast = forecastQuarter(state, seat, mode === 'fare'
        ? [{ type: 'set_fare', routeId: route.id, fareLevel: level }]
        : mode === 'service' ? [{ type: 'set_service', routeId: route.id, serviceLevel: level }]
        : level === 1 ? [{ type: 'close_route', routeId: route.id }] : [])
      const leg = forecast.routes.find((r) => r.id === route.id)
      const label = mode === 'fare' ? `$${fareFor(distanceKm(route.from, route.to), level)}`
        : mode === 'service' ? ['','Basic','Standard','Premium'][level]! : level ? 'Close route' : 'Keep route'
      return { level, label, forecast, leg }
    })
  }, [expanded, state, seat, route, mode])
  const best = rows.reduce<(typeof rows)[number] | null>((leader, row) => !leader || row.forecast.profit > leader.forecast.profit ? row : leader, null)
  return <details className="dossier-history" data-testid={`${mode}-whatif`} onToggle={(e) => setExpanded(e.currentTarget.open)}>
    <summary>What-if: {mode === 'fare' ? 'fare posture' : mode === 'service' ? 'service level' : 'close this route'}</summary>
    {expanded && <><div className="table-scroll"><table><thead><tr><th>{mode}</th><th>Pax/week</th><th>Route contribution/q</th><th>Airline profit/q</th></tr></thead><tbody>
      {rows.map(({ level, label, forecast, leg }) => <tr key={level} className={level === (mode === 'fare' ? route.fareLevel : mode === 'service' ? route.serviceLevel : 0) ? 'me' : ''}>
        <td>{label}{level === (mode === 'fare' ? route.fareLevel : mode === 'service' ? route.serviceLevel : 0) && ' (now)'}</td>
        <td>{Math.floor((leg?.lastPax ?? 0) / 13).toLocaleString('en-US')}</td><td>{money((leg?.lastRevenue ?? 0) - (leg?.lastCost ?? 0))}</td><td className={forecast.profit >= 0 ? 'pos' : 'neg'}>{money(forecast.profit)}</td>
      </tr>)}
    </tbody></table></div><p className="hint" data-testid={`${mode}-whatif-verdict`}>
      {best?.label} gives the highest company profit under current conditions. Includes connections on other routes and company costs; holds world conditions and rival schedules fixed. This is a comparison, not a promise of next quarter's result.
      {mode === 'closure' && ' Closing a feeder can reduce earnings on the rest of the network. Assigned aircraft become idle and still incur ownership costs.'}
    </p></>}
  </details>
}
