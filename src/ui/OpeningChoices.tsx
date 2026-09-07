import { useMemo } from 'react'
import type { Command, GameState } from '../engine'
import { planEvaluator } from './planActions'
import { mergePlanningCommands, stagePlanningCommands, usePlanningCommands } from './planningDrafts'
import { viewSeat } from './session'
import { money } from './format'

export function OpeningChoices({state}:{state:GameState}) {
  const seat=viewSeat(), draft=usePlanningCommands(), route=state.airlines[seat]!.routes[0]
  const choices=useMemo(()=>{
    if (!route || state.turn!==1) return []
    const evaluate=planEvaluator(state,seat)
    return [{name:'Fill more seats',fare:Math.max(-2,route.fareLevel-1)}, {name:'Test a higher fare',fare:Math.min(2,route.fareLevel+1)}].map(c=>{
      const commands:Command[]=[{type:'set_fare',routeId:route.id,fareLevel:c.fare}]
      return {...c,commands,quote:evaluate(mergePlanningCommands(draft,commands))}
    }).filter(c=>!c.quote.errors.length)
  },[state,seat,draft,route])
  if(!choices.length || !route) return null
  return <section className="opening-choices" data-testid="opening-choices"><h3>Try a decision on {route.from}–{route.to}</h3><p>Compare the same network with two fare choices. Stage one, review the whole plan, and compare its result after flying.</p><div className="brief-grid">{choices.map(c=><article key={c.name}><strong>{c.name}</strong><dl className="decision-metrics"><div><dt>Company profit / q</dt><dd>{money(c.quote.profit)}</dd></div><div><dt>Ending cash</dt><dd>{money(c.quote.cashAfter)}</dd></div><div><dt>Boardings / q</dt><dd>{c.quote.routes.reduce((n,r)=>n+r.lastPax,0).toLocaleString('en-US')}</dd></div></dl><button onClick={()=>stagePlanningCommands(c.commands)}>Try: {c.name.toLowerCase()}</button></article>)}</div><p className="hint">Keeping your current fare is also a choice. Forecasts hold current world conditions and rival plans fixed.</p></section>
}
