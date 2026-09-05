import { useMemo, useState } from 'react'
import type { Command, GameState } from '../engine'
import { forecastQuarter } from '../engine/forecast'
import { maxRouteFrequency } from '../engine/queries'
import { dispatchBatch, viewSeat } from './session'
import { money } from './format'

export function PlanningWorkbench({ state, suggestions }: { state: GameState; suggestions: Command[] }) {
  const seat = viewSeat(), airline = state.airlines[seat]!
  const [routeId, setRouteId] = useState(airline.routes[0]?.id ?? 0)
  const [fare, setFare] = useState(airline.routes[0]?.fareLevel ?? 0)
  const [service, setService] = useState(airline.routes[0]?.serviceLevel ?? 2)
  const [frequency, setFrequency] = useState(airline.routes[0]?.frequency ?? 1)
  const [draft, setDraft] = useState<Command[]>([])
  const [stress, setStress] = useState(false)
  const route = airline.routes.find((r) => r.id === routeId) ?? airline.routes[0]
  const forecast = useMemo(() => {
    const before = forecastQuarter(state, seat)
    const after = draft.length ? forecastQuarter(state, seat, draft) : before
    const headwind = stress ? forecastQuarter(state, seat, draft, { fuelBp: Math.floor(state.world.fuelBp * 1.2), economyBp: Math.floor(state.world.economyBp * 0.9) }) : null
    return { before, after, headwind }
  }, [state, seat, draft, stress])
  if (!route) return null
  return <details className="planning-workbench" data-testid="planning-workbench">
    <summary>Planning workbench · compare changes before committing</summary>
    <p className="dim">Stage several fare, service and schedule changes. Compare company profit and cash together; commit them as one reversible action.</p>
    <div className="plan-inputs">
      <label>Route <select aria-label="plan route" value={route.id} onChange={(e) => {
        const r = airline.routes.find((r) => r.id === Number(e.target.value))!
        setRouteId(r.id); setFare(r.fareLevel); setService(r.serviceLevel); setFrequency(r.frequency)
      }}>{airline.routes.map((r) => <option key={r.id} value={r.id}>{r.from}–{r.to}</option>)}</select></label>
      <label>Fare <select aria-label="plan fare" value={fare} onChange={(e) => setFare(Number(e.target.value))}>{[-2,-1,0,1,2].map((v) => <option key={v} value={v}>{['Deep discount','Discount','Standard','Premium','Top fare'][v+2]}</option>)}</select></label>
      <label>Service <select aria-label="plan service" value={service} onChange={(e) => setService(Number(e.target.value))}><option value="1">Basic</option><option value="2">Standard</option><option value="3">Premium</option></select></label>
      <label>Round trips/week <input aria-label="plan frequency" type="number" min="1" max={maxRouteFrequency(airline, route, state.turn)} value={frequency} onChange={(e) => setFrequency(Number(e.target.value))} /></label>
    </div>
    <button onClick={() => setDraft((current) => [...current.filter((c) => !('routeId' in c && c.routeId === route.id)), { type: 'set_fare', routeId: route.id, fareLevel: fare }, { type: 'set_service', routeId: route.id, serviceLevel: service }, { type: 'set_frequency', routeId: route.id, frequency }])}>Stage this route</button>{' '}
    <button disabled={suggestions.length === 0} onClick={() => setDraft(suggestions)}>Preview recommended schedules</button>
    {draft.length > 0 && <ul className="staged-changes">{draft.map((c, i) => <li key={i}>{'routeId' in c ? (() => { const r = airline.routes.find((r) => r.id === c.routeId); return r ? `${r.from}–${r.to}: ` : '' })() : ''}{c.type === 'set_fare' ? `fare ${c.fareLevel}` : c.type === 'set_service' ? `service ${c.serviceLevel}` : c.type === 'set_frequency' ? `${c.frequency} round trips/week` : c.type}</li>)}</ul>}
    <div className="table-scroll"><table className="forecast-comparison" data-testid="plan-comparison"><thead><tr><th>Planned quarter</th><th>Current plan</th><th>With changes</th>{stress && <th>Headwind</th>}</tr></thead><tbody>
      <tr><th>Airline net profit</th><td>{money(forecast.before.profit)}</td><td className={forecast.after.profit >= 0 ? 'pos' : 'neg'}>{money(forecast.after.profit)}</td>{stress && <td>{money(forecast.headwind!.profit)}</td>}</tr>
      <tr><th>Cash after quarter</th><td>{money(forecast.before.cashAfter)}</td><td>{money(forecast.after.cashAfter)}</td>{stress && <td>{money(forecast.headwind!.cashAfter)}</td>}</tr>
      <tr><th>Change in profit</th><td>—</td><td>{money(forecast.after.profit - forecast.before.profit)}</td>{stress && <td>{money(forecast.headwind!.profit - forecast.before.profit)}</td>}</tr>
    </tbody></table></div>
    <label><input type="checkbox" checked={stress} onChange={(e) => setStress(e.target.checked)} /> Stress test: fuel +20%, demand index −10%</label>
    <p className="dim">Current world and rival schedules held fixed. Includes connecting traffic, fleet costs and loan payments; future deliveries, competitor moves and random disruptions can change the result.</p>
    {forecast.after.errors.length > 0 && <p role="alert" className="neg">{forecast.after.errors.map((e) => e.reason).join(' · ')}</p>}
    <button data-testid="commit-plan" disabled={draft.length === 0 || forecast.after.errors.length > 0} onClick={() => { dispatchBatch(draft); setDraft([]) }}>Commit plan</button>{' '}
    <button disabled={draft.length === 0} onClick={() => setDraft([])}>Discard draft</button>
  </details>
}
