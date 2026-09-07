import { useMemo, useState } from 'react'
import type { GameState } from '../engine'
import { createForecastPlanner } from '../engine/forecast'
import { networkRecommendations, type PlanningLocks, type RouteSetting } from '../engine/planning'
import { dispatchBatch, viewSeat } from './session'
import { usePlanningDraftNotice } from './planningDrafts'
import { money } from './format'

export function NetworkAdvisor({ state, locks, onToggle }: { state: GameState; locks: PlanningLocks; onToggle: (id: number, setting: RouteSetting) => void }) {
  const seat = viewSeat(), airline = state.airlines[seat]!
  const [run, setRun] = useState(false), [selected, setSelected] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [showAll, setShowAll] = useState(false)
  const suggestions = useMemo(() => run ? networkRecommendations(state, seat, locks) : [], [state, seat, locks, run])
  const key = (r: typeof suggestions[number]) => `${r.routeId}:${r.setting}`
  const visible = suggestions.filter(s => { const r = airline.routes.find(r => r.id === s.routeId)!; return `${r.from} ${r.to}`.toLowerCase().includes(query.toLowerCase()) })
  const commands = suggestions.filter(r => selected.includes(key(r))).flatMap(r => r.commands)
  usePlanningDraftNotice(commands.length)
  const signature = JSON.stringify(commands)
  const comparison = useMemo(() => {
    const evaluate = createForecastPlanner(state, seat)
    return { before: evaluate(), after: evaluate(JSON.parse(signature)) }
  }, [state, seat, signature])
  return <details className="network-advisor" data-testid="network-advisor">
    <summary>Network adviser · choose changes and protect your strategy</summary>
    <p className="hint">Recommendations target company profit. Keep strategic fares, service or schedules fixed with locks. Manual route controls stay available.</p>
    <details><summary>Lock route settings</summary><div className="adviser-locks">{airline.routes.map(r => <fieldset key={r.id}><legend>{r.from}–{r.to}</legend>{(['fare','service','frequency'] as const).map(setting => <label key={setting}><input type="checkbox" aria-label={`Lock ${r.from}-${r.to} ${setting}`} checked={locks[r.id]?.includes(setting) ?? false} onChange={() => { onToggle(r.id, setting); setSelected([]) }} />{setting}</label>)}</fieldset>)}</div></details>
    <button onClick={() => { setRun(true); setSelected([]) }}>Find improvements</button>
    {run && <><label>Find a route <input type="search" aria-label="Filter network recommendations" value={query} onChange={e => setQuery(e.target.value)} placeholder="Airport code…" /></label><div className="decision-options adviser-options">{visible.slice(0, showAll ? visible.length : 12).map(s => <article key={key(s)}><label><input type="checkbox" aria-label={`Select ${s.routeId} ${s.setting}`} checked={selected.includes(key(s))} onChange={() => setSelected(current => current.includes(key(s)) ? current.filter(k => k !== key(s)) : [...current, key(s)])} /><strong>{(() => { const r = airline.routes.find(r => r.id === s.routeId)!; return `${r.from}–${r.to}` })()} · {s.title}</strong></label><p className="pos">+{money(s.profitDelta)}/q company profit when applied alone</p><p>{s.reason}</p></article>)}</div>{visible.length > 12 && <button onClick={() => setShowAll(!showAll)}>{showAll ? 'Show first 12' : `Show all ${visible.length} recommendations`}</button>}{!suggestions.length && <p>No improvements found within the unlocked alternatives tested.</p>}
      <div className="adviser-total" data-testid="adviser-comparison"><strong>{commands.length} selected changes</strong><p>Combined company profit: {money(comparison.before.profit)} → {money(comparison.after.profit)}/q</p><p>Ending cash: {money(comparison.after.cashAfter)}</p><p>Connecting boardings: {comparison.before.routes.reduce((n,r)=>n+r.lastTransferPax,0).toLocaleString('en-US')} → {comparison.after.routes.reduce((n,r)=>n+r.lastTransferPax,0).toLocaleString('en-US')}</p>
      <p className="hint">Combined effects are recalculated; individual improvements may overlap. Current world and rival schedules are held fixed.</p>
      {comparison.after.profit < comparison.before.profit && <p className="neg">This combination reduces company profit. Select fewer changes or compare them individually.</p>}
      <button data-testid="apply-advice" disabled={!commands.length || !!comparison.after.errors.length || comparison.after.profit < comparison.before.profit} onClick={() => { dispatchBatch(commands); setSelected([]); setRun(false) }}>Apply selected changes</button><button disabled={!selected.length} onClick={() => setSelected([])}>Clear selection</button></div>
    </>}
  </details>
}
