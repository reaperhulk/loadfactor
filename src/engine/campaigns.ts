import { distanceKm, pairKey } from '../data/cities'
import { getAircraftType, typesOnSale } from '../data/aircraft'
import { AI_MIN_ROUTE_KM, RAID_CASH_BUFFER_MULT_BP } from '../data/constants'
import { cashBufferFor } from './policy'
import { netWorth, networkCities, slotsFree, yearOf } from './queries'
import { slotsRemaining } from './slots'
import type { GameState, RivalCampaign } from './types'

// Rules 5: a raid takes the initiative. The rival picks the leader's most
// profitable market it can reach from its own network, names it in public a
// quarter ahead, and then queues for the missing airport and opens the pair
// at a discount. The evidence is the leader's own published route result.
export function raidTarget(state: GameState, seat: number): { pair: string; from: string; to: string; target: number; city: string; evidence: string } | null {
  const airline = state.airlines[seat]!
  if (airline.cash < Math.floor(cashBufferFor(airline) * RAID_CASH_BUFFER_MULT_BP / 10000)) return null
  let leader = null as GameState['airlines'][number] | null
  for (const other of state.airlines) {
    if (other.id === seat || other.bankrupt) continue
    if (leader === null || netWorth(other) > netWorth(leader)) leader = other
  }
  if (!leader || netWorth(leader) <= netWorth(airline)) return null
  let reach = 0
  for (const ac of airline.fleet) reach = Math.max(reach, getAircraftType(ac.type).rangeKm)
  for (const t of typesOnSale(yearOf(state))) reach = Math.max(reach, t.rangeKm)
  const served = new Set(airline.routes.map((r) => pairKey(r.from, r.to)))
  const network = networkCities(airline)
  // Markets the rival can enter today rank ahead of ones a quarter of
  // queueing away; within a tier, the leader's richest route first.
  const candidates: { route: (typeof leader.routes)[number]; missing: string | null; profit: number }[] = []
  for (const route of leader.routes) {
    if (route.lastPax === 0 || route.lastRevenue <= route.lastCost) continue
    const key = pairKey(route.from, route.to)
    if (served.has(key)) continue
    if (!network.has(route.from) && !network.has(route.to)) continue
    const km = distanceKm(route.from, route.to)
    if (km < AI_MIN_ROUTE_KM || km > reach) continue
    const missing = slotsFree(airline, route.from) < 1 ? route.from : slotsFree(airline, route.to) < 1 ? route.to : null
    if (missing !== null && (airline.slots[missing] ?? 0) > 0) continue // held but full: no room to add a route
    if (missing !== null && slotsRemaining(state, missing) <= 0) continue
    candidates.push({ route, missing, profit: route.lastRevenue - route.lastCost })
  }
  candidates.sort((a, b) => Number(a.missing !== null) - Number(b.missing !== null) || b.profit - a.profit || a.route.id - b.route.id)
  const pick = candidates[0]
  if (!pick) return null
  const { route, missing } = pick
  return { pair: pairKey(route.from, route.to), from: route.from, to: route.to, target: leader.id, city: missing ?? route.from,
    evidence: `${leader.name} earned $${pick.profit.toLocaleString('en-US')}k on ${route.from}–${route.to} last quarter with ${route.lastPax.toLocaleString('en-US')} boardings.` }
}

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
  if ((state.rulesVersion ?? 1) >= 5) {
    const raid = raidTarget(state, seat)
    if (raid) {
      const premium = airline.personality === 'premium'
      // A raid runs longer than a posture: the slot queue and a delivery both
      // have to land inside it.
      return { ...clock, untilTurn: state.turn + 9, kind: 'raid', city: raid.city, pair: raid.pair, target: raid.target, evidence: raid.evidence,
        response: `Enter ${raid.from}–${raid.to} against ${state.airlines[raid.target]!.name}${(airline.slots[raid.city] ?? 0) > 0 ? '' : `, queueing for slots at ${raid.city}`}, with ${premium ? 'a full-service product' : 'discount fares'}.` }
    }
  }
  const kind=airline.personality==='premium' ? 'premium' : airline.personality==='fortress' ? 'defend' : 'expand'
  return {...clock,kind,city:airline.slotInterest??airline.hq,evidence:'Operating buffer intact; no losing contested market requires a response.',
    response:kind==='expand' ? 'Seek reachable markets and additional airport access.' : kind==='premium' ? 'Maintain a full-service product.' : 'Strengthen the home network.'}
}
