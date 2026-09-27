// Rules 7: the fixes and retune a second review asked for. Every mechanic is
// gated on rulesVersion >= 7; each probe checks the rules 6 behavior it
// replaces so the shipped rules stay exactly as they were.

import { describe, expect, it } from 'vitest'
import { typesOnSale } from '../../data/aircraft'
import {
  AIRLIFT_CAPACITY_BP_V7,
  AIRLIFT_FEE_BP_V7,
  HEDGE_ANNOUNCED_LOCK_BP_V7,
  HEDGE_HALF_COVER_PRICE_BP_V7,
  ORDERS_PER_QUARTER_V6,
  SERVICE_COST_PER_PAX,
  SLOTS_PER_GRANT,
  TERMINAL_FUNDER_PREMIUM_BP_V7,
} from '../../data/constants'
import { getEventDef } from '../../data/events'
import { getScenario, objectiveOf } from '../../data/scenarios'
import { applyCommand, endQuarter, newGame, type GameEvent, type GameState, type WorldOffer } from '../index'
import { hedgePremium } from '../commands'
import { segmentServiceYieldBp } from '../market'
import { dealAppealBp, eventOffers, offerMoney } from '../offers'
import { refitCommands, serviceCommands } from '../policy'
import { netWorth } from '../queries'
import { cityPool, expansionSize, nextExpansion, programmesOpen, slotFee, terminalCost, terminalFunderSlots } from '../slots'
import { effFuelBp, hedgeLockBpFor } from '../worldEvents'
import { quietWorld } from './quietWorld'

function network(rules: number, seed = 'rules-v7'): GameState {
  let state = quietWorld(newGame('jet_age', seed, undefined, undefined, rules))
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

describe('funded terminals bring the schedule forward (rules 7)', () => {
  it('the funded programme is the next scheduled one, counted once', () => {
    const state = network(7)
    state.airlines[0]!.cash = 5_000_000
    const city = 'LHR', size = expansionSize(city)
    const scheduled = nextExpansion(state, city)
    const pool = cityPool(state, city)
    const funded = endQuarter(applyCommand(state, { type: 'fund_terminal', city }).state).state
    expect(cityPool(funded, city)).toBe(pool + size)
    // The board now publishes the programme after the one that was funded.
    expect(nextExpansion(funded, city).turn).toBeGreaterThan(scheduled.turn)
    // When the funded programme's original date arrives, nothing new opens.
    const atSchedule = { ...funded, turn: scheduled.turn }
    expect(cityPool(atSchedule, city)).toBe(pool + size)
    expect(programmesOpen(atSchedule, city, scheduled.turn)).toBe(programmesOpen(funded, city, funded.turn))
  })

  it('rules 6 still adds the funded programme on top of the schedule', () => {
    const state = network(6)
    state.airlines[0]!.cash = 5_000_000
    const city = 'LHR', size = expansionSize(city)
    const scheduled = nextExpansion(state, city)
    const pool = cityPool(state, city)
    const funded = endQuarter(applyCommand(state, { type: 'fund_terminal', city }).state).state
    expect(cityPool({ ...funded, turn: scheduled.turn }, city)).toBe(pool + 2 * size)
  })

  it('the funder takes half the programme, pays a premium over the list, and funds one airport a quarter', () => {
    const state = network(7)
    state.airlines[0]!.cash = 5_000_000
    for (const city of ['LHR', 'CDG', 'SYD']) {
      const size = expansionSize(city)
      expect(terminalFunderSlots(state, city)).toBe(Math.max(1, Math.floor(size / 2)))
      const perSlot = Math.floor(slotFee(city) / SLOTS_PER_GRANT)
      const mine = terminalFunderSlots(state, city)
      expect(terminalCost(state, city)).toBeGreaterThanOrEqual(Math.floor((perSlot * mine * TERMINAL_FUNDER_PREMIUM_BP_V7) / 10000))
    }
    const first = applyCommand(state, { type: 'fund_terminal', city: 'LHR' })
    expect(first.events[0]).toMatchObject({ type: 'terminal_funded' })
    const second = applyCommand(first.state, { type: 'fund_terminal', city: 'CDG' })
    expect(second.events[0]).toMatchObject({ type: 'command_rejected' })
    const next = endQuarter(first.state)
    const granted = next.events.find((e) => e.type === 'slots_granted' && e.airline === 0 && e.city === 'LHR')
    expect(granted).toMatchObject({ slots: terminalFunderSlots(state, 'LHR') })
  })
})

describe('takeovers (rules 7)', () => {
  function distressed(rules: number): GameState {
    const state = network(rules)
    state.turn = 20
    const rival = state.airlines[1]!
    rival.insolventQuarters = 1
    rival.cash = -20_000
    state.airlines[0]!.cash = 1_000_000
    return state
  }

  it('an overdraft comes with the company', () => {
    const state = distressed(7)
    const { state: after, events } = applyCommand(state, { type: 'acquire_rival', target: 1 })
    expect(events[0]).toMatchObject({ type: 'rival_acquired' })
    const price = events[0]!.type === 'rival_acquired' ? events[0]!.price : 0
    expect(after.airlines[0]!.cash).toBe(1_000_000 - price - 20_000)
    // Rules 6 dropped it on the floor.
    const legacy = applyCommand(distressed(6), { type: 'acquire_rival', target: 1 })
    const legacyPrice = legacy.events[0]!.type === 'rival_acquired' ? legacy.events[0]!.price : 0
    expect(legacy.state.airlines[0]!.cash).toBe(1_000_000 - legacyPrice)
  })

  it('small but profitable is not for sale', () => {
    const stage = (rules: number) => {
      const state = network(rules)
      state.turn = 20
      state.airlines[0]!.cash = 50_000_000
      const rival = state.airlines[1]!
      rival.history.push({ ...(rival.history.at(-1) ?? { turn: 19, cash: 0, revenue: 0, costs: 0, pax: 0, netWorth: 0,
        breakdown: { fuel: 0, fees: 0, flightPay: 0, service: 0, salaries: 0, ownership: 0, maintenance: 0, admin: 0, slots: 0, overhead: 0, marketing: 0, interest: 0 } }), profit: 500 })
      expect(netWorth(rival) * 4).toBeLessThanOrEqual(netWorth(state.airlines[0]!))
      return state
    }
    expect(applyCommand(stage(7), { type: 'acquire_rival', target: 1 }).events[0]).toMatchObject({ type: 'command_rejected' })
    expect(applyCommand(stage(6), { type: 'acquire_rival', target: 1 }).events[0]).toMatchObject({ type: 'rival_acquired' })
  })
})

describe('deals and offers (rules 7)', () => {
  it('a deal\'s appeal ends with the deal', () => {
    for (const rules of [6, 7]) {
      const state = network(rules)
      state.airlines[0]!.deals = [{ offerId: 1, kind: 'official_carrier', city: 'MIA', fromTurn: 0, untilTurn: 2, upkeepK: 0, demandBonusBp: 3500 }]
      state.turn = 2
      expect(dealAppealBp(state, 0, 'JFK', 'MIA')).toBe(rules >= 7 ? 10000 : 13500)
    }
  })

  it('offer events name the airline they are for', () => {
    const state = endQuarter(network(7)).state
    state.world.announced = [{ id: 'conflict', quartersLeft: 2, city: null, region: 'na' }]
    // Stage a slump deep enough that the airlift is worth asking about.
    for (const r of state.airlines[0]!.routes) { r.lastPax = Math.floor(r.lastCapacity / 2) }
    const events: GameEvent[] = []
    state.turn--
    eventOffers(state, events)
    state.turn++
    expect(events.find((e) => e.type === 'offer_made')).toMatchObject({ airline: 0 })
  })

  it('an airlift charters most of the slump and pays a share of the slumped revenue', () => {
    const state = endQuarter(network(7)).state
    for (const r of state.airlines[0]!.routes) { r.lastPax = Math.floor(r.lastCapacity / 2) }
    state.world.announced = [{ id: 'conflict', quartersLeft: 2, city: null, region: 'na' }]
    state.turn--
    eventOffers(state, [])
    state.turn++
    const made = state.world.offers.find((o) => o.kind === 'airlift_contract')!
    const revenue = state.airlines[0]!.routes.reduce((n, r) => n + r.lastRevenue, 0)
    const slumped = Math.floor((revenue * getEventDef('conflict').demandModBp!) / 10000)
    expect(made).toMatchObject({ capacityBp: AIRLIFT_CAPACITY_BP_V7, incomeK: Math.max(100, Math.floor((slumped * AIRLIFT_FEE_BP_V7) / 10000)) })
  })

  it('no promotion where the seats are already sold, and no airlift where the slump would still fill them', () => {
    const full = endQuarter(network(7)).state
    for (const r of full.airlines[0]!.routes) { r.lastPax = r.lastCapacity }
    // The Games at a sold-out city: nothing to sell, so no question.
    full.world.announced = [{ id: 'olympics', quartersLeft: 2, city: 'MIA', region: null }]
    full.turn--
    eventOffers(full, [])
    full.turn++
    expect(full.world.offers.some((o) => o.kind === 'official_carrier')).toBe(false)
    const half = endQuarter(network(7)).state
    for (const r of half.airlines[0]!.routes) { r.lastPax = Math.floor(r.lastCapacity / 2) }
    half.world.announced = [{ id: 'olympics', quartersLeft: 2, city: 'MIA', region: null }]
    half.turn--
    eventOffers(half, [])
    half.turn++
    expect(half.world.offers.some((o) => o.kind === 'official_carrier')).toBe(true)
    // Runway works halve demand at a city; a sold-out route stays half full,
    // under the airlift bar, so it is asked. A near-empty mild slump is too.
    const works = endQuarter(network(7)).state
    for (const r of works.airlines[0]!.routes) { r.lastPax = r.lastCapacity }
    works.world.announced = [{ id: 'currency_crisis', quartersLeft: 2, city: null, region: 'na' }]
    works.turn--
    eventOffers(works, [])
    works.turn++
    // 100% load × 70% demand = 70%: below the 90% bar, so the airlift is on the table.
    expect(works.world.offers.some((o) => o.kind === 'airlift_contract')).toBe(true)
    const brimming = endQuarter(network(7)).state
    for (const r of brimming.airlines[0]!.routes) { r.lastPax = r.lastCapacity }
    brimming.world.announced = [{ id: 'tourism_wave', quartersLeft: 2, city: null, region: 'na' }]
    brimming.turn--
    eventOffers(brimming, [])
    brimming.turn++
    expect(brimming.world.offers.filter((o) => o.eventId !== undefined)).toHaveLength(0)
  })

  it('offer prose writes money like the rest of the game, only under rules 7', () => {
    expect(offerMoney({ rulesVersion: 7 }, 2540)).toBe('$2.5M')
    expect(offerMoney({ rulesVersion: 7 }, 540)).toBe('$540k')
    expect(offerMoney({ rulesVersion: 7 }, 1_250_000)).toBe('$1.2B')
    expect(offerMoney({ rulesVersion: 7 }, -2540)).toBe('−$2.5M')
    expect(offerMoney({ rulesVersion: 6 }, 2540)).toBe('2,540k')
  })

  it('a production slot is a new-build order: it counts against the line and waits for room', () => {
    const state = network(7)
    state.airlines[0]!.cash = 50_000_000
    const type = typesOnSale(1960).find((t) => t.deliveryQuarters >= 2)!
    let s = state
    for (let i = 0; i < ORDERS_PER_QUARTER_V6; i++) s = applyCommand(s, { type: 'order_aircraft', aircraftType: type.id }).state
    const slot = offer(s, { kind: 'early_delivery', aircraftType: type.id, costK: 100 })
    expect(applyCommand(s, { type: 'accept_offer', offerId: slot.id }).events[0]).toMatchObject({ type: 'command_rejected' })
    const fresh = network(7)
    fresh.airlines[0]!.cash = 50_000_000
    const early = offer(fresh, { kind: 'early_delivery', aircraftType: type.id, costK: 100 })
    let t = applyCommand(fresh, { type: 'accept_offer', offerId: early.id }).state
    for (let i = 0; i < ORDERS_PER_QUARTER_V6 - 1; i++) t = applyCommand(t, { type: 'order_aircraft', aircraftType: type.id }).state
    expect(applyCommand(t, { type: 'order_aircraft', aircraftType: type.id }).events[0]).toMatchObject({ type: 'command_rejected' })
  })
})

describe('hedges (rules 7)', () => {
  it('a hedge on the headline locks most of the announced shock, priced at the lock', () => {
    const state = endQuarter(network(7)).state
    state.world.announced = [{ id: 'oil_shock', quartersLeft: 6, city: null, region: null }]
    const now = effFuelBp(state.world)
    const landed = effFuelBp({ ...state.world, events: [...state.world.events, ...state.world.announced] })
    const lock = now + Math.floor(((landed - now) * HEDGE_ANNOUNCED_LOCK_BP_V7) / 10000)
    expect(hedgeLockBpFor(state)).toBe(lock)
    const me = state.airlines[0]!
    const quiet = structuredClone(state)
    quiet.world.announced = []
    expect(hedgePremium(state, me, 4, 10000)).toBeGreaterThan(hedgePremium(quiet, quiet.airlines[0]!, 4, 10000))
  })

  it('half cover costs more than half of full cover', () => {
    const state = endQuarter(network(7)).state
    const me = state.airlines[0]!
    const full = hedgePremium(state, me, 4, 10000)
    expect(hedgePremium(state, me, 4, 5000)).toBe(Math.floor((full * HEDGE_HALF_COVER_PRICE_BP_V7) / 10000))
    expect(hedgePremium(state, me, 4, 5000) * 2).toBeGreaterThan(full)
  })
})

describe('service and cabin are per-route products (rules 7)', () => {
  it('business travellers pay for full service, budget travellers do not', () => {
    const s = { rulesVersion: 7 }
    expect(segmentServiceYieldBp(s, 'business', 3)).toBeGreaterThan(segmentServiceYieldBp(s, 'leisure', 3))
    expect(segmentServiceYieldBp(s, 'budget', 3)).toBe(10000)
    expect(segmentServiceYieldBp({ rulesVersion: 6 }, 'budget', 3)).toBe(10900)
  })

  it('the shared brain picks service per route, within a step of its posture', () => {
    const state = endQuarter(network(7)).state
    const commands = serviceCommands(state, 0, 2)
    for (const c of commands) expect(c.type === 'set_service' && c.serviceLevel >= 1 && c.serviceLevel <= 3).toBe(true)
    // A budget posture never reaches full service.
    for (const c of serviceCommands(state, 0, 1)) expect(c.type === 'set_service' && c.serviceLevel <= 2).toBe(true)
    // Rules 6 bots left service alone.
    expect(serviceCommands(endQuarter(network(6)).state, 0, 2)).toEqual([])
    expect(SERVICE_COST_PER_PAX).toHaveLength(3)
  })

  it('the shared brain refits per route within a step of its posture', () => {
    const state = endQuarter(network(7)).state
    state.airlines[0]!.cash = 1_000_000
    for (const c of refitCommands(state, 0, 1)) expect(c.type === 'refit_cabin' && c.cabin <= 2).toBe(true)
    for (const c of refitCommands(state, 0, 3)) expect(c.type === 'refit_cabin' && c.cabin >= 2).toBe(true)
  })
})

describe('short mandates are a challenge again (rules 7)', () => {
  it('raises the bar only for careers on rules 7', () => {
    for (const id of ['rescue', 'fuel_crunch', 'atlantic', 'hub_defense']) {
      const legacy = objectiveOf(id, 6), modern = objectiveOf(id, 7)
      expect(legacy.target).toBe(getScenario(id).objective.target)
      expect(modern.target).toBeGreaterThan(legacy.target * 2)
      expect(modern.kind).toBe(legacy.kind)
    }
    expect(objectiveOf('jet_age', 7)).toBe(getScenario('jet_age').objective)
  })
})
