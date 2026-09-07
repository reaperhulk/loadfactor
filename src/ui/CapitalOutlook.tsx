import { useMemo, useState } from 'react'
import type { Command, GameState } from '../engine'
import { typesOnSale, getAircraftType } from '../data/aircraft'
import { capitalOutlook } from '../engine/outlook'
import { yearOf } from '../engine/queries'
import { viewSeat } from './session'
import { mergePlanningCommands, stagePlanningCommands, usePlanningCommands } from './planningDrafts'
import { money } from './format'

export function CapitalOutlook({ state, active=true }: { state: GameState; active?:boolean }) {
  const seat = viewSeat(), airline = state.airlines[seat]!, draft = usePlanningCommands()
  const [quarters, setQuarters] = useState(4), [type, setType] = useState(typesOnSale(yearOf(state))[0]?.id ?? '')
  const [replaces, setReplaces] = useState<number | null>(airline.fleet[0]?.id ?? null), [finance, setFinance] = useState(false)
  const [compare, setCompare] = useState(false)
  const spec = type ? getAircraftType(type) : undefined
  const options = useMemo(() => {
    if(!active) return []
    const choices: { name:string; commands:Command[] }[] = [{name:'Keep current plan',commands:[]}]
    if (compare && spec) for (const leased of [false,true]) {
      const commands: Command[] = []
      const cost = leased ? 0 : spec.price
      if (finance && cost > airline.cash) commands.push({type:'take_loan',amount:cost-airline.cash})
      commands.push(replaces !== null ? {type:'order_replacement',aircraftId:replaces,aircraftType:type,leased}
        : leased ? {type:'lease_aircraft',aircraftType:type} : {type:'order_aircraft',aircraftType:type})
      choices.push({name:leased ? 'Lease' : 'Buy',commands})
    }
    return choices.map(c=>({ ...c, baseline:capitalOutlook(state,seat,mergePlanningCommands(draft,c.commands),quarters), stress:capitalOutlook(state,seat,mergePlanningCommands(draft,c.commands),quarters,true) }))
  }, [state,seat,draft,quarters,compare,spec,type,replaces,finance,airline.cash,active])
  const date = (turn:number) => `${getScenarioYear(state)+Math.floor(turn/4)} Q${turn%4+1}`
  return <section className="capital-outlook" data-testid="capital-outlook"><div className="page-heading"><div><span className="eyebrow">Commitments and cash</span><h2>Capital outlook</h2></div><label>Horizon <select aria-label="Outlook horizon" value={quarters} onChange={e=>setQuarters(Number(e.target.value))}><option value={4}>4 quarters</option><option value={8}>8 quarters</option></select></label></div>
    <p className="hint">Includes your shared plan, delivery dates, replacement sales, route ramp-up, seasonality, scheduled checks, loan payments and contract expiry. Current rival schedules and base world indices stay fixed. Known events expire; new shocks and repairs are not predicted.</p>
    <details><summary>Compare buying, leasing or waiting</summary><div className="plan-inputs"><label>Aircraft type <select aria-label="Outlook aircraft type" value={type} onChange={e=>{setType(e.target.value);setCompare(false)}}>{typesOnSale(yearOf(state)).map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label><label>Purpose <select aria-label="Outlook replacement" value={replaces ?? ''} onChange={e=>{setReplaces(e.target.value ? Number(e.target.value) : null);setCompare(false)}}><option value="">Additional capacity</option>{airline.fleet.map(a=><option key={a.id} value={a.id}>Replace #{a.id} · {getAircraftType(a.type).name}</option>)}</select></label><label><input type="checkbox" checked={finance} onChange={e=>setFinance(e.target.checked)} />Borrow purchase shortfall</label></div><p className="hint">Replacement aircraft inherit existing routes on delivery. Additional aircraft remain idle until assigned; this comparison includes their standing costs.</p><button onClick={()=>setCompare(true)}>Compare capital options</button></details>
    <div className="capital-options">{options.map(o=><article key={o.name}><h3>{o.name}</h3>{o.baseline.errors.length ? <p role="status">{o.baseline.errors.map(e=>e.reason).join(' · ')}</p> : <><dl className="decision-metrics"><div><dt>Lowest cash</dt><dd className={o.baseline.minCash<0?'neg':''}>{money(o.baseline.minCash)}</dd><small>{date(o.baseline.minTurn)}</small></div><div><dt>Ending cash</dt><dd>{money(o.baseline.cashAfter)}</dd></div><div><dt>Lowest cash under headwinds</dt><dd className={o.stress.minCash<0?'neg':''}>{money(o.stress.minCash)}</dd></div><div><dt>Headwind ending cash</dt><dd>{money(o.stress.cashAfter)}</dd></div></dl><div className="table-scroll"><table><thead><tr><th>Quarter</th><th>Profit</th><th>Cash</th><th>Due / arriving</th></tr></thead><tbody>{o.baseline.rows.map(r=><tr key={r.stats.turn} className={r.stats.turn===o.baseline.minTurn?'cash-low':''}><td>{date(r.stats.turn)}</td><td>{money(r.stats.profit)}</td><td>{money(r.stats.cash)}</td><td>{r.deliveries ? `${r.deliveries} deliveries · ` : ''}{r.stats.operations?.checkCost ? `Checks ${money(r.stats.operations.checkCost)} · ` : ''}{r.slots ? `${r.slots} slot grants · ` : ''}{r.stats.debtPayment ? `Debt payment ${money(r.stats.debtPayment)} · ` : ''}{r.endedContracts ? `${r.endedContracts} contracts end · ` : ''}{r.hedgeExpires ? 'Fuel hedge expires' : ''}</td></tr>)}</tbody></table></div>{o.commands.length>0 && <button onClick={()=>{stagePlanningCommands(o.commands);setCompare(false)}}>Add {o.name.toLowerCase()} to plan</button>}</>}</article>)}</div><p className="hint">Headwinds: fuel +20%, demand index −10%. These are conditional scenarios, not probabilities. Outlook stops at insolvency or the career deadline.</p>
  </section>
}
function getScenarioYear(state:GameState) { return yearOf(state)-Math.floor(state.turn/4) }
