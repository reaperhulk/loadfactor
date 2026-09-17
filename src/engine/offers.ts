// World offers (F5): the world asking the player a question instead of only
// happening to them. Each offer is a timed decision with a real tradeoff —
// pay now for a payoff later, take an asset and carry the obligation, or bet
// on where fuel is heading. Ignore one and it expires.
//
// Offers are drawn from their own RNG stream so adding them cannot perturb
// the world-event or negotiation draws that the balance envelope is pinned
// against. They are offered to the PLAYER only: rivals are policy-driven and
// have no way to weigh a gamble, and a coin-flip AI answer would be noise.

import { CITIES, distanceKm, getCity, pairKey } from '../data/cities'
import { AIRCRAFT, getAircraftType, typesOnSale } from '../data/aircraft'
import { AI_MIN_ROUTE_KM, EARLY_DELIVERY_PREMIUM_BP, FLEET_SALE_PRICE_BP, OFFER_EVERY_QUARTERS_V5, ROUTE_RIGHTS_QUARTERS, STRIKE_CAPACITY_BP } from '../data/constants'
import { pairWeeklyDemand } from './market'
import { aircraftOperations, modernOperations } from './operations'
import { slotsRemaining } from './slots'
import {
  OFFER_CHANCE_BP,
  OFFER_DECISION_QUARTERS,
  OFFER_FUEL_PREMIUM_BP,
  OFFER_GAMES_BONUS_BP,
  OFFER_GAMES_LEAD_QUARTERS,
  OFFER_SLOTS_GRANTED,
} from '../data/constants'
import { chanceBp, fnv1a, nextInt } from './rng'
import { netWorth, resaleValue, slotCities, yearOf } from './queries'
import { effFuelBp } from './worldEvents'
import type { Airline, GameEvent, GameState, OfferKind, WorldOffer } from './types'

// Cost scales with the era so an offer stays meaningful as the money grows.
function eraScale(state: GameState, seat = 0): number {
  const player = state.airlines[seat]!
  const lastCosts = player.history[player.history.length - 1]?.costs ?? 0
  return Math.max(2000, Math.floor(lastCosts / 2))
}

// Rules 5 kinds, each a question with a real downside on both answers.
const V5_KINDS: readonly OfferKind[] = ['capacity_commitment', 'regulator_slots', 'fuel_contract', 'hub_strike', 'early_delivery', 'fleet_sale', 'route_rights']

function feasibleKind(state: GameState, player: Airline, kind: OfferKind): boolean {
  switch (kind) {
    case 'hub_strike': return player.routes.filter((r) => r.from === player.hq || r.to === player.hq).length >= 2
    case 'early_delivery': return typesOnSale(yearOf(state)).some((t) => t.deliveryQuarters >= 2)
    case 'fleet_sale': return player.routes.length >= 1
    case 'route_rights': return routeRightsCity(state, player) !== null
    default: return true
  }
}

// The richest unserved pair from the HQ the authority can still grant slots
// at — and one no rival flies yet, or exclusivity would be an eviction.
function routeRightsCity(state: GameState, player: Airline): string | null {
  let reach = 0
  for (const ac of player.fleet) reach = Math.max(reach, getAircraftType(ac.type).rangeKm)
  for (const t of typesOnSale(yearOf(state))) reach = Math.max(reach, t.rangeKm)
  const flown = new Set(state.airlines.filter((a) => !a.bankrupt).flatMap((a) => a.routes.map((r) => pairKey(r.from, r.to))))
  let best: string | null = null, bestDemand = 0
  for (const c of CITIES) {
    if (c.id === player.hq || (player.slots[c.id] ?? 0) > 0 || slotsRemaining(state, c.id) < 2) continue
    const km = distanceKm(player.hq, c.id)
    if (km < AI_MIN_ROUTE_KM || km > reach || flown.has(pairKey(player.hq, c.id))) continue
    const demand = pairWeeklyDemand(state, player.hq, c.id)
    if (demand > bestDemand) { bestDemand = demand; best = c.id }
  }
  return best
}

function offerV5(state: GameState, player: Airline, kind: OfferKind, id: number, scale: number, expiresTurn: number): WorldOffer | null {
  const base = { id, expiresTurn, upkeepK: 0, benefitFromTurn: state.turn, slots: 0, demandBonusBp: 0, airline: player.id }
  switch (kind) {
    case 'hub_strike': {
      const hub = getCity(player.hq).name
      return { ...base, kind, city: player.hq, costK: Math.max(300, Math.floor(scale / 4)), untilTurn: state.turn + 1,
        headline: `Strike ballot: ground crews at ${hub}`,
        detail: `The ${hub} ground unions have voted to walk out next quarter. Settle now and nothing changes. Refuse, or let the deadline pass, and ${100 - STRIKE_CAPACITY_BP / 100}% of your flights touching ${hub} are cancelled for one quarter — crews and aircraft paid, seats unsold.` }
    }
    case 'early_delivery': {
      const types = typesOnSale(yearOf(state)).filter((t) => t.deliveryQuarters >= 2)
      const t = types[fnv1a(`${state.seed}|early|${state.turn}`) % types.length]!
      const cost = Math.floor((t.price * (10000 + EARLY_DELIVERY_PREMIUM_BP)) / 10000)
      return { ...base, kind, city: null, aircraftType: t.id, costK: cost, untilTurn: state.turn + 1,
        headline: `Production slot: a ${t.name} next quarter`,
        detail: `A cancelled order has freed a ${t.name} on the line. Pay ${EARLY_DELIVERY_PREMIUM_BP / 100}% over list (${cost.toLocaleString('en-US')}k, paid now) and it delivers next quarter instead of in ${t.deliveryQuarters}. Pass, and the slot goes to whoever is next in line.` }
    }
    case 'fleet_sale': {
      const year = yearOf(state)
      const pool = AIRCRAFT.filter((a) => year >= a.availableFrom && year <= a.availableTo + 10)
      const h = fnv1a(`${state.seed}|sale|${state.turn}`)
      const t = pool[h % pool.length]!
      const count = 2 + ((h >>> 8) % 2)
      const ageQuarters = 16 + ((h >>> 16) % 24)
      const each = Math.floor((resaleValue(t.id, ageQuarters) * FLEET_SALE_PRICE_BP) / 10000)
      return { ...base, kind, city: null, aircraftType: t.id, count, ageQuarters, costK: each * count, untilTurn: state.turn + 1,
        headline: `Liquidation: ${count} used ${t.name}s at ${FLEET_SALE_PRICE_BP / 100}% of value`,
        detail: `A failed carrier's receivers are selling ${count} ${t.name}s (${Math.floor(ageQuarters / 4)} years old) as one lot for ${(each * count).toLocaleString('en-US')}k, delivered immediately. Your strongest rival is bidding too: decide this quarter, or the lot is theirs.` }
    }
    case 'route_rights': {
      const city = routeRightsCity(state, player)
      if (city === null) return null
      const hub = getCity(player.hq).name, there = getCity(city).name
      return { ...base, kind, city, pair: pairKey(player.hq, city), slots: 2, costK: scale, upkeepK: Math.max(100, Math.floor(scale / 10)), untilTurn: state.turn + ROUTE_RIGHTS_QUARTERS,
        headline: `Bilateral: exclusive ${hub}–${there} rights`,
        detail: `Two governments will designate you sole carrier on ${hub}–${there} for ${ROUTE_RIGHTS_QUARTERS} quarters: two slots at ${there} now, and no rival may open the pair while the treaty runs. It costs ${scale.toLocaleString('en-US')}k up front plus a quarterly fee, whether or not you ever fly it.` }
    }
    default: return null
  }
}

// Draw at most one offer per quarter. Deterministic in (seed, turn).
export function maybeOfferDeal(state: GameState, events: GameEvent[]): void {
  const modern = (state.rulesVersion ?? 1) >= 2
  const v5 = (state.rulesVersion ?? 1) >= 5
  if (v5 ? state.turn % OFFER_EVERY_QUARTERS_V5 !== 0 : modern && state.turn % 8 !== 0) return
  const humans = state.airlines.filter((a) => a.controller === 'player' && !a.bankrupt)
  const player = modern ? humans[Math.floor(state.turn / 8) % Math.max(1, humans.length)] : state.airlines[0]
  if (!player || player.bankrupt) return
  // One open question at a time — a queue of offers is a chore, not a choice.
  if (state.world.offers.length > 0) return
  const roll = chanceBp(state.rng.offers, OFFER_CHANCE_BP)
  state.rng.offers = roll.rng
  if (!roll.value && !modern) return

  const kindDraw = nextInt(state.rng.offers, 0, v5 ? V5_KINDS.length - 1 : 2)
  state.rng.offers = kindDraw.rng
  const scale = eraScale(state, player.id)
  const id = state.world.nextOfferId++
  const expiresTurn = state.turn + (modern ? 4 : OFFER_DECISION_QUARTERS)

  let offer: WorldOffer
  if (v5 && kindDraw.value >= 3) {
    // Walk forward from the draw to the first kind the world can actually
    // put on the table today (a strike needs a hub; rights need a city).
    let kind: OfferKind | null = null
    for (let i = 0; i < V5_KINDS.length && kind === null; i++) {
      const candidate = V5_KINDS[(kindDraw.value + i) % V5_KINDS.length]!
      if (feasibleKind(state, player, candidate)) kind = candidate
    }
    if (kind === null) return
    if (kind === 'capacity_commitment' || kind === 'regulator_slots' || kind === 'fuel_contract') {
      // Fell through to a classic kind: reuse the legacy branches below.
      kindDraw.value = kind === 'capacity_commitment' ? 0 : kind === 'regulator_slots' ? 1 : 2
    } else {
      const made = offerV5(state, player, kind, id, scale, state.turn + 1)
      if (!made) return
      state.world.offers.push(made)
      events.push({ type: 'offer_made', offerId: made.id, kind: made.kind, headline: made.headline, expiresTurn: made.expiresTurn })
      return
    }
  }
  if (kindDraw.value === 0) {
    // The Games are coming: commit capacity years ahead for a demand surge
    // at that city — worth nothing unless you actually fly there by then.
    const held = slotCities(player)
    const pool = held.length > 0 ? held : CITIES.slice(0, 20).map((c) => c.id)
    const pick = nextInt(state.rng.offers, 0, pool.length - 1)
    state.rng.offers = pick.rng
    const city = pool[pick.value]!
    const start = state.turn + OFFER_GAMES_LEAD_QUARTERS
    offer = {
      id,
      kind: 'capacity_commitment',
      city,
      expiresTurn,
      costK: scale,
      upkeepK: 0,
      benefitFromTurn: start,
      untilTurn: start + 4,
      slots: 0,
      demandBonusBp: OFFER_GAMES_BONUS_BP,
      headline: `Host committee: commit capacity to ${getCity(city).name}`,
      detail: `The Games land in ${getCity(city).name} in ${OFFER_GAMES_LEAD_QUARTERS} quarters. Block the capacity now and your flights there carry a +${OFFER_GAMES_BONUS_BP / 100}% appeal surge for a year once they open. Worthless if you are not flying there by then.`,
    }
  } else if (kindDraw.value === 1) {
    // The authority hands over gates — and bills you for the public-service
    // obligations that come attached.
    const candidates = CITIES.filter((c) => (player.slots[c.id] ?? 0) === 0 && c.slotPool >= 10)
    if (candidates.length === 0) return
    const pick = nextInt(state.rng.offers, 0, Math.min(9, candidates.length - 1))
    state.rng.offers = pick.rng
    const city = candidates[pick.value]!.id
    offer = {
      id,
      kind: 'regulator_slots',
      city,
      expiresTurn,
      costK: Math.floor(scale / 2),
      upkeepK: Math.max(200, Math.floor(scale / 8)),
      benefitFromTurn: state.turn,
      untilTurn: state.turn + 16,
      slots: OFFER_SLOTS_GRANTED,
      demandBonusBp: 0,
      headline: `Authority deal: ${OFFER_SLOTS_GRANTED} slots at ${getCity(city).name}`,
      detail: `${getCity(city).name} will grant ${OFFER_SLOTS_GRANTED} slots immediately in exchange for public-service commitments — an upkeep charge every quarter for the next 16. Gates now, a drag on the P&L later.`,
    }
  } else {
    // A long fuel contract: certainty at a premium. A bet on the curve.
    const bp = effFuelBp(state.world)
    offer = {
      id,
      kind: 'fuel_contract',
      city: null,
      expiresTurn,
      costK: Math.floor(scale / 3),
      upkeepK: 0,
      benefitFromTurn: state.turn,
      untilTurn: state.turn + 12,
      slots: 0,
      demandBonusBp: 0,
      headline: `Supplier offer: 12-quarter fuel contract`,
      detail: `Lock fuel at ${(bp / 100).toFixed(0)}% of baseline plus a ${OFFER_FUEL_PREMIUM_BP / 100}% premium for twelve quarters — three years of certainty in ${yearOf(state)}. A bet that fuel goes up, and a loss if it falls.`,
    }
  }
  if (modern) offer.airline = player.id
  state.world.offers.push(offer)
  events.push({ type: 'offer_made', offerId: offer.id, kind: offer.kind, headline: offer.headline, expiresTurn })
}

// A refused (or ignored) strike ballot becomes the strike: one quarter of
// thinned capacity at the hub, starting with the next quarter flown.
export function strikeDeal(offer: WorldOffer, fromTurn: number): NonNullable<Airline['deals']>[number] {
  return { offerId: offer.id, kind: 'hub_strike', city: offer.city, fromTurn, untilTurn: fromTurn + 1, upkeepK: 0, demandBonusBp: 0, capacityBp: STRIKE_CAPACITY_BP }
}

// The lot the player passed on goes to the richest rival that can pay.
function rivalBuysLot(state: GameState, offer: WorldOffer, events: GameEvent[]): void {
  if (!offer.aircraftType || !offer.count) return
  const buyers = state.airlines.filter((a) => a.controller === 'rival' && !a.bankrupt && a.cash >= offer.costK * 2).sort((a, b) => netWorth(b) - netWorth(a) || a.id - b.id)
  const buyer = buyers[0]
  if (!buyer) return
  buyer.cash -= offer.costK
  for (let i = 0; i < offer.count; i++) {
    const ac: Airline['fleet'][number] = { id: buyer.nextId++, type: offer.aircraftType, ageQuarters: offer.ageQuarters ?? 0, routeId: null, leased: false, cabin: 2 }
    if (modernOperations(state)) ac.operations = aircraftOperations(buyer, ac, state.turn + 1)
    buyer.fleet.push(ac)
    events.push({ type: 'used_bought', airline: buyer.id, aircraftId: ac.id, aircraftType: ac.type, price: Math.floor(offer.costK / offer.count), ageQuarters: ac.ageQuarters })
  }
}

// Offers nobody answered lapse; deals that have run their course end.
export function expireOffersAndDeals(state: GameState, events: GameEvent[]): void {
  const live: WorldOffer[] = []
  for (const offer of state.world.offers) {
    if (state.turn >= offer.expiresTurn) {
      events.push({ type: 'offer_expired', offerId: offer.id, headline: offer.headline })
      const owner = state.airlines[offer.airline ?? 0]
      if (offer.kind === 'hub_strike' && owner && !owner.bankrupt) owner.deals = [...(owner.deals ?? []), strikeDeal(offer, state.turn + 1)]
      if (offer.kind === 'fleet_sale') rivalBuysLot(state, offer, events)
    } else {
      live.push(offer)
    }
  }
  state.world.offers = live

  for (const airline of state.airlines) {
    if (!airline.deals || airline.deals.length === 0) continue
    const running = []
    for (const deal of airline.deals) {
      if (state.turn >= deal.untilTurn) {
        events.push({ type: 'deal_ended', kind: deal.kind, city: deal.city })
      } else {
        running.push(deal)
      }
    }
    airline.deals = running
  }
}

// The appeal multiplier an airline's committed-capacity deals give a route
// touching the deal's city. 10000 = no effect.
export function dealAppealBp(state: GameState, airlineIdx: number, from: string, to: string): number {
  const deals = state.airlines[airlineIdx]?.deals
  if (!deals || deals.length === 0) return 10000
  let bp = 10000
  for (const deal of deals) {
    if (deal.demandBonusBp === 0 || deal.city === null) continue
    // The payoff window has to have arrived AND the route has to touch it.
    if (deal.city !== from && deal.city !== to) continue
    if (state.turn < deal.fromTurn) continue // committed, but the Games are not here yet
    bp += deal.demandBonusBp
  }
  return bp
}

// Quarterly upkeep an airline owes on its running deals ($k).
export function dealUpkeep(airline: { deals?: { upkeepK: number }[] }): number {
  let total = 0
  for (const deal of airline.deals ?? []) total += deal.upkeepK
  return total
}

// Share of an airline's trips touching `city` that fly this quarter (bp):
// 10000 unless a strike is on.
export function strikeCapacityBp(state: GameState, airlineIdx: number, from: string, to: string): number {
  const deals = state.airlines[airlineIdx]?.deals
  if (!deals || deals.length === 0) return 10000
  let bp = 10000
  for (const deal of deals) {
    if (deal.capacityBp === undefined || deal.city === null) continue
    if (deal.city !== from && deal.city !== to) continue
    if (state.turn < deal.fromTurn || state.turn >= deal.untilTurn) continue
    bp = Math.min(bp, deal.capacityBp)
  }
  return bp
}

// Whether a pair is under someone else's bilateral exclusivity this turn.
export function exclusiveHolder(state: GameState, from: string, to: string): Airline | null {
  const key = pairKey(from, to)
  for (const airline of state.airlines) {
    if (airline.bankrupt) continue
    for (const deal of airline.deals ?? []) {
      if (deal.pair === key && state.turn >= deal.fromTurn && state.turn < deal.untilTurn) return airline
    }
  }
  return null
}
