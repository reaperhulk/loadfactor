import { lazy, Suspense, useMemo, useState } from 'react'
import type { Command, GameState, Route } from '../engine'
import { distanceKm } from '../data/cities'
import { forecastQuarter } from '../engine/forecast'
import { fareFor } from '../engine/market'
import { effectiveFrequency, maxRouteFrequency } from '../engine/queries'
import { dispatchBatch, viewSeat } from './session'
import { planningForecast } from './forecast'
import { usePlanningDraftNotice } from './planningDrafts'
import { money } from './format'

const RouteDiagnosis = lazy(() => import('./RouteDiagnosis').then(m => ({ default: m.RouteDiagnosis })))

export function RoutePlanner({ state, route }: { state: GameState; route: Route }) {
  const seat = viewSeat(), airline = state.airlines[seat]!
  const [fare, setFare] = useState(route.fareLevel)
  const [service, setService] = useState(route.serviceLevel)
  const [frequency, setFrequency] = useState(route.frequency)
  const before = planningForecast(state, seat)
  const { commands, after } = useMemo(() => {
    const commands: Command[] = []
    if (fare !== route.fareLevel) commands.push({ type: 'set_fare', routeId: route.id, fareLevel: fare })
    if (service !== route.serviceLevel) commands.push({ type: 'set_service', routeId: route.id, serviceLevel: service })
    if (frequency !== route.frequency) commands.push({ type: 'set_frequency', routeId: route.id, frequency })
    return { commands, after: commands.length ? forecastQuarter(state, seat, commands) : before }
  }, [state, seat, route, fare, service, frequency, before])
  usePlanningDraftNotice(commands.length)
  const prior = before.routes.find((r) => r.id === route.id)!, projected = after.routes.find((r) => r.id === route.id)!
  const change = after.profit - before.profit
  const km = distanceKm(route.from, route.to)
  return <section className="route-planner" data-testid="route-planner">
    <h3>Plan the next quarter</h3>
    <div className="route-plan-fields">
      <label>Fare / passenger<select aria-label="Route fare" value={fare} onChange={(e) => setFare(Number(e.target.value))}>{[-2,-1,0,1,2].map((v) => <option key={v} value={v}>${fareFor(km, v)} · {['Deep discount','Discount','Standard','Premium','Top fare'][v+2]}</option>)}</select></label>
      <label>Service<select aria-label="Route service" value={service} onChange={(e) => setService(Number(e.target.value))}>{[1,2,3].map((v) => <option key={v} value={v}>{['','Basic','Standard','Premium'][v]}</option>)}</select></label>
      <label>Round trips / week<input type="number" inputMode="numeric" aria-label="Route frequency" min="1" max={maxRouteFrequency(airline, route, state.turn)} value={frequency} onChange={(e) => setFrequency(Number(e.target.value))} /></label>
    </div>
    <p className="hint" data-testid="dossier-frequency">Current schedule: {effectiveFrequency(airline, route, state.turn)}/{maxRouteFrequency(airline, route, state.turn)} rt/wk available.</p>
    <div className="entity-forecast" data-testid="route-plan-forecast" aria-live="polite">
      <span className="eyebrow">Next-quarter forecast</span>
      <dl className="forecast-values">
        <div><dt>Route contribution</dt><dd>{commands.length > 0 && <span className="forecast-before">{money(prior.lastRevenue-prior.lastCost)} → </span>}<strong className={projected.lastRevenue >= projected.lastCost ? 'pos' : 'neg'}>{money(projected.lastRevenue-projected.lastCost)}</strong></dd></div>
        <div><dt>Load factor</dt><dd>{(projected.lastLoadFactorBp/100).toFixed(0)}%</dd></div>
        <div><dt>Company net profit</dt><dd>{money(after.profit)}</dd></div>
        <div><dt>Change in company profit</dt><dd className={change >= 0 ? 'pos' : 'neg'}>{change > 0 ? '+' : ''}{money(change)}</dd></div>
        <div><dt>Ending cash</dt><dd>{money(after.cashAfter)}</dd></div>
      </dl>
    </div>
    {after.errors.length > 0 && <p role="alert" className="neg">{after.errors.map((e) => e.reason).join(' · ')}</p>}
    <div className="entity-plan-actions"><button className="primary-action" data-testid="apply-route-plan" disabled={!commands.length || after.errors.length > 0} onClick={(e) => {
      const inspector = e.currentTarget.closest('.route-dossier')
      dispatchBatch(commands)
      requestAnimationFrame(() => inspector?.querySelector<HTMLSelectElement>('[aria-label="Route fare"]')?.focus({ preventScroll:true }))
    }}>Apply route changes</button><button disabled={!commands.length} onClick={() => { setFare(route.fareLevel); setService(route.serviceLevel); setFrequency(route.frequency) }}>Reset</button></div>
    <Suspense fallback={<p role="status">Loading route analysis…</p>}><RouteDiagnosis state={state} route={route} onPreview={(changes) => {
      setFare(route.fareLevel); setService(route.serviceLevel); setFrequency(route.frequency)
      for (const c of changes) {
        if (c.type === 'set_fare') setFare(c.fareLevel)
        if (c.type === 'set_service') setService(c.serviceLevel)
        if (c.type === 'set_frequency') setFrequency(c.frequency)
      }
    }} /></Suspense>
    <p className="hint">Includes connections and fixed company costs. Fuel, demand and rival schedules held at current conditions. Apply is one undoable action.</p>
  </section>
}
