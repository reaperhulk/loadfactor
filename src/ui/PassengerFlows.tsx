import { useMemo, useState } from 'react'
import { applyCommandBatchFor, type GameState } from '../engine'
import { passengerFlows } from '../engine/flows'
import { usePlanningCommands } from './planningDrafts'
import { viewSeat } from './session'

export interface FlowFocus { routes:number[]; label:string }
export function PassengerFlows({state,city,routeId,onHighlight}:{state:GameState;city?:string;routeId?:number;onHighlight?:(focus:FlowFocus)=>void}) {
  const seat=viewSeat(), draft=usePlanningCommands(), [open,setOpen]=useState(false)
  const result=useMemo(()=>open ? passengerFlows(draft.length ? applyCommandBatchFor(state,draft.map(command=>({seat,command}))).state : state,seat) : null,[state,seat,draft,open])
  const rows=result?.own.filter(r=>routeId!==undefined ? r.routeIds.includes(routeId) : r.via===city || r.pair.split('-').includes(city!)).sort((a,b)=>b.journeys-a.journeys) ?? []
  return <section className="passenger-flows" data-testid="passenger-flows"><button aria-expanded={open} onClick={()=>setOpen(!open)}>{open?'Hide passenger flows':'Explore passenger flows'}</button>{result && <><h3>Where your passengers travel</h3><p className="hint">Planned journeys, including your shared draft. A connection is one journey and two boardings. Current world conditions and rival schedules stay fixed.</p><dl className="decision-metrics"><div><dt>Company journeys / q</dt><dd>{result.journeys.toLocaleString('en-US')}</dd></div><div><dt>Company boardings / q</dt><dd>{result.boardings.toLocaleString('en-US')}</dd></div></dl>
    <div className="flow-list">{rows.slice(0,8).map((r,i)=><article key={`${r.pair}:${r.via}:${i}`}><strong>{r.pair.replace('-','–')}</strong><p>{r.via ? `Via ${r.via}`:'Direct'} · {r.journeys.toLocaleString('en-US')} journeys/q</p><p className="hint">Market: {r.carried.toLocaleString('en-US')} of {r.demand.toLocaleString('en-US')} potential journeys carried by all airlines. Uncarried demand also reflects fares, service and willingness to connect.</p>{r.constrained.length>0 && <p className="neg">At least one leg has no spare seats.</p>}{r.competing.length>0 && <p>Competing with {r.competing.map(id=>state.airlines[id]!.name).join(', ')}.</p>}{onHighlight && <button onClick={()=>onHighlight({routes:r.routeIds,label:`${r.pair.replace('-','–')}${r.via ? ` via ${r.via}` : ' direct'}`})}>Show journey on map</button>}</article>)}</div>{!rows.length && <p>No carried journeys use this selection under the current plan.</p>}<p className="hint">Showing the eight busiest paths for this selection.</p></>}</section>
}
