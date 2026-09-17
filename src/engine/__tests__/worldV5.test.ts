// Rules 5: the world asks questions. Strikes, production slots, liquidation
// lots and bilateral rights are decisions with a downside on both answers;
// new types are news; the deck is rules-gated so legacy draws never move.

import { describe, expect, it } from 'vitest'
import { getAircraftType, typesOnSale } from '../../data/aircraft'
import { WORLD_EVENTS, WORLD_EVENTS_V5 } from '../../data/events'
import { DEBUT_APPEAL_BP, DEBUT_APPEAL_QUARTERS, STRIKE_CAPACITY_BP } from '../../data/constants'
import { applyCommand, endQuarter, newGame, type GameState, type WorldOffer } from '../index'
import { applyPlanningCommand } from '../commands'
import { exclusiveHolder, expireOffersAndDeals, maybeOfferDeal, strikeCapacityBp } from '../offers'
import { debutAppealBp } from '../worldEvents'

function hubNetwork(rules = 5): GameState {
  let state = newGame('jet_age', 'world-v5', undefined, undefined, rules)
  const me = state.airlines[0]!
  state = applyCommand(state, { type: 'open_route', from: 'JFK', to: 'ORD', aircraftId: me.fleet[0]!.id, frequency: 8 }).state
  state = applyCommand(state, { type: 'open_route', from: 'JFK', to: 'MIA', aircraftId: me.fleet[1]!.id, frequency: 6 }).state
  return state
}

function offer(state: GameState, partial: Partial<WorldOffer> & Pick<WorldOffer, 'kind'>): WorldOffer {
  const made: WorldOffer = { id: state.world.nextOfferId++, airline: 0, city: null, expiresTurn: state.turn + 1, costK: 500, upkeepK: 0,
    benefitFromTurn: state.turn, untilTurn: state.turn + 1, slots: 0, demandBonusBp: 0, headline: 'test', detail: 'test', ...partial }
  state.world.offers.push(made)
  return made
}

describe('offers that ask a real question (rules 5)', () => {
  it('a settled strike changes nothing; a refused one cancels trips at the hub for exactly one quarter', () => {
    const base = hubNetwork()
    const settledState = structuredClone(base)
    const settled = applyCommand(settledState, { type: 'accept_offer', offerId: offer(settledState, { kind: 'hub_strike', city: 'JFK' }).id })
    expect(settled.events.some((e) => e.type === 'offer_accepted')).toBe(true)
    expect(settled.state.airlines[0]!.deals ?? []).toHaveLength(0)

    const refusedState = structuredClone(base)
    const ballot = offer(refusedState, { kind: 'hub_strike', city: 'JFK' })
    const refused = applyCommand(refusedState, { type: 'decline_offer', offerId: ballot.id }).state
    expect(strikeCapacityBp(refused, 0, 'JFK', 'ORD')).toBe(STRIKE_CAPACITY_BP)
    expect(strikeCapacityBp(refused, 0, 'ORD', 'MIA')).toBe(10000)
    const flown = endQuarter(refused)
    const hit = flown.events.filter((e) => e.type === 'strike_hit' && e.airline === 0)
    expect(hit.length).toBeGreaterThan(0)
    const quiet = endQuarter(base)
    const paxOf = (s: GameState) => s.airlines[0]!.history.at(-1)!.pax
    expect(paxOf(flown.state)).toBeLessThan(paxOf(quiet.state))
    // Over by the following quarter: capacity returns, and the record ends
    // with that quarter's resolution like every other deal.
    expect(strikeCapacityBp(flown.state, 0, 'JFK', 'ORD')).toBe(10000)
    const after = endQuarter(flown.state)
    expect(after.events.some((e) => e.type === 'deal_ended' && e.kind === 'hub_strike')).toBe(true)
    expect(after.state.airlines[0]!.deals ?? []).toHaveLength(0)
  })

  it('an ignored strike ballot still becomes a strike, in the next quarter flown', () => {
    const state = hubNetwork()
    offer(state, { kind: 'hub_strike', city: 'JFK', expiresTurn: state.turn })
    const events: GameState['airlines'][number]['history'] extends never ? never : Parameters<typeof expireOffersAndDeals>[1] = []
    expireOffersAndDeals(state, events)
    expect(events.some((e) => e.type === 'offer_expired')).toBe(true)
    const deal = state.airlines[0]!.deals!.find((d) => d.kind === 'hub_strike')!
    expect(deal.fromTurn).toBe(state.turn + 1)
    expect(deal.capacityBp).toBe(STRIKE_CAPACITY_BP)
  })

  it('a production slot delivers next quarter at a premium', () => {
    const state = hubNetwork()
    const type = typesOnSale(1960).find((t) => t.deliveryQuarters >= 2)!
    const made = offer(state, { kind: 'early_delivery', aircraftType: type.id, costK: 9999 })
    const taken = applyCommand(state, { type: 'accept_offer', offerId: made.id })
    const order = taken.state.airlines[0]!.orders.find((o) => o.type === type.id)!
    expect(order.quartersLeft).toBe(1)
    expect(taken.state.airlines[0]!.cash).toBe(state.airlines[0]!.cash - 9999)
    const next = endQuarter(taken.state)
    expect(next.events.some((e) => e.type === 'aircraft_delivered' && e.airline === 0 && e.aircraftType === type.id)).toBe(true)
  })

  it('a liquidation lot lands in the fleet now, or in the strongest rival\'s fleet if passed', () => {
    const base = hubNetwork()
    const lot = offer(base, { kind: 'fleet_sale', aircraftType: 'caravelle', count: 3, ageQuarters: 20, costK: 3000, expiresTurn: base.turn })
    const taken = applyCommand(structuredClone(base), { type: 'accept_offer', offerId: lot.id }).state
    expect(taken.airlines[0]!.fleet.filter((a) => a.ageQuarters === 20)).toHaveLength(3)
    expect(taken.airlines[0]!.fleet.every((a) => a.operations !== undefined)).toBe(true)

    const passed = structuredClone(base)
    passed.airlines[2]!.cash = 100_000 // the richest rival wins the lot
    const before = passed.airlines[2]!.fleet.length
    const events: Parameters<typeof expireOffersAndDeals>[1] = []
    expireOffersAndDeals(passed, events)
    expect(passed.airlines[2]!.fleet.length).toBe(before + 3)
    expect(passed.airlines[2]!.cash).toBe(100_000 - 3000)
    expect(events.filter((e) => e.type === 'used_bought' && e.airline === 2)).toHaveLength(3)
  })

  it('bilateral rights grant slots and keep rivals off the pair while they run — never the holder', () => {
    const state = hubNetwork()
    const rights = offer(state, { kind: 'route_rights', city: 'SFO', pair: 'JFK-SFO', slots: 2, untilTurn: state.turn + 8 })
    const held = applyCommand(state, { type: 'accept_offer', offerId: rights.id }).state
    expect(held.airlines[0]!.slots['SFO']).toBe(2)
    expect(exclusiveHolder(held, 'SFO', 'JFK')?.id).toBe(0)
    const rival = held.airlines[1]!
    rival.slots['JFK'] = 2; rival.slots['SFO'] = 2
    rival.routes.push({ id: rival.nextId++, from: 'JFK', to: 'LHR', fareLevel: 0, serviceLevel: 2, frequency: 4, lastPax: 0, lastCapacity: 0, lastLoadFactorBp: 0, lastRevenue: 0, lastCost: 0, lastTransferPax: 0, history: [] })
    const jet = { id: rival.nextId++, type: 'dc8_62', ageQuarters: 0, routeId: null, leased: false, cabin: 2 }
    rival.fleet.push(jet)
    const blocked = applyPlanningCommand(held, 1, { type: 'open_route', from: 'JFK', to: 'SFO', aircraftId: jet.id, frequency: 3 })
    expect(blocked.events.some((e) => e.type === 'command_rejected' && e.reason.includes('exclusive'))).toBe(true)
    // The holder flies it; the treaty lapses on schedule and the pair reopens.
    held.airlines[0]!.fleet.push({ ...jet, id: held.airlines[0]!.nextId++ })
    const mine = applyCommand(held, { type: 'open_route', from: 'JFK', to: 'SFO', aircraftId: held.airlines[0]!.fleet.at(-1)!.id, frequency: 3 })
    expect(mine.events.some((e) => e.type === 'route_opened' && e.airline === 0)).toBe(true)
    const later = { ...held, turn: held.turn + 8 }
    expect(exclusiveHolder(later, 'JFK', 'SFO')).toBeNull()
  })

  it('draws one of seven questions every four quarters, from the offers stream only', () => {
    let state = hubNetwork()
    const kinds = new Set<string>()
    for (let i = 0; i < 40; i++) {
      state.world.offers = []
      state.turn = i * 4
      const events: Parameters<typeof maybeOfferDeal>[1] = []
      maybeOfferDeal(state, events)
      for (const o of state.world.offers) kinds.add(o.kind)
      state = { ...state, rng: { ...state.rng, offers: state.rng.offers } }
    }
    expect(kinds.size).toBeGreaterThanOrEqual(5)
    // The classic cadence keeps its slower clock under rules 4.
    const legacy = hubNetwork(4)
    legacy.turn = 4
    maybeOfferDeal(legacy, [])
    expect(legacy.world.offers).toHaveLength(0)
  })
})

describe('a louder world (rules 5)', () => {
  it('the rules-5 deck adds events legacy rules never draw', () => {
    const added = WORLD_EVENTS_V5.filter((e) => (e.fromRules ?? 1) >= 5).map((e) => e.id)
    expect(added).toEqual(['airport_works', 'currency_crisis'])
    expect(WORLD_EVENTS.some((e) => e.fromRules !== undefined)).toBe(false)
  })

  it('a new type is announced in its first quarter on sale and carries appeal for its debut window', () => {
    // 1963 Q1: the 727 goes on sale. Turn 12 resolves 1963 Q1.
    let state = newGame('jet_age', 'debut-seed')
    state.turn = 12
    const result = endQuarter(state)
    expect(result.events.some((e) => e.type === 'aircraft_introduced' && e.aircraftType === 'b727')).toBe(true)
    state = result.state
    expect(debutAppealBp(state, 'b727', DEBUT_APPEAL_BP)).toBe(DEBUT_APPEAL_BP)
    expect(debutAppealBp(state, 'caravelle', DEBUT_APPEAL_BP)).toBe(0)
    state.turn = 12 + DEBUT_APPEAL_QUARTERS
    expect(debutAppealBp(state, 'b727', DEBUT_APPEAL_BP)).toBe(0)
    // Legacy rules: no announcement, no bonus.
    const legacy = newGame('jet_age', 'debut-seed', undefined, undefined, 4)
    legacy.turn = 12
    expect(endQuarter(legacy).events.some((e) => e.type === 'aircraft_introduced')).toBe(false)
    expect(debutAppealBp(legacy, 'b727', DEBUT_APPEAL_BP)).toBe(0)
    expect(getAircraftType('b727').availableFrom).toBe(1963)
  })
})
