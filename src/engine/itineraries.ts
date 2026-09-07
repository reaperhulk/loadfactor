// Rules 2: one shared origin/destination pool, split into three passenger
// segments. Direct flights and every viable one-stop compete in that pool.
// Allocation conserves passengers and consumes a seat on every flown leg.
import { distanceKm, getCity, pairKey } from '../data/cities'
import { CONNECT_DETOUR_MAX_BP, CONNECT_FARE_DISCOUNT_BP, SERVICE_COST_PER_PAX, TRANSFER_HANDLING_PER_PAX } from '../data/constants'
import { getScenario } from '../data/scenarios'
import { fareFor, inflationBp, pairWeeklyDemand, routeSpoolBp, type RouteAcc } from './market'
import { reputationAppealBp } from './queries'
import { dealAppealBp } from './offers'
import type { GameState } from './types'

export const SEGMENTS = ['business', 'leisure', 'budget'] as const
export type PassengerSegment = typeof SEGMENTS[number]
export function segmentMix(from: string, to: string): Record<PassengerSegment, number> {
  const a = getCity(from), b = getCity(to)
  const business = Math.min(4500, 1400 + (a.biz + b.biz) * 100)
  const leisure = Math.min(4200, 2000 + (a.tour + b.tour) * 70)
  return { business, leisure, budget: 10000 - business - leisure }
}
interface Itinerary { legs: RouteAcc[]; airline: number; fare: number; km: number; trips: number }
export interface MarketAudit { pair: string; demand: number; carried: number; connecting: number }
export interface MarketTrace extends MarketAudit {
  choices: { airline: number; routeIds: number[]; via: string | null; journeys: number }[]
}

interface PathIndex { one:number; two?:number; airline:number; km:number }
interface MarketIndex { key:string; from:string; to:string; directKm:number; mix:ReturnType<typeof segmentMix>; paths:PathIndex[] }
function indexMarkets(legs:RouteAcc[]): MarketIndex[] {
  const markets=new Map<string,PathIndex[]>(), hubs=new Map<number,Map<string,number[]>>()
  const add=(from:string,to:string,path:PathIndex)=>{
    const key=pairKey(from,to), paths=markets.get(key)??[]; paths.push(path); markets.set(key,paths)
  }
  // Construct adjacency in one pass rather than filtering all legs for each
  // airline. Zero-capacity legs stay in the index, then filter at resolution.
  for(let i=0;i<legs.length;i++) {
    const leg=legs[i]!
    add(leg.route.from,leg.route.to,{one:i,airline:leg.airlineIdx,km:leg.km})
    const cities=hubs.get(leg.airlineIdx)??new Map<string,number[]>()
    for(const city of [leg.route.from,leg.route.to]) {const list=cities.get(city)??[];list.push(i);cities.set(city,list)}
    hubs.set(leg.airlineIdx,cities)
  }
  for(const airline of [...hubs.keys()].sort((a,b)=>a-b)) {
    const cities=hubs.get(airline)!
    for(const hub of [...cities.keys()].sort()) {
      const spokes=cities.get(hub)!
      for(let i=0;i<spokes.length;i++) for(let j=i+1;j<spokes.length;j++) {
        const one=legs[spokes[i]!]!,two=legs[spokes[j]!]!
        const from=one.route.from===hub?one.route.to:one.route.from, to=two.route.from===hub?two.route.to:two.route.from
        const km=one.km+two.km
        if(km*10000>distanceKm(from,to)*CONNECT_DETOUR_MAX_BP) continue
        add(from,to,{one:spokes[i]!,two:spokes[j]!,airline,km})
      }
    }
  }
  return [...markets.keys()].sort().map(key=>{
    const [from,to]=key.split('-') as [string,string]
    return {key,from,to,directKm:distanceKm(from,to),mix:segmentMix(from,to),paths:markets.get(key)!}
  })
}

// Bounded to a comparison session: schedules, fares and service reuse the
// network graph. Changed endpoints, airline ownership or leg order invalidate.
export function createItineraryPlanner() {
  const cache=new Map<string,MarketIndex[]>()
  return (legs:RouteAcc[])=>{
    const key=legs.map(l=>`${l.airlineIdx}:${l.route.id}:${l.route.from}:${l.route.to}`).join('|')
    let index=cache.get(key)
    if(!index) {index=indexMarkets(legs);if(cache.size>=16)cache.delete(cache.keys().next().value!);cache.set(key,index)}
    return index
  }
}

// Optional traces prove conservation without storing an unbounded O/D matrix.
export function resolveItineraries(state: GameState, legs: RouteAcc[], periodWeeks = 1, trace?: MarketTrace[], planner?:ReturnType<typeof createItineraryPlanner>): MarketAudit[] {
  const markets=planner ? planner(legs) : indexMarkets(legs)
  const fares=legs.map(leg=>Math.floor(fareFor(leg.km,leg.route.fareLevel)*leg.yieldBp/10000))
  const spool=legs.map(leg=>routeSpoolBp(state.airlines[leg.airlineIdx]!,leg.route,state.turn))
  for(const leg of legs) {leg.segments={business:0,leisure:0,budget:0};leg.transferRevenue=0}
  const audit: MarketAudit[] = []
  const infl = inflationBp(state.turn)
  const rules = getScenario(state.scenario).rules
  for (const market of markets) {
    const {key,from,to,directKm,mix}=market
    const choices:Itinerary[]=[], spools:number[]=[]
    for(const path of market.paths) {
      const one=legs[path.one]!,two=path.two===undefined?undefined:legs[path.two]!
      if(one.weeklyCapacity<=0 || (two && two.weeklyCapacity<=0)) continue
      choices.push({legs:two?[one,two]:[one],airline:path.airline,km:path.km,
        trips:two?Math.min(one.weeklyTrips,two.weeklyTrips):one.weeklyTrips,
        fare:two?Math.floor((fares[path.one]!+fares[path.two!]!)*CONNECT_FARE_DISCOUNT_BP/10000):fares[path.one]!})
      spools.push(two?Math.min(spool[path.one]!,spool[path.two!]!):spool[path.one]!)
    }
    if(!choices.length) continue
    const journeys = trace ? Array<number>(choices.length).fill(0) : undefined
    const demand = pairWeeklyDemand(state, from, to) * periodWeeks
    const directFare = fareFor(directKm, 0)
    // Segment-independent attributes are evaluated once per itinerary.
    const attributes = choices.map((it,index) => {
      const airline = state.airlines[it.airline]!
      return {
        service: it.legs[1] ? Math.min(it.legs[0]!.route.serviceLevel,it.legs[1].route.serviceLevel) : it.legs[0]!.route.serviceLevel,
        cabin: Math.floor(it.legs.reduce((sum, l) => sum + l.yieldBp, 0) / it.legs.length),
        priceAppeal: Math.max(1200, 21000 - Math.min(24000, Math.floor(it.fare * 10000 / Math.max(1, directFare)))),
        frequency: Math.floor(it.trips / periodWeeks),
        spool: spools[index]!,
        reputation: reputationAppealBp(airline), deal: dealAppealBp(state, airline.id, from, to),
      }
    })
    const cheapest = Math.min(...choices.map(it => it.fare))
    const purchaseRatio = Math.floor(cheapest * 10000 / Math.max(1, directFare))
    const attachBp = Math.max(...attributes.map(a => a.spool))
    const bankBonus = choices.some(it => it.legs.length === 2 && state.airlines[it.airline]!.hubMode === 'banked') ? 1000 : 0
    let carried = 0, connecting = 0, apportioned = 0
    for (const segment of SEGMENTS) {
      const population = segment === 'budget' ? demand - apportioned : Math.floor(demand * mix[segment] / 10000)
      apportioned += population
      const weights = choices.map((it, index) => {
        const airline = state.airlines[it.airline]!
        const { service, cabin, priceAppeal, frequency, spool, reputation, deal } = attributes[index]!
        let weight = segment === 'business'
          ? Math.max(1, frequency) * (6500 + service * 1700) * cabin / 10000
          : (6 + Math.min(24, frequency)) * (segment === 'budget' ? priceAppeal * priceAppeal / 10000 : priceAppeal)
        if (it.legs.length === 2) {
          const banked = airline.hubMode === 'banked'
          const base = segment === 'business' ? 2000 : segment === 'leisure' ? 4500 : 6500
          weight *= (base + (banked ? 1500 : 0)) / 10000
          weight *= directKm / it.km
          // A connection depends on two reliable flights. Tight banks amplify
          // the commercial impact of a damaged operational reputation.
          if (banked) weight *= reputation / 10000
          if (airline.controller === 'player') weight *= (rules.connectionDemandBp ?? 10000) / 10000
        }
        if (segment === 'budget' && it.fare < directFare) weight *= (rules.discountDemandBp ?? 10000) / 10000
        weight *= reputation * (10000 + airline.marketing * 900) / 100_000_000
        weight *= spool / 10000
        weight *= deal / 10000
        if ((state.rulesVersion ?? 1) >= 4) weight *= (airline.customerPreference?.[segment] ?? 10000) / 10000
        return Math.max(1, Math.floor(weight))
      })
      // Expensive offers lose shoppers to the outside option. Connections
      // alone attract a limited market; adding more airlines cannot duplicate it.
      const elasticity = segment === 'business' ? 3000 : segment === 'leisure' ? 6500 : 9500
      const purchaseBp = Math.max(1200, Math.min(10000, 10000 - Math.floor(Math.max(0, purchaseRatio - 10000) * elasticity / 10000)))
      let remaining = Math.floor(population * purchaseBp * attachBp / 100_000_000)
      const connectLimit = Math.floor(population * ((segment === 'business' ? 2500 : segment === 'leisure' ? 5000 : 7000) + bankBonus) / 10000)
      let segmentConnections = 0
      const available:number[]=[]
      // Capped water-filling: a full shortest hub yields to other hubs/directs.
      // Equal fractional remainders are awarded by the canonical route order.
      for (let round = 0; remaining > 0 && round < choices.length + 1; round++) {
        available.length=0
        let totalWeight=0
        for(let i=0;i<choices.length;i++) {
          const it=choices[i]!,one=it.legs[0]!,two=it.legs[1]
          const spare=two ? Math.min(one.weeklyCapacity-one.weeklyPax,two.weeklyCapacity-two.weeklyPax,connectLimit-segmentConnections) : Math.min(one.weeklyCapacity-one.weeklyPax,remaining)
          if(spare>0) {available.push(i);totalWeight+=weights[i]!}
        }
        if (totalWeight === 0) break
        const pool = remaining
        let taken = 0
        for (const i of available) {
          const it=choices[i]!,one=it.legs[0]!,two=it.legs[1]
          const spare=two ? Math.min(one.weeklyCapacity-one.weeklyPax,two.weeklyCapacity-two.weeklyPax,connectLimit-segmentConnections) : Math.min(one.weeklyCapacity-one.weeklyPax,remaining)
          const take = Math.min(remaining, spare, Math.max(1, Math.floor(pool * weights[i]! / totalWeight)))
          if (take <= 0) continue
          remaining -= take; taken += take; carried += take
          if (journeys) journeys[i]! += take
          if (it.legs.length === 2) { segmentConnections += take; connecting += take }
          for (const leg of it.legs) {
            const revenue = Math.floor(take * fareFor(leg.km, leg.route.fareLevel) * leg.yieldBp / 10000 * (it.legs.length === 2 ? CONNECT_FARE_DISCOUNT_BP / 10000 : 1))
            leg.weeklyPax += take
            leg.segments![segment] += take
            leg.weeklyRevenue += revenue
            leg.weeklyService += Math.floor(take * SERVICE_COST_PER_PAX[leg.route.serviceLevel - 1]! * infl / 10000)
            if (it.legs.length === 2) {
              leg.weeklyTransfer += take
              leg.transferRevenue! += revenue
              leg.weeklyFees += Math.floor(take * TRANSFER_HANDLING_PER_PAX * infl / 10000)
            }
          }
        }
        if (taken === 0) break
      }
    }
    audit.push({ pair: key, demand, carried, connecting })
    if (trace) {
      const scale = 13 / periodWeeks
      trace.push({ pair:key, demand:demand*scale, carried:carried*scale, connecting:connecting*scale,
        choices:choices.map((it,i)=>({airline:it.airline,routeIds:it.legs.map(l=>l.route.id), journeys:journeys![i]!*scale,
          via:it.legs.length === 2 ? [it.legs[0]!.route.from,it.legs[0]!.route.to].find(c=>c===it.legs[1]!.route.from || c===it.legs[1]!.route.to)! : null })) })
    }
  }
  return audit
}
