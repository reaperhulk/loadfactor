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

// Exporting the audit lets tests prove conservation without storing a giant
// O/D matrix in every save. The UI receives compact per-route segment totals.
export function resolveItineraries(state: GameState, legs: RouteAcc[], periodWeeks = 1): MarketAudit[] {
  const markets = new Map<string, Itinerary[]>()
  const add = (from: string, to: string, itinerary: Itinerary) => {
    const key = pairKey(from, to)
    const existing = markets.get(key) ?? []
    existing.push(itinerary)
    markets.set(key, existing)
  }
  for (const leg of legs) {
    leg.segments = { business: 0, leisure: 0, budget: 0 }
    leg.transferRevenue = 0
    if (leg.weeklyCapacity <= 0) continue
    add(leg.route.from, leg.route.to, {
      legs: [leg], airline: leg.airlineIdx, km: leg.km, trips: leg.weeklyTrips,
      fare: Math.floor(fareFor(leg.km, leg.route.fareLevel) * leg.yieldBp / 10000),
    })
  }
  for (const airline of state.airlines) {
    const hubs = new Map<string, RouteAcc[]>()
    for (const leg of legs.filter((l) => l.airlineIdx === airline.id && l.weeklyCapacity > 0)) {
      for (const city of [leg.route.from, leg.route.to]) {
        const list = hubs.get(city) ?? []; list.push(leg); hubs.set(city, list)
      }
    }
    for (const hub of [...hubs.keys()].sort()) {
      const spokes = hubs.get(hub)!
      for (let i = 0; i < spokes.length; i++) for (let j = i + 1; j < spokes.length; j++) {
        const one = spokes[i]!, two = spokes[j]!
        const from = one.route.from === hub ? one.route.to : one.route.from
        const to = two.route.from === hub ? two.route.to : two.route.from
        const km = one.km + two.km
        if (km * 10000 > distanceKm(from, to) * CONNECT_DETOUR_MAX_BP) continue
        const fare = [one, two].reduce((sum, l) => sum + Math.floor(fareFor(l.km, l.route.fareLevel) * l.yieldBp / 10000), 0)
        add(from, to, { legs: [one, two], airline: airline.id, km,
          trips: Math.min(one.weeklyTrips, two.weeklyTrips),
          fare: Math.floor(fare * CONNECT_FARE_DISCOUNT_BP / 10000) })
      }
    }
  }
  const audit: MarketAudit[] = []
  const infl = inflationBp(state.turn)
  const rules = getScenario(state.scenario).rules
  for (const key of [...markets.keys()].sort()) {
    const choices = markets.get(key)!
    const [from, to] = key.split('-') as [string, string]
    const demand = pairWeeklyDemand(state, from, to) * periodWeeks
    const mix = segmentMix(from, to)
    const directKm = distanceKm(from, to)
    const directFare = fareFor(directKm, 0)
    // Segment-independent attributes are evaluated once per itinerary.
    const attributes = choices.map(it => {
      const airline = state.airlines[it.airline]!
      return {
        service: Math.min(...it.legs.map(l => l.route.serviceLevel)),
        cabin: Math.floor(it.legs.reduce((sum, l) => sum + l.yieldBp, 0) / it.legs.length),
        priceAppeal: Math.max(1200, 21000 - Math.min(24000, Math.floor(it.fare * 10000 / Math.max(1, directFare)))),
        frequency: Math.floor(it.trips / periodWeeks),
        spool: Math.min(...it.legs.map(l => routeSpoolBp(airline, l.route, state.turn))),
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
        return Math.max(1, Math.floor(weight))
      })
      // Expensive offers lose shoppers to the outside option. Connections
      // alone attract a limited market; adding more airlines cannot duplicate it.
      const elasticity = segment === 'business' ? 3000 : segment === 'leisure' ? 6500 : 9500
      const purchaseBp = Math.max(1200, Math.min(10000, 10000 - Math.floor(Math.max(0, purchaseRatio - 10000) * elasticity / 10000)))
      let remaining = Math.floor(population * purchaseBp * attachBp / 100_000_000)
      const connectLimit = Math.floor(population * ((segment === 'business' ? 2500 : segment === 'leisure' ? 5000 : 7000) + bankBonus) / 10000)
      let segmentConnections = 0
      // Capped water-filling: a full shortest hub yields to other hubs/directs.
      // Equal fractional remainders are awarded by the canonical route order.
      for (let round = 0; remaining > 0 && round < choices.length + 1; round++) {
        const available = choices.map((it, i) => ({ it, i, spare: Math.min(...it.legs.map((l) => l.weeklyCapacity - l.weeklyPax), it.legs.length === 2 ? connectLimit - segmentConnections : remaining) })).filter((x) => x.spare > 0)
        const totalWeight = available.reduce((sum, x) => sum + weights[x.i]!, 0)
        if (totalWeight === 0) break
        const pool = remaining
        let taken = 0
        for (const { it, i } of available) {
          const spare = Math.min(...it.legs.map((l) => l.weeklyCapacity - l.weeklyPax), it.legs.length === 2 ? connectLimit - segmentConnections : remaining)
          const take = Math.min(remaining, spare, Math.max(1, Math.floor(pool * weights[i]! / totalWeight)))
          if (take <= 0) continue
          remaining -= take; taken += take; carried += take
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
  }
  return audit
}
