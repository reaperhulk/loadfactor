import { useMemo, useState } from 'react'
import { applyCommandBatchFor, type Command, type GameState } from '../engine'
import { operationsBoard } from '../engine/operationsBoard'
import { aircraftBase, crewFamily } from '../engine/operations'
import { getAircraftType } from '../data/aircraft'
import { planningEvaluator } from './forecast'
import { viewSeat } from './session'
import { mergePlanningCommands, stagePlanningCommands, usePlanningCommands } from './planningDrafts'
import { money } from './format'

export function OperationsBoard(props:{state:GameState;active?:boolean}) {
  if(!props.state.airlines[viewSeat()]!.operationsPolicy) return <section data-testid="operations-board"><h2>Aircraft availability</h2><p>This career uses the earlier operations system. Owned aircraft shows its availability and maintenance controls. The weekly calendar becomes available when an eligible career enables improved operations in Fleet policy.</p></section>
  return <WeeklyOperationsBoard {...props} />
}
function WeeklyOperationsBoard({state,active=true}:{state:GameState;active?:boolean}) {
  const seat=viewSeat(), airline=state.airlines[seat]!, draft=usePlanningCommands()
  const [aircraftId,setAircraftId]=useState(airline.fleet[0]?.id ?? 0),[week,setWeek]=useState(0),[action,setAction]=useState('check'),[base,setBase]=useState(airline.hq),[rotation,setRotation]=useState(airline.routes[0]?.id ?? 0)
  const [preview,setPreview]=useState(false)
  const ac=airline.fleet.find(a=>a.id===aircraftId)
  const command:Command=action==='check' ? {type:'plan_maintenance',aircraftId,startWeek:week} : action==='base' ? {type:'set_aircraft_base',aircraftId,city:base} : action==='reserve' ? {type:'set_reserve',aircraftId,reserve:true} : {type:'set_rotation',aircraftId,secondaryRouteId:rotation}
  const signature=JSON.stringify(preview ? mergePlanningCommands(draft,[command]) : draft)
  const result=useMemo(()=>{
    if(!active)return null
    const commands=JSON.parse(signature) as Command[], applied=applyCommandBatchFor(state,commands.map(command=>({seat,command})))
    const errors=applied.events.filter(e=>e.type==='command_rejected')
    const board=operationsBoard(errors.length ? state : applied.state,seat)
    return {...board,errors,forecast:planningEvaluator(state,seat)(commands)}
  },[state,seat,signature,active])
  const baseline=useMemo(()=>active?planningEvaluator(state,seat)(draft):null,[state,seat,draft,active])
  if(!result || !baseline) return null
  const byAircraft=new Map<number,typeof result.calendar>()
  for(const week of result.calendar){const weeks=byAircraft.get(week.aircraftId)??[];weeks.push(week);byAircraft.set(week.aircraftId,weeks)}
  return <section className="operations-board" data-testid="operations-board"><div className="page-heading"><div><span className="eyebrow">Quarter calendar</span><h2>Aircraft and cover</h2></div></div><p className="hint">Weeks show preferred flights completed, cover received and known downtime. Select an aircraft/week to try a check. Changes join your shared plan after review.</p>
    <div className="operations-board-summary"><strong>{result.summary.completedTrips}/{result.summary.scheduledTrips} trips completed</strong><span>{result.summary.coveredTrips} covered</span><span className={result.summary.cancelledTrips?'neg':'pos'}>{result.summary.cancelledTrips} cancelled</span></div>
    <div className="table-scroll calendar-scroll"><table className="fleet-calendar"><thead><tr><th>Aircraft / base</th>{Array.from({length:13},(_,i)=><th key={i}>W{i+1}</th>)}</tr></thead><tbody>{airline.fleet.map(a=><tr key={a.id}><th><button onClick={()=>{setAircraftId(a.id);setPreview(false)}}>#{a.id} {getAircraftType(a.type).name}</button><small>{aircraftBase(airline,a)} · {crewFamily(a.type)}</small></th>{(byAircraft.get(a.id)??[]).map(w=><td key={w.week}><button className={`${w.unavailableMinutes?'week-check':''} ${w.cancelled?'week-gap':''}`} aria-label={`Aircraft ${a.id} week ${w.week+1}: ${w.completed} completed, ${w.covered} covered, ${w.cancelled} cancelled`} onClick={()=>{setAircraftId(a.id);setWeek(w.week);setAction('check');setPreview(true)}}><strong>{w.completed}</strong><small>{w.unavailableMinutes ? `${Math.ceil(w.unavailableMinutes/60)}h off` : `${Math.floor(w.flightMinutes/60)}h flying`}</small>{w.covered>0 && <small>{w.covered} cover</small>}{w.cancelled>0 && <small>{w.cancelled} gaps</small>}</button></td>)}</tr>)}</tbody></table></div>
    {ac && <section className="operation-experiment"><h3>Try an operating change</h3><div className="plan-inputs"><label>Aircraft <select aria-label="Calendar aircraft" value={aircraftId} onChange={e=>{setAircraftId(Number(e.target.value));setPreview(false)}}>{airline.fleet.map(a=><option key={a.id} value={a.id}>#{a.id} {getAircraftType(a.type).name}</option>)}</select></label><label>Change <select aria-label="Operating change" value={action} onChange={e=>{setAction(e.target.value);setPreview(false)}}><option value="check">Check timing</option><option value="base">Operating base</option><option value="reserve">Standby aircraft</option><option value="rotation">Shared rotation</option></select></label>{action==='check' && <label>Starts <select aria-label="Calendar check week" value={week} onChange={e=>{setWeek(Number(e.target.value));setPreview(false)}}>{Array.from({length:13},(_,i)=><option key={i} value={i}>Week {i+1}</option>)}</select></label>}{action==='base' && <label>Base <select aria-label="Calendar base" value={base} onChange={e=>{setBase(e.target.value);setPreview(false)}}>{Object.keys(airline.slots).sort().map(c=><option key={c}>{c}</option>)}</select></label>}{action==='rotation' && <label>Secondary route <select aria-label="Calendar rotation" value={rotation} onChange={e=>{setRotation(Number(e.target.value));setPreview(false)}}>{airline.routes.filter(r=>r.id!==ac.routeId).map(r=><option key={r.id} value={r.id}>{r.from}–{r.to}</option>)}</select></label>}</div><button onClick={()=>setPreview(true)}>Preview operating change</button>{preview && <div data-testid="operations-preview"><p>Company profit {money(baseline.profit)} → {money(result.forecast.profit)} · ending cash {money(result.forecast.cashAfter)}</p><p>Cancelled trips {baseline.operations?.cancelledTrips ?? 0} → {result.summary.cancelledTrips}</p>{result.errors.map((e,i)=><p role="alert" key={i}>{e.reason}</p>)}<button disabled={!!result.errors.length} onClick={()=>{stagePlanningCommands([command]);setPreview(false)}}>Add operating change to plan</button><button onClick={()=>setPreview(false)}>Reset preview</button></div>}</section>}
    {result.gaps.length>0 && <section><h3>Why flights lack cover</h3>{result.gaps.map(r=><article key={r.routeId}><strong>{r.from}–{r.to}: {r.cancelled} round trips</strong><ul>{r.reasons.map(reason=><li key={reason}>{reason}</li>)}</ul></article>)}</section>}<p className="hint">Known checks and repairs only. Routine recovery remains automatic; the calendar does not require scheduling individual flights.</p>
  </section>
}
