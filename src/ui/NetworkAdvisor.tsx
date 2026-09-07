import { GOAL_LABELS, planningValue, resolvedGoal, type PlanningGoal } from '../engine/planningGoals'
import { usePlanningPreference } from './planningPreference'
import { useMemo, useState } from 'react'
import type { GameState } from '../engine'
import { createForecastPlanner } from '../engine/forecast'
import { networkRecommendations, type PlanningLocks, type RouteSetting } from '../engine/planning'
import { viewSeat } from './session'
import { commandKey, removePlanningCommand, stagePlanningCommands, usePlanningCommands } from './planningDrafts'
import { applyPlanningDraft } from './planActions'
import { money } from './format'

export function NetworkAdvisor({ state, locks, onToggle }: { state: GameState; locks: PlanningLocks; onToggle: (id: number, setting: RouteSetting) => void }) {
  const seat = viewSeat(), airline = state.airlines[seat]!
  const { preference, update } = usePlanningPreference(state, seat)
  const [run, setRun] = useState(false)
  const commands = usePlanningCommands()
  const [query, setQuery] = useState('')
  const [showAll, setShowAll] = useState(false)
  const suggestions = useMemo(() => run ? networkRecommendations(state, seat, locks, preference) : [], [state, seat, locks, run, preference])
  const key = (r: typeof suggestions[number]) => `${r.routeId}:${r.setting}`
  const visible = suggestions.filter(s => { const r = airline.routes.find(r => r.id === s.routeId)!; return `${r.from} ${r.to}`.toLowerCase().includes(query.toLowerCase()) })
  const selected = suggestions.filter(s => s.commands.every(c => commands.some(d => JSON.stringify(c) === JSON.stringify(d)))).map(key)
  const clearSelection = () => { for (const s of suggestions.filter(s => selected.includes(key(s)))) for (const c of s.commands) removePlanningCommand(commandKey(c)) }
  const signature = JSON.stringify(commands)
  const comparison = useMemo(() => {
    const evaluate = createForecastPlanner(state, seat)
    return { before: evaluate(), after: evaluate(JSON.parse(signature)) }
  }, [state, seat, signature])
  const goalChange = planningValue(state, seat, comparison.after, preference.goal)-planningValue(state, seat, comparison.before, preference.goal)
  const belowReserve = comparison.after.cashAfter < preference.minCash
  const gain = (n:number) => resolvedGoal(state,preference.goal) === 'profit' ? money(n) : resolvedGoal(state,preference.goal) === 'loadFactor' ? `${(n/100).toFixed(2)} percentage points` : `${n.toLocaleString('en-US')} ${resolvedGoal(state,preference.goal) === 'resilience' ? 'fewer cancelled trips' : 'boardings'}`
  return <details className="network-advisor" data-testid="network-advisor">
    <summary>Network adviser · choose changes and protect your strategy</summary>
    <p className="hint">Choose what to improve. Profit and your selected goal are shown separately; locks protect your strategy. Advice must retain the cash reserve below.</p>
    <div className="plan-inputs"><label>Priority <select aria-label="Advice priority" value={preference.goal} onChange={e=>{update({...preference,goal:e.target.value as PlanningGoal});setRun(false)}}>{Object.entries(GOAL_LABELS).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label>Minimum ending cash ($M) <input aria-label="Minimum cash reserve" type="number" min="0" step="1" value={preference.minCash/1000} onChange={e=>update({...preference,minCash:Math.max(0,Number(e.target.value)||0)*1000})} /></label></div>
    <details><summary>Lock route settings</summary><div className="adviser-locks">{airline.routes.map(r => <fieldset key={r.id}><legend>{r.from}–{r.to}</legend>{(['fare','service','frequency'] as const).map(setting => <label key={setting}><input type="checkbox" aria-label={`Lock ${r.from}-${r.to} ${setting}`} checked={locks[r.id]?.includes(setting) ?? false} onChange={() => { onToggle(r.id, setting) }} />{setting}</label>)}</fieldset>)}</div></details>
    <button onClick={() => { setRun(true) }}>Find improvements</button>
    {run && <><label>Find a route <input type="search" aria-label="Filter network recommendations" value={query} onChange={e => setQuery(e.target.value)} placeholder="Airport code…" /></label><div className="decision-options adviser-options">{visible.slice(0, showAll ? visible.length : 12).map(s => <article key={key(s)}><label><input type="checkbox" aria-label={`Select ${s.routeId} ${s.setting}`} checked={selected.includes(key(s))} onChange={() => selected.includes(key(s)) ? s.commands.forEach(c => removePlanningCommand(commandKey(c))) : stagePlanningCommands(s.commands)} /><strong>{(() => { const r = airline.routes.find(r => r.id === s.routeId)!; return `${r.from}–${r.to}` })()} · {s.title}</strong></label><p className={s.profitDelta>=0 ? 'pos' : 'neg'}>{s.profitDelta>0 ? '+' : ''}{money(s.profitDelta)}/q company profit when applied alone</p><p>{GOAL_LABELS[preference.goal]}: +{gain(s.goalDelta ?? s.profitDelta)}</p><p>{s.reason}</p></article>)}</div>{visible.length > 12 && <button onClick={() => setShowAll(!showAll)}>{showAll ? 'Show first 12' : `Show all ${visible.length} recommendations`}</button>}{!suggestions.length && <p>No improvements found within the unlocked alternatives tested.</p>}
      <div className="adviser-total" data-testid="adviser-comparison"><strong>{commands.length} selected changes</strong><p>Combined company profit: {money(comparison.before.profit)} → {money(comparison.after.profit)}/q</p><p>Ending cash: {money(comparison.after.cashAfter)}</p><p>Connecting boardings: {comparison.before.routes.reduce((n,r)=>n+r.lastTransferPax,0).toLocaleString('en-US')} → {comparison.after.routes.reduce((n,r)=>n+r.lastTransferPax,0).toLocaleString('en-US')}</p>
      <p className="hint">Combined effects are recalculated; individual improvements may overlap. Current world and rival schedules are held fixed.</p>
      <p>{GOAL_LABELS[preference.goal]}: {gain(goalChange)} improvement.</p>{(goalChange < 0 || belowReserve) && <p className="neg">This combination misses the selected goal or cash reserve. Select fewer changes or compare individually.</p>}
      <button data-testid="apply-advice" disabled={!commands.length || !!comparison.after.errors.length || goalChange < 0 || belowReserve} onClick={() => { applyPlanningDraft(); setRun(false) }}>Apply selected changes</button><button disabled={!selected.length} onClick={clearSelection}>Clear selection</button></div>
    </>}
  </details>
}
