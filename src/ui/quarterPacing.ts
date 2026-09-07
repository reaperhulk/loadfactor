import type { GameEvent, GameState } from '../engine'
import { pairKey } from '../data/cities'

// Quiet is conservative: every decision, disruption, big swing or first
// report still opens the complete report. No quarter advances automatically.
export function needsFullReport(state: GameState, events: GameEvent[], seat: number): boolean {
  const airline=state.airlines[seat]!, now=airline.history.at(-1), before=airline.history.at(-2)
  if (state.turn<=3 || state.phase!=='planning' || !now || !before || now.cash<0 || now.profit<0) return true
  if (Math.abs(now.profit-before.profit)>Math.max(500,Math.floor(Math.abs(before.profit)/5))) return true
  if ((now.operations?.cancelledTrips??0)>0) return true
  const pairs=new Set(airline.routes.map(r=>pairKey(r.from,r.to)))
  const cities=new Set(airline.routes.flatMap(r=>[r.from,r.to]))
  if (state.world.offers.some(o=>(o.airline??0)===seat && o.expiresTurn<=state.turn+1)) return true
  return events.some(event=>{
    if (['game_over','offer_made','offer_expired','deal_ended','world_event_started','world_event_ended','airline_bankrupt','airline_restructured','airline_entered'].includes(event.type)) return true
    if (event.type==='route_opened') return event.airline===seat || pairs.has(pairKey(event.from,event.to))
    if (event.type==='operations_changed' && event.airline!==seat) {
      const campaign=state.airlines[event.airline]?.campaign
      return !!campaign && campaign.fromTurn===state.turn && cities.has(campaign.city)
    }
    return 'airline' in event && event.airline===seat && ['aircraft_delivered','aircraft_grounded','slots_granted','milestone_reached','route_closed','command_rejected'].includes(event.type)
  })
}
