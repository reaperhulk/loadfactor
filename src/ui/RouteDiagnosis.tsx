import { useMemo, useState } from 'react'
import type { GameState, Route } from '../engine'
import { createForecastPlanner } from '../engine/forecast'
import { routeRecommendations, routeSignals } from '../engine/planning'
import { viewSeat } from './session'
import { money } from './format'

export function RouteDiagnosis({ state, route, onPreview }: { state: GameState; route: Route; onPreview: (commands: import('../engine').Command[]) => void }) {
  const [compare, setCompare] = useState(false)
  const seat = viewSeat()
  const analysis = useMemo(() => {
    const evaluate = createForecastPlanner(state, seat)
    return { signals: routeSignals(state, seat, route, evaluate),
      suggestions: compare ? routeRecommendations(state, seat, route, evaluate, [], false) : [] }
  }, [state, seat, route, compare])
  return <section className="route-diagnosis" data-testid="route-diagnosis">
    <h3>What this route needs</h3>
    {analysis.signals.slice(0, 3).map(s => <p key={s.title}><strong>{s.title}</strong><br />{s.detail}</p>)}
    <button onClick={() => setCompare(!compare)} aria-expanded={compare}>{compare ? 'Hide comparisons' : 'Compare improvements'}</button>
    {compare && <div className="decision-options" data-testid="route-recommendations">{analysis.suggestions.length ? analysis.suggestions.slice(0, 3).map(s => <article key={s.setting}><h4>{s.title}</h4><strong className="pos">+{money(s.profitDelta)}/q company profit</strong><p>{s.reason}</p><button onClick={() => onPreview(s.commands)}>Preview this change</button></article>) : <p>The current plan matches or beats the alternatives tested.</p>}<p className="hint">Comparisons hold world conditions and rival plans fixed. Frequency search tests capacity-based alternatives; it does not guarantee the best possible schedule.</p></div>}
  </section>
}
