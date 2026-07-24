// World offers (F5): the world asking the player a question instead of only
// happening to them. Each offer is a timed decision with a real tradeoff —
// pay now for a payoff later, take an asset and carry the obligation, or bet
// on where fuel is heading. Ignore one and it expires.
//
// Offers are drawn from their own RNG stream so adding them cannot perturb
// the world-event or negotiation draws that the balance envelope is pinned
// against. They are offered to the PLAYER only: rivals are policy-driven and
// have no way to weigh a gamble, and a coin-flip AI answer would be noise.

import { CITIES, getCity } from '../data/cities'
import {
  OFFER_CHANCE_BP,
  OFFER_DECISION_QUARTERS,
  OFFER_FUEL_PREMIUM_BP,
  OFFER_GAMES_BONUS_BP,
  OFFER_GAMES_LEAD_QUARTERS,
  OFFER_SLOTS_GRANTED,
} from '../data/constants'
import { chanceBp, nextInt } from './rng'
import { slotCities, yearOf } from './queries'
import { effFuelBp } from './worldEvents'
import type { GameEvent, GameState, WorldOffer } from './types'

// Cost scales with the era so an offer stays meaningful as the money grows.
function eraScale(state: GameState): number {
  const player = state.airlines[0]!
  const lastCosts = player.history[player.history.length - 1]?.costs ?? 0
  return Math.max(2000, Math.floor(lastCosts / 2))
}

// Draw at most one offer per quarter. Deterministic in (seed, turn).
export function maybeOfferDeal(state: GameState, events: GameEvent[]): void {
  const player = state.airlines[0]!
  if (player.bankrupt) return
  // One open question at a time — a queue of offers is a chore, not a choice.
  if (state.world.offers.length > 0) return
  const roll = chanceBp(state.rng.offers, OFFER_CHANCE_BP)
  state.rng.offers = roll.rng
  if (!roll.value) return

  const kindDraw = nextInt(state.rng.offers, 0, 2)
  state.rng.offers = kindDraw.rng
  const scale = eraScale(state)
  const id = state.world.nextOfferId++
  const expiresTurn = state.turn + OFFER_DECISION_QUARTERS

  let offer: WorldOffer
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
    const candidates = CITIES.filter((c) => (player.slots[c.id] ?? 0) === 0 && c.slotPool >= 16)
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
  state.world.offers.push(offer)
  events.push({ type: 'offer_made', offerId: offer.id, kind: offer.kind, headline: offer.headline, expiresTurn })
}

// Offers nobody answered lapse; deals that have run their course end.
export function expireOffersAndDeals(state: GameState, events: GameEvent[]): void {
  const live: WorldOffer[] = []
  for (const offer of state.world.offers) {
    if (state.turn >= offer.expiresTurn) {
      events.push({ type: 'offer_expired', offerId: offer.id, headline: offer.headline })
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
