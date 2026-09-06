import type { GameState } from '../engine'
import { getAircraftType } from '../data/aircraft'
import { nextExpansion } from '../engine/slots'
import { yearOf, quarterOf } from '../engine/queries'
import { viewSeat } from './session'
import type { WorkspacePage } from './workspace'

export function DeskTimeline({ state, onTab }: { state: GameState; onTab:(page:WorkspacePage)=>void }) {
  const a=state.airlines[viewSeat()]!
  const entries:{key:string;in:number;title:string;detail:string;page:WorkspacePage}[]=[]
  for(const o of a.orders) entries.push({key:`order-${o.id}`,in:o.quartersLeft,title:`${getAircraftType(o.type).name} delivery`,detail:o.replacesAircraftId ? `Replaces aircraft #${o.replacesAircraftId}` : 'New capacity arriving',page:'orders'})
  if(a.fuelHedge) entries.push({key:'hedge',in:a.fuelHedge.quartersLeft,title:'Fuel protection ends',detail:'Review exposure before expiry',page:'finance'})
  for(const d of a.deals ?? []) entries.push({key:`deal-${d.offerId}`,in:Math.max(0,d.untilTurn-state.turn),title:d.city ? `${d.city} commitment ends` : 'Fuel contract ends',detail:'Accepted board commitment',page:'desk'})
  for(const city of new Set([...Object.keys(a.slots),...a.slotRequests.map((r)=>r.city)])) { const e=nextExpansion(state,city);if(e.quartersAway<=8) entries.push({key:`airport-${city}`,in:e.quartersAway,title:`${city} adds ${e.slots} slots`,detail:'Airport capacity programme',page:'airports'}) }
  entries.sort((x,y)=>x.in-y.in || x.key.localeCompare(y.key))
  const date=(q:number)=>{const quarter=quarterOf(state)-1+q;return `${yearOf(state)+Math.floor(quarter/4)} Q${quarter%4+1}`}
  return <ol className="desk-timeline" data-testid="desk-timeline">{entries.length ? entries.slice(0,6).map((e)=><li key={e.key}><span>{e.in===0 ? 'This quarter' : date(e.in)}</span><button className="link-btn" onClick={()=>onTab(e.page)}>{e.title}</button><small>{e.detail}</small></li>) : <li><span>No scheduled deliveries or expiries</span><button className="link-btn" onClick={()=>onTab('catalog')}>Compare future fleet options →</button></li>}</ol>
}
