import { useMemo, useState } from 'react'
import type { GameState } from '../engine'
import { getAircraftType } from '../data/aircraft'
import { getScenario } from '../data/scenarios'
import { createForecastPlanner } from '../engine/forecast'
import { expansionOptions, type ExpansionOption } from '../engine/expansion'
import { viewSeat } from './session'
import { money } from './format'

export function ExpansionPlanner({ state, onPlan, onAirport }: { state: GameState; onPlan?: (from: string, to: string, preset?: ExpansionOption) => void; onAirport?: (city: string) => void }) {
  const seat = viewSeat()
  const [searched, setSearched] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [sort, setSort] = useState<'objective' | 'profit'>('objective')
  const result = useMemo(() => searched ? expansionOptions(state, seat) : null, [state, seat, searched])
  const key = (o: ExpansionOption) => `${o.from}-${o.to}`
  const comparisons = useMemo(() => {
    if (!result) return []
    const evaluate = createForecastPlanner(state, seat)
    return result.options.filter(o => selected.includes(key(o))).map(o => ({ ...o,
      stress: evaluate([o.command], { fuelBp: Math.floor(state.world.fuelBp * 1.2), economyBp: Math.floor(state.world.economyBp * 0.9) }) }))
  }, [state, seat, result, selected])
  const objective = getScenario(state.scenario).objective
  const gain = (n: number) => objective.unit === 'money' ? money(n) : objective.unit === 'rate' ? `${(n / 100).toFixed(2)} percentage points` : `${n.toLocaleString('en-US')} boardings`
  return <section className="expansion-planner" data-testid="expansion-planner">
    <h3>Where to grow next</h3><p className="hint">Compare routes your current fleet and slots can launch. Rankings include connecting traffic, fleet costs and your scenario objective.</p>
    <button onClick={() => { setSearched(true); setSelected([]) }}>Find expansion options</button>
    {result && <><label className="expansion-sort">Rank by <select aria-label="Rank expansion options" value={sort} onChange={e => setSort(e.target.value as 'objective' | 'profit')}><option value="objective">Scenario objective</option><option value="profit">Company profit</option></select></label>
      <div className="expansion-options">{[...result.options].sort((a,b)=>sort === 'profit' ? b.profitDelta-a.profitDelta : b.objectiveDelta-a.objectiveDelta).map(o => <article data-testid={`expansion-${key(o)}`} key={key(o)}><h4>{o.from}–{o.to}</h4><p>{getAircraftType(o.aircraftType).name} #{o.aircraftId} · {o.frequency} round trips/week</p><dl className="decision-metrics"><div><dt>Company profit change/q</dt><dd className={o.profitDelta >= 0 ? 'pos' : 'neg'}>{money(o.profitDelta)}</dd></div><div><dt>Ending cash</dt><dd>{money(o.cashAfter)}</dd></div><div><dt>Objective change</dt><dd>{gain(o.objectiveDelta)}</dd></div><div><dt>Connecting boardings change</dt><dd>{o.connectionsDelta.toLocaleString('en-US')}</dd></div></dl>
        <label><input type="checkbox" aria-label={`Compare ${key(o)}`} checked={selected.includes(key(o))} disabled={!selected.includes(key(o)) && selected.length >= 3} onChange={() => setSelected(current => current.includes(key(o)) ? current.filter(k=>k!==key(o)) : [...current, key(o)])} />Compare</label>{' '}
        <button data-testid={`plan-${key(o)}`} onClick={() => onPlan?.(o.from, o.to, o)}>Review launch</button><details data-testid={`risk-${key(o)}`}><summary>Costs and risks</summary><p>Launch payment {money(o.cashRequired)}. Uses an aircraft you already hold; its continuing costs are included. Both airports have free slots.</p><ul>{o.risks.map(r=><li key={r}>{r}</li>)}</ul></details></article>)}</div>
      {!result.options.length && <p>No shortlisted launch currently has both free slots and a suitable idle aircraft. Resolve the requirements below, then compare again.</p>}
      {comparisons.length > 0 && <div className="expansion-comparison" data-testid="expansion-comparison"><h4>Compare alternatives</h4><p className="hint">Each option is a separate launch. They may use the same aircraft or slots.</p><div className="expansion-options">{comparisons.map(o=><article key={key(o)}><h4>{o.from}–{o.to}</h4><p>Profit change: {money(o.profitDelta)}/q</p><p>Launch cash: {money(o.cashRequired)}</p><p>Forecast load: {(o.loadFactorBp/100).toFixed(0)}%</p><p>Under headwinds: {money(o.stress.profit)}/q company profit; {money(o.stress.cashAfter)} ending cash.</p><p className="hint">Fuel +20%, demand index −10%.</p></article>)}</div></div>}
      {result.blocked.length > 0 && <details><summary>Markets needing aircraft or slots</summary>{result.blocked.map(p=><p key={`${p.from}-${p.to}`}><strong>{p.from}–{p.to}</strong> · {p.blockers.join(' · ')}{p.blockers.some(b=>b.startsWith('Need slots')) && <> · capacity may be available in {p.wait}q; queue position matters. <button onClick={()=>onAirport?.(p.airport)}>Review airport</button></>}</p>)}<p className="hint">These are potential markets screened by demand and costs; no feasible launch profit is quoted yet.</p></details>}
      <p className="hint">Six feasible markets are shortlisted, with up to two aircraft/cabin choices and three schedules each. Rankings compare standard fare and service at current conditions. The scenario metric is {objective.label}; monetary changes show the next quarter's earnings contribution.</p>
    </>}
  </section>
}
