import { resolveMarket } from './market'
import type { MarketTrace } from './itineraries'
import type { GameState } from './types'

export function passengerFlows(previous: GameState, seat: number) {
  const state = structuredClone(previous), markets: MarketTrace[] = []
  resolveMarket(state, [], undefined, 'forecast', markets)
  return summarizeFlows(state, seat, markets)
}

export function summarizeFlows(state:GameState, seat:number, markets:MarketTrace[]) {
  const routes = new Map(state.airlines[seat]!.routes.map(r=>[r.id,r]))
  const own = markets.flatMap(m=>m.choices.filter(c=>c.airline === seat && c.journeys>0).map(c=>({ ...c, pair:m.pair, demand:m.demand, carried:m.carried,
    competing: [...new Set(m.choices.filter(c=>c.airline!==seat && c.journeys>0).map(c=>c.airline))],
    constrained:c.routeIds.filter(id=>{const r=routes.get(id)!;return r.lastCapacity>0 && r.lastPax>=r.lastCapacity}) })))
  return { markets, own, journeys:own.reduce((n,c)=>n+c.journeys,0), boardings:own.reduce((n,c)=>n+c.journeys*c.routeIds.length,0) }
}
