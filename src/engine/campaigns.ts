import { pairKey } from '../data/cities'
import { cashBufferFor } from './policy'
import type { GameState, RivalCampaign } from './types'

// All evidence comes from public cash, flown routes and completed quarters.
// The announced response starts next quarter, giving the player time to act.
export function chooseCampaign(state: GameState, seat: number): RivalCampaign {
  const airline = state.airlines[seat]!, last = airline.history.at(-1), previous = airline.history.at(-2)
  const losses = !!last && !!previous && last.profit < 0 && previous.profit < 0
  const clock = { fromTurn: state.turn + 1, untilTurn: state.turn + 5 }
  if (airline.cash < cashBufferFor(airline) || losses) return { ...clock, kind:'recover', city:airline.hq,
    evidence: losses ? 'Two consecutive quarters of losses.' : 'Cash is below the operating buffer.',
    response:'Pause new aircraft and slot expansion; protect the remaining network and reduce marketing.' }
  const contested = airline.routes.map(route => {
    let rivalPax=0
    for (const other of state.airlines) if (other.id !== seat && !other.bankrupt)
      for (const theirs of other.routes) if(pairKey(theirs.from,theirs.to) === pairKey(route.from,route.to)) rivalPax+=theirs.lastPax
    return { route, rivalPax, gap:rivalPax-route.lastPax }
  }).filter(r=>r.rivalPax>0).sort((a,b)=>b.gap-a.gap || a.route.id-b.route.id)
  const fight=contested[0]
  if (fight && fight.gap>0) {
    const retreat=fight.route.lastRevenue-fight.route.lastCost<0
    const kind=retreat ? 'defend' : airline.personality==='premium' ? 'premium' : 'price'
    return { ...clock, kind, city:fight.route.from,
      evidence:`${fight.route.from}–${fight.route.to}: ${fight.route.lastPax} boardings versus competitors' ${fight.rivalPax}${retreat ? '; route lost money' : ''}.`,
      response:retreat ? 'Protect the core with marketing; avoid a deeper price war.' : kind==='premium' ? 'Compete through full service at this city.' : 'Offer discount fares at this city.' }
  }
  const recentFailures=airline.routes.filter(r=>r.history.length>=4 && r.lastRevenue<r.lastCost).length
  if (recentFailures>=Math.max(2,Math.ceil(airline.routes.length/3))) return { ...clock, kind:'defend', city:airline.hq,
    evidence:`${recentFailures} established routes lost money last quarter.`, response:'Consolidate the core before increasing expansion.' }
  const kind=airline.personality==='premium' ? 'premium' : airline.personality==='fortress' ? 'defend' : 'expand'
  return {...clock,kind,city:airline.slotInterest??airline.hq,evidence:'Operating buffer intact; no losing contested market requires a response.',
    response:kind==='expand' ? 'Seek reachable markets and additional airport access.' : kind==='premium' ? 'Maintain a full-service product.' : 'Strengthen the home network.'}
}
