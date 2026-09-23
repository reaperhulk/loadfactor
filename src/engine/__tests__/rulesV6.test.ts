// Rules 6: price is a lever again, the world warns before it strikes, cash
// has somewhere to go, and every route result says why. Each mechanic is
// gated on rulesVersion >= 6; the rules 5 side of each probe proves the
// legacy path is untouched.

import { describe, expect, it } from 'vitest'
import { getAircraftType, typesOnSale } from '../../data/aircraft'
import {
  AIRLIFT_CAPACITY_BP_V6,
  ENTRANT_GRACE_QUARTERS,
  HEDGE_PREMIUM_BP_OF_FUEL_V6,
  OFFICIAL_CARRIER_DEMAND_BP_V6,
  ORDERS_PER_QUARTER_V6,
  PRICE_WAR_FARE_LEVEL,
  SERVICE_YIELD_BP_V6,
  TERMINAL_FUNDER_SLOTS_V6,
} from '../../data/constants'
import { applyCommand, endQuarter, newGame, type GameEvent, type GameState, type Route } from '../index'
import { forecastDirectRoute, forecastQuarter } from '../forecast'
import { hedgePremium } from '../commands'
import { chooseCampaign, raidTarget } from '../campaigns'
import { runRivalTurn } from '../rivals'
import { eventOffers, promotionDemandBp } from '../offers'
import { takeoverPaysFor } from '../policy'
import { fliesAtFieldScale, netWorth } from '../queries'
import { cityPool, expansionSize, terminalCost } from '../slots'
import { effFuelBp, hedgeLockBp } from '../worldEvents'
import { quietWorld } from './quietWorld'

function network(rules: number, seed = 'rules-v6'): GameState {
  let state = quietWorld(newGame('jet_age', seed, undefined, undefined, rules))
  const me = state.airlines[0]!
  state = applyCommand(state, { type: 'open_route', from: 'JFK', to: 'ORD', aircraftId: me.fleet[0]!.id, frequency: 8 }).state
  state = applyCommand(state, { type: 'open_route', from: 'JFK', to: 'MIA', aircraftId: me.fleet[1]!.id, frequency: 6 }).state
  return state
}

function route(id: number, from: string, to: string, extra: Partial<Route> = {}): Route {
  return { id, from, to, fareLevel: 0, serviceLevel: 2, frequency: 4, lastPax: 0, lastCapacity: 0, lastLoadFactorBp: 0, lastRevenue: 0,
    lastCost: 0, lastTransferPax: 0, history: [], ...extra }
}

// A monopoly route with far more seats than travellers: price alone moves
// how many people fly.
function emptyMonopoly(rules: number, fareLevel: number, serviceLevel = 2): Route {
  const state = network(rules)
  state.turn = 12 // past the spool: history drives the ramp, so give it some
  // A deep slump over the whole region leaves the schedule far bigger than
  // the market, so seats never bind.
  state.world.economyBp = 7000
  state.world.events = [{ id: 'conflict', quartersLeft: 4, city: null, region: 'na' }, { id: 'recession', quartersLeft: 4, city: null, region: null }]
  const mine = state.airlines[0]!.routes[0]!
  mine.history = Array.from({ length: 3 }, (_, i) => ({ turn: i, pax: 0, transferPax: 0, capacity: 0, loadFactorBp: 0, revenue: 0, cost: 0 }))
  return forecastDirectRoute(state, 0, { ...mine, fareLevel, serviceLevel, frequency: 8 })
}

describe('fares are a lever (rules 6)', () => {
  it('a discount grows the market instead of only moving share', () => {
    expect(emptyMonopoly(6, 0).lastLoadFactorBp).toBeLessThan(6000)
    expect(emptyMonopoly(6, -2).lastPax).toBeGreaterThan(emptyMonopoly(6, 0).lastPax)
    // Rules 5 capped the market at the standard fare: cheaper sold no more.
    expect(emptyMonopoly(5, -2).lastPax).toBe(emptyMonopoly(5, 0).lastPax)
  })

  it('the top fare sheds more travellers than it used to', () => {
    const shed = (rules: number) => emptyMonopoly(rules, 2).lastPax * 10000 / emptyMonopoly(rules, 0).lastPax
    expect(shed(6)).toBeLessThan(shed(5))
  })

  it('better service earns more per passenger without changing a monopoly\'s passengers', () => {
    const basic = emptyMonopoly(6, 0, 1), full = emptyMonopoly(6, 0, 3)
    expect(full.lastPax).toBe(basic.lastPax)
    const ratio = Math.floor((full.lastRevenue * 10000) / basic.lastRevenue)
    expect(Math.abs(ratio - Math.floor((SERVICE_YIELD_BP_V6[2]! * 10000) / SERVICE_YIELD_BP_V6[0]!))).toBeLessThan(100)
    // Rules 5: service bought share, never yield.
    expect(emptyMonopoly(5, 0, 3).lastRevenue).toBe(emptyMonopoly(5, 0, 1).lastRevenue)
  })
})

describe('the world warns before it strikes (rules 6)', () => {
  it('every drawn event is announced a quarter before it lands, and lands exactly once', () => {
    let state = newGame('jet_age', 'warning-seed', undefined, undefined, 6)
    const announced: string[] = [], started: string[] = []
    for (let q = 0; q < 40; q++) {
      const { state: next, events } = endQuarter(state)
      for (const e of events) {
        if (e.type === 'world_event_started') {
          // Whatever lands this quarter was announced in the previous one.
          expect(announced.at(-1)).toBe(e.eventId)
          started.push(e.eventId)
        }
        if (e.type === 'world_event_announced') {
          expect(e.startsTurn).toBe(state.turn + 1)
          expect(next.world.announced?.some((a) => a.id === e.eventId)).toBe(true)
          announced.push(e.eventId)
        }
      }
      state = next
    }
    expect(announced.length).toBeGreaterThan(3)
    expect(started.length).toBeGreaterThanOrEqual(announced.length - 1)
    // Rules 5 never announces: events land the quarter they are drawn.
    let legacy = newGame('jet_age', 'warning-seed', undefined, undefined, 5)
    for (let q = 0; q < 40; q++) {
      const { state: next, events } = endQuarter(legacy)
      expect(events.some((e) => e.type === 'world_event_announced')).toBe(false)
      expect(next.world.announced).toBeUndefined()
      legacy = next
    }
  })

  it('the plan is priced with the announced shock, and a hedge carries half of it', () => {
    const state = network(6)
    const calm = forecastQuarter(state, 0)
    state.world.announced = [{ id: 'oil_shock', quartersLeft: 6, city: null, region: null }]
    const warned = forecastQuarter(state, 0)
    expect(warned.breakdown.fuel).toBeGreaterThan(calm.breakdown.fuel)
    const now = effFuelBp(state.world)
    const landed = effFuelBp({ ...state.world, events: [{ id: 'oil_shock', quartersLeft: 6, city: null, region: null }] })
    expect(hedgeLockBp(state.world)).toBe(Math.floor((now + landed) / 2))
    // The shock is live the quarter after the warning.
    const next = endQuarter(state)
    expect(next.events.some((e) => e.type === 'world_event_started' && e.eventId === 'oil_shock')).toBe(true)
    expect(next.state.world.events.some((e) => e.id === 'oil_shock')).toBe(true)
  })
})

describe('hedges cost what they cover (rules 6)', () => {
  it('prices a share of last quarter\'s fuel bill, halved for half cover', () => {
    const flown = endQuarter(network(6)).state
    const me = flown.airlines[0]!
    const fuel = me.history.at(-1)!.breakdown.fuel
    expect(fuel).toBeGreaterThan(0)
    const full = hedgePremium(flown, me, 4, 10000)
    expect(full).toBe(Math.floor((fuel * HEDGE_PREMIUM_BP_OF_FUEL_V6) / 10000) * 4)
    expect(hedgePremium(flown, me, 4, 5000)).toBe(Math.floor(full / 2))
    const taken = applyCommand(flown, { type: 'hedge_fuel', quarters: 4, coverBp: 5000 })
    expect(taken.events[0]).toMatchObject({ type: 'fuel_hedged', coverBp: 5000, premium: Math.floor(full / 2) })
    expect(taken.state.airlines[0]!.cash).toBe(me.cash - Math.floor(full / 2))
    const odd = applyCommand(flown, { type: 'hedge_fuel', quarters: 4, coverBp: 7300 })
    expect(odd.events[0]).toMatchObject({ type: 'command_rejected' })
    // Rules 5 knows nothing of partial cover.
    const legacy = applyCommand(endQuarter(network(5)).state, { type: 'hedge_fuel', quarters: 4, coverBp: 5000 })
    expect(legacy.events[0]).toMatchObject({ type: 'command_rejected' })
  })

  it('a half hedge pays half the gap between the lock and the market', () => {
    const base = network(6)
    const fuelWith = (coverBp: number | null) => {
      const state = structuredClone(base)
      state.world.fuelBp = 15000
      state.airlines[0]!.fuelHedge = coverBp === null ? null : { bp: 10000, quartersLeft: 2, coverBp }
      return forecastQuarter(state, 0).breakdown.fuel
    }
    const none = fuelWith(null), half = fuelWith(5000), full = fuelWith(10000)
    expect(full).toBeLessThan(half)
    expect(half).toBeLessThan(none)
    expect(Math.abs(half - Math.floor((none + full) / 2))).toBeLessThanOrEqual(2)
  })
})

describe('capital discipline (rules 6)', () => {
  it('the delivery lines take a few new-build orders a quarter, leases included', () => {
    const type = typesOnSale(1960)[0]!
    let state = network(6)
    state.airlines[0]!.cash = 10_000_000
    for (let i = 0; i < ORDERS_PER_QUARTER_V6 - 1; i++) state = applyCommand(state, { type: 'order_aircraft', aircraftType: type.id }).state
    state = applyCommand(state, { type: 'lease_aircraft', aircraftType: type.id }).state
    expect(state.airlines[0]!.orders).toHaveLength(ORDERS_PER_QUARTER_V6)
    const over = applyCommand(state, { type: 'order_aircraft', aircraftType: type.id })
    expect(over.events[0]).toMatchObject({ type: 'command_rejected' })
    expect(applyCommand(state, { type: 'lease_aircraft', aircraftType: type.id }).events[0]).toMatchObject({ type: 'command_rejected' })
    // The line reopens next quarter.
    const next = endQuarter(state).state
    expect(applyCommand(next, { type: 'order_aircraft', aircraftType: type.id }).events[0]).toMatchObject({ type: 'aircraft_ordered' })
    // Rules 5 had no cap.
    let legacy = network(5)
    legacy.airlines[0]!.cash = 10_000_000
    for (let i = 0; i <= ORDERS_PER_QUARTER_V6; i++) legacy = applyCommand(legacy, { type: 'order_aircraft', aircraftType: type.id }).state
    expect(legacy.airlines[0]!.orders).toHaveLength(ORDERS_PER_QUARTER_V6 + 1)
  })

  it('a newly launched carrier cannot be bought by anyone during its grace period', () => {
    const stage = (rules: number) => {
      const state = network(rules)
      state.turn = 20
      const rival = state.airlines[1]!
      rival.insolventQuarters = 1
      rival.enteredTurn = 20 - (ENTRANT_GRACE_QUARTERS - 1)
      state.airlines[0]!.cash = 1_000_000
      return state
    }
    expect(applyCommand(stage(6), { type: 'acquire_rival', target: 1 }).events[0]).toMatchObject({ type: 'command_rejected' })
    expect(applyCommand(stage(5), { type: 'acquire_rival', target: 1 }).events[0]).toMatchObject({ type: 'rival_acquired' })
    const old = stage(6)
    old.airlines[1]!.enteredTurn = 20 - ENTRANT_GRACE_QUARTERS
    expect(applyCommand(old, { type: 'acquire_rival', target: 1 }).events[0]).toMatchObject({ type: 'rival_acquired' })
  })

  it('the shared brain buys a company only when the premium is cheaper than its slots', () => {
    const state = network(6)
    state.turn = 20
    const target = state.airlines[1]!
    const worth = netWorth(target)
    target.slots = { [target.hq]: 10 }
    expect(takeoverPaysFor(state, target, worth + 1)).toBe(false) // nothing to buy but the premium
    target.slots = { [target.hq]: 10, LHR: 4, CDG: 4 }
    expect(takeoverPaysFor(state, target, worth + 1)).toBe(true)
    // Too late in the career to fly what you bought.
    state.turn = 78
    expect(takeoverPaysFor(state, target, worth + 1)).toBe(false)
  })
})

describe('funded terminals (rules 6)', () => {
  it('money brings a city\'s programme forward and hands the funder the first slots', () => {
    const state = network(6)
    state.airlines[0]!.cash = 1_000_000
    const city = 'LHR'
    const pool = cityPool(state, city)
    const cost = terminalCost(state, city)
    const funded = applyCommand(state, { type: 'fund_terminal', city })
    expect(funded.events[0]).toMatchObject({ type: 'terminal_funded', city, cost, slots: expansionSize(city), opensTurn: state.turn + 1 })
    expect(funded.state.airlines[0]!.cash).toBe(1_000_000 - cost)
    // A second programme at the same airport has to wait for the concrete.
    expect(applyCommand(funded.state, { type: 'fund_terminal', city }).events[0]).toMatchObject({ type: 'command_rejected' })
    const next = endQuarter(funded.state)
    expect(next.events.some((e) => e.type === 'slots_granted' && e.airline === 0 && e.city === city && e.slots === TERMINAL_FUNDER_SLOTS_V6)).toBe(true)
    expect(cityPool(next.state, city)).toBe(pool + expansionSize(city))
    expect(next.state.airlines[0]!.slots[city]).toBe(TERMINAL_FUNDER_SLOTS_V6)
  })

  it('refuses without the cash, and under earlier rules', () => {
    const poor = network(6)
    poor.airlines[0]!.cash = 0
    expect(applyCommand(poor, { type: 'fund_terminal', city: 'LHR' }).events[0]).toMatchObject({ type: 'command_rejected', reason: 'insufficient cash' })
    const legacy = network(5)
    legacy.airlines[0]!.cash = 1_000_000
    expect(applyCommand(legacy, { type: 'fund_terminal', city: 'LHR' }).events[0]).toMatchObject({ type: 'command_rejected' })
  })
})

describe('rivals are harder to read (rules 6)', () => {
  function raidStage(rules: number): GameState {
    const state = network(rules)
    const leader = state.airlines[0]!
    leader.cash = 5_000_000
    // Four profitable markets out of Chicago the raider can reach.
    leader.routes = ['ATL', 'DEN', 'IAH', 'MIA'].map((to, i) => route(1000 + i, to < 'ORD' ? to : 'ORD', to < 'ORD' ? 'ORD' : to,
      { lastPax: 30000, lastRevenue: 5000 - i * 100, lastCost: 1000 }))
    const raider = state.airlines[1]!
    raider.cash = 200_000
    raider.hq = 'ORD'
    for (const c of ['ORD', 'ATL', 'DEN', 'IAH', 'MIA']) raider.slots[c] = 4
    return state
  }

  it('a raid picks among the leader\'s best markets, not always the single best', () => {
    const picks = new Set<string>()
    for (let turn = 4; turn < 40; turn++) {
      const state = raidStage(6)
      state.turn = turn
      const target = raidTarget(state, 1)
      expect(target).not.toBeNull()
      picks.add(target!.pair)
    }
    expect(picks.size).toBeGreaterThan(1)
    expect(picks.has('MIA-ORD')).toBe(false) // fourth best is never in the draw
    // Rules 5 always went for the richest one.
    const legacy = new Set<string>()
    for (let turn = 4; turn < 40; turn++) {
      const state = raidStage(5)
      state.turn = turn
      legacy.add(raidTarget(state, 1)!.pair)
    }
    expect([...legacy]).toEqual(['ATL-ORD'])
  })

  it('a price war names the contested pair and cuts fares only there', () => {
    const state = network(6)
    const rival = state.airlines[1]!
    rival.hq = 'JFK'
    rival.slots = { JFK: 6, ORD: 2, MIA: 2 }
    rival.cash = 200_000
    rival.personality = 'price_war'
    rival.routes = [route(2000, 'JFK', 'ORD', { lastPax: 1000, lastRevenue: 900, lastCost: 500 }), route(2001, 'JFK', 'MIA', { lastPax: 5000, lastRevenue: 900, lastCost: 500 })]
    const mine = state.airlines[0]!.routes.find((r) => r.to === 'ORD')!
    mine.lastPax = 20000
    const campaign = chooseCampaign(state, 1)
    expect(campaign).toMatchObject({ kind: 'price', pair: 'JFK-ORD' })
    // Once it runs, only the named pair goes to the floor.
    state.turn = campaign.fromTurn
    rival.campaign = campaign
    runRivalTurn(state, 1, [])
    expect(rival.routes.find((r) => r.to === 'ORD')!.fareLevel).toBe(PRICE_WAR_FARE_LEVEL)
    expect(rival.routes.find((r) => r.to === 'MIA')!.fareLevel).not.toBe(PRICE_WAR_FARE_LEVEL)
  })
})

describe('efficiency mandates need a real airline (rules 6)', () => {
  it('a token schedule does not qualify against a field flying real capacity', () => {
    const state = network(6)
    const seats = (id: number, capacity: number) => {
      state.airlines[id]!.history.push({ turn: 0, cash: 0, revenue: 0, costs: 0, profit: 0, pax: 0, capacity, netWorth: 0,
        breakdown: { fuel: 0, fees: 0, flightPay: 0, service: 0, salaries: 0, ownership: 0, maintenance: 0, admin: 0, slots: 0, overhead: 0, marketing: 0, interest: 0 } })
    }
    seats(0, 100_000); seats(1, 500_000); seats(2, 600_000); seats(3, 700_000)
    expect(fliesAtFieldScale(state, state.airlines[0]!)).toBe(false)
    state.airlines[0]!.history.at(-1)!.capacity = 300_000
    expect(fliesAtFieldScale(state, state.airlines[0]!)).toBe(true)
  })
})

describe('the news asks a question (rules 6)', () => {
  // Offers are made while the quarter that drew the news resolves: one turn
  // before the planning turn the player answers them in.
  function announce(state: GameState, id: string, city: string | null, region: GameState['world']['events'][number]['region']): GameEvent[] {
    state.world.announced = [{ id, quartersLeft: 2, city, region }]
    const events: GameEvent[] = []
    state.turn--
    eventOffers(state, events)
    state.turn++
    return events
  }

  it('a regional slump offers an airlift: half the schedule there for a fixed fee', () => {
    const state = endQuarter(network(6)).state
    const events = announce(state, 'conflict', null, 'na')
    const offer = state.world.offers.find((o) => o.kind === 'airlift_contract')!
    expect(events).toContainEqual(expect.objectContaining({ type: 'offer_made', kind: 'airlift_contract' }))
    expect(offer).toMatchObject({ airline: 0, region: 'na', capacityBp: AIRLIFT_CAPACITY_BP_V6, costK: 0, benefitFromTurn: state.turn, expiresTurn: state.turn })
    expect(offer.incomeK).toBeGreaterThan(0)
    // No duplicate question for the same news.
    state.turn--
    eventOffers(state, [])
    state.turn++
    expect(state.world.offers.filter((o) => o.kind === 'airlift_contract')).toHaveLength(1)

    const refused = endQuarter(structuredClone(state))
    const taken = applyCommand(state, { type: 'accept_offer', offerId: offer.id }).state
    const flown = endQuarter(taken)
    expect(flown.events.some((e) => e.type === 'airlift_flown' && e.airline === 0)).toBe(true)
    const me = flown.state.airlines[0]!.history.at(-1)!, them = refused.state.airlines[0]!.history.at(-1)!
    expect(me.pax).toBeLessThan(them.pax)
    expect(me.revenue - (flown.state.airlines[0]!.routes.reduce((s, r) => s + r.lastRevenue, 0))).toBe(offer.incomeK)
  })

  it('a surge offers the official-carrier deal: appeal plus travel on the host\'s pairs', () => {
    const state = endQuarter(network(6)).state
    announce(state, 'olympics', 'MIA', null)
    const offer = state.world.offers.find((o) => o.kind === 'official_carrier')!
    expect(offer).toMatchObject({ city: 'MIA', costK: expect.any(Number) })
    const taken = applyCommand(state, { type: 'accept_offer', offerId: offer.id }).state
    taken.turn = offer.benefitFromTurn
    expect(promotionDemandBp(taken, 'JFK', 'MIA')).toBe(10000 + OFFICIAL_CARRIER_DEMAND_BP_V6)
    expect(promotionDemandBp(taken, 'JFK', 'ORD')).toBe(10000)
    taken.turn = offer.untilTurn
    expect(promotionDemandBp(taken, 'JFK', 'MIA')).toBe(10000)
  })

  it('news that touches nobody\'s network asks nobody', () => {
    const state = endQuarter(network(6)).state
    announce(state, 'conflict', null, 'eu')
    expect(state.world.offers.filter((o) => o.eventId !== undefined)).toHaveLength(0)
  })
})

describe('route results explain themselves (rules 6)', () => {
  it('keeps the pair\'s market and the cost split beside every result', () => {
    const { state, events } = endQuarter(network(6))
    for (const r of state.airlines[0]!.routes) {
      const m = r.lastMarket!
      // Carried can exceed the standard-fare demand: discounts grow the market.
      expect(m.carried).toBeGreaterThanOrEqual(m.own)
      expect(m.own).toBeGreaterThan(0)
      expect(m.unserved).toBe(Math.max(0, m.demand - m.carried))
      expect(m.full).toBe(r.lastLoadFactorBp >= 9500)
      const c = r.lastCostParts!
      expect(c.fuel + c.fees + c.flightPay + c.service).toBe(r.lastCost)
    }
    expect(events.some((e) => e.type === 'route_result' && e.market !== undefined)).toBe(true)
    const legacy = endQuarter(network(5)).state
    expect(legacy.airlines[0]!.routes.every((r) => r.lastMarket === undefined && r.lastCostParts === undefined)).toBe(true)
  })

  it('an aircraft type sanity check for the staging helper', () => {
    expect(getAircraftType(network(6).airlines[0]!.fleet[0]!.type).rangeKm).toBeGreaterThan(1000)
  })
})
