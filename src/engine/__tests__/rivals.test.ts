import { describe, expect, it } from 'vitest'
import { CITIES, getCity } from '../../data/cities'
import {
  ENTRANT_EVERY_QUARTERS,
  INSOLVENCY_QUARTERS_TO_FAIL,
  RESTRUCTURE_MAX,
} from '../../data/constants'
import { applyCommand, endQuarter, newGame, type GameEvent } from '../index'
import { negotiationCommands, yieldCommands } from '../policy'
import { pairWeeklySeats, routeWeeklyCapacity } from '../queries'
import { expansionScore, runRivalTurn } from '../rivals'

describe('rival intelligence', () => {
  it('expansion score nets fielded seats out of demand by contest appetite', () => {
    expect(expansionScore(1000, 0, 10000)).toBe(1000)
    expect(expansionScore(1000, 400, 10000)).toBe(600)
    // price_war (6000) reads incumbents as beatable; premium (13000) reads a
    // crowded pair as poison — same market, different appetite.
    expect(expansionScore(1000, 400, 6000)).toBeGreaterThan(expansionScore(1000, 400, 13000))
  })

  it('pairWeeklySeats counts the hardware every airline flies on a pair', () => {
    let state = newGame('jet_age', 'seats-seed')
    expect(pairWeeklySeats(state, 'JFK', 'ORD')).toBe(0)
    state = applyCommand(state, {
      type: 'open_route',
      from: 'JFK',
      to: 'ORD',
      aircraftId: 1,
      frequency: 10,
    }).state
    const airline = state.airlines[0]!
    const seats = pairWeeklySeats(state, 'JFK', 'ORD')
    expect(seats).toBeGreaterThan(0)
    expect(seats).toBe(routeWeeklyCapacity(airline, airline.routes[0]!))
    expect(pairWeeklySeats(state, 'ORD', 'JFK')).toBe(seats)
  })

  it('a healthy rival absorbs a distressed fellow rival — never the player', () => {
    const state = newGame('jet_age', 'consolidation-seed')
    const buyer = state.airlines[1]!
    const prey = state.airlines[2]!
    buyer.cash = 500_000
    prey.insolventQuarters = 1
    // The player is equally distressed with a real network — and still safe.
    state.airlines[0]!.insolventQuarters = 2
    for (const to of ['LHR', 'CDG']) {
      prey.routes.push({
        id: prey.nextId++,
        from: 'FRA',
        to,
        fareLevel: 0,
        serviceLevel: 2,
        frequency: 5,
        lastPax: 0,
        lastCapacity: 0,
        lastLoadFactorBp: 0,
        lastRevenue: 0,
        lastCost: 0,
        lastTransferPax: 0,
        history: [],
      })
    }
    const events: GameEvent[] = []
    runRivalTurn(state, 1, events)
    const deal = events.find((e) => e.type === 'rival_acquired')
    expect(deal, 'the rich rival consolidated the distressed one').toMatchObject({ airline: 1, target: 2 })
    expect(state.airlines[2]!.bankrupt).toBe(true)
    expect(buyer.routes.length).toBeGreaterThanOrEqual(2)
    expect(state.airlines[0]!.bankrupt).toBe(false) // the player seat survives
  })

  it('rivals counter-bid a pending negotiation instead of lowballing it', () => {
    const state = newGame('jet_age', 'counterbid-seed')
    // Give the player a pending bid at every authority: whichever city the
    // rival targets, it walks into a war in progress and must top the field.
    for (const c of CITIES) state.airlines[0]!.negotiations.push({ city: c.id, spend: 20_000 })
    const rival = state.airlines[1]!
    rival.cash = 500_000
    const events: GameEvent[] = []
    runRivalTurn(state, 1, events)
    const bid = rival.negotiations[0]
    expect(bid, 'the rival still entered a negotiation').toBeDefined()
    expect(bid!.spend, 'outbids the pending 20,000 by 20%').toBeGreaterThanOrEqual(24_000)
  })

  it('the dials genuinely differentiate the shared brain on identical state', () => {
    // Fare floors: on the same slack route, a price warrior keeps cutting
    // where a premium carrier holds the line.
    const state = newGame('jet_age', 'dials-seed')
    const me = state.airlines[0]!
    const idle = me.fleet.find((a) => a.routeId === null)!
    const opened = applyCommand(state, {
      type: 'open_route',
      from: 'JFK',
      to: 'ORD',
      aircraftId: idle.id,
      frequency: 5,
    }).state
    const route = opened.airlines[0]!.routes[0]!
    route.lastCapacity = 1000
    route.lastLoadFactorBp = 4000 // slack — yield management wants a cut
    route.fareLevel = 0
    expect(yieldCommands(opened, 0, 0), 'premium floor holds the fare').toHaveLength(0)
    expect(yieldCommands(opened, 0, -2), 'price-war floor keeps cutting').toMatchObject([
      { type: 'set_fare', fareLevel: -1 },
    ])

    // Home-region discipline: with a fortress threshold the SAME airline
    // negotiates inside its HQ region; without it, wherever the money is.
    const dials = {
      negotiateBudgetBp: 10000,
      raidBonus: 0,
      homeRegionUntil: 0,
    }
    const roam = negotiationCommands(opened, 0, dials)
    const home = negotiationCommands(opened, 0, { ...dials, homeRegionUntil: 10 })
    expect(home).toHaveLength(1)
    if (home[0]!.type === 'negotiate_slots') {
      expect(getCity(home[0]!.city).region).toBe(getCity(opened.airlines[0]!.hq).region)
    }
    expect(roam).toHaveLength(1)
  })

  // F4: a rival's slot campaign is declared state, not a decision taken
  // inside a pass nobody can watch. The player reads `slotInterest` during
  // planning and can outbid it — so it has to be honest about what the rival
  // will actually do.
  it('a rival announces the authority it will court, then bids exactly there', () => {
    const state = newGame('jet_age', 'intent-seed')
    const rival = state.airlines[1]!
    const events: GameEvent[] = []
    runRivalTurn(state, 1, events)
    const announced = rival.slotInterest
    expect(announced).toBeDefined()
    expect(rival.negotiations.map((n) => n.city)).toEqual([announced])

    // The campaign is binding across quarters: clear the pending bid as the
    // authority would when it says no, and the rival returns to the SAME city
    // rather than chasing whatever now scores highest.
    rival.negotiations = []
    runRivalTurn(state, 1, events)
    expect(rival.negotiations.map((n) => n.city)).toEqual([announced])
    expect(rival.slotInterest).toBe(announced)

    // Once the slots are won the campaign is over and the next one is named.
    rival.negotiations = []
    rival.slots[announced!] = 2
    runRivalTurn(state, 1, events)
    expect(rival.slotInterest).not.toBe(announced)
  })

  it('bankruptcy and restructuring both retire the announced campaign', () => {
    const state = newGame('jet_age', 'intent-clear-seed')
    const events: GameEvent[] = []
    runRivalTurn(state, 1, events)
    expect(state.airlines[1]!.slotInterest).toBeDefined()
    // Drive the rival under: the seat is liquidated, and a dead carrier must
    // not keep a ring on the map.
    const doomed = state.airlines[1]!
    doomed.cash = -50_000_000
    doomed.insolventQuarters = INSOLVENCY_QUARTERS_TO_FAIL - 1
    doomed.restructures = RESTRUCTURE_MAX
    let s = state
    for (let i = 0; i < 3 && !s.airlines[1]!.bankrupt; i++) {
      s.airlines[1]!.cash = -50_000_000
      s.airlines[1]!.insolventQuarters = INSOLVENCY_QUARTERS_TO_FAIL - 1
      s = endQuarter(s).state
    }
    expect(s.airlines[1]!.bankrupt).toBe(true)
    expect(s.airlines[1]!.slotInterest).toBeUndefined()
  })
})

describe('a field that fights back (F1)', () => {
  it('a failing rival restructures instead of dying, then dies when the chances run out', () => {
    let state = newGame('jet_age', 'restructure-seed')
    const rival = state.airlines[1]!
    rival.routes.push({
      id: rival.nextId++,
      from: 'LHR',
      to: 'JFK',
      fareLevel: 0,
      serviceLevel: 2,
      frequency: 5,
      lastPax: 0,
      lastCapacity: 0,
      lastLoadFactorBp: 0,
      lastRevenue: 0,
      lastCost: 0,
      lastTransferPax: 0,
      history: [],
    })
    rival.loans.push({ id: rival.nextId++, principal: 30_000, annualRateBp: 900 })

    // Drive it under water repeatedly; each failure should restructure first.
    // The hole has to be unfixable: resolution recomputes solvency AFTER the
    // rival's own turn, so a shallow deficit just gets borrowed away.
    const seen: string[] = []
    for (let round = 0; round < RESTRUCTURE_MAX + 1; round++) {
      const target = state.airlines[1]!
      target.cash = -50_000_000
      target.insolventQuarters = INSOLVENCY_QUARTERS_TO_FAIL - 1
      // Keep the other RIVALS too poor to rescue it: a distressed airline is
      // a consolidation target, and an acquisition would end it before
      // restructuring ever got its turn. The player seat stays funded — a
      // broke player ends the whole game before the third round lands.
      for (const other of state.airlines) if (other.id !== 0 && other.id !== 1) other.cash = 0
      state.airlines[0]!.cash = 500_000
      const r = applyCommand(state, { type: 'end_quarter' })
      state = r.state
      for (const e of r.events) {
        if (e.type === 'airline_restructured' && e.airline === 1) seen.push('restructured')
        if (e.type === 'airline_bankrupt' && e.airline === 1) seen.push('bankrupt')
      }
    }
    expect(seen.filter((s) => s === 'restructured')).toHaveLength(RESTRUCTURE_MAX)
    expect(seen).toContain('bankrupt')
    // Restructuring is a haircut, not a gift: debt is halved, not erased.
    expect(state.airlines[1]!.restructures).toBe(RESTRUCTURE_MAX)
  })

  it('an empty seat draws a new entrant instead of leaving a one-airline world', () => {
    let state = newGame('jet_age', 'entrant-seed')
    const founders = state.airlines.length
    // Kill a rival outright (past its restructuring chances).
    state.airlines[1]!.restructures = RESTRUCTURE_MAX
    state.airlines[1]!.cash = -50_000_000
    state.airlines[1]!.insolventQuarters = INSOLVENCY_QUARTERS_TO_FAIL - 1
    state = applyCommand(state, { type: 'end_quarter' }).state
    expect(state.airlines[1]!.bankrupt).toBe(true)

    let entered: { name: string; hq: string } | null = null
    for (let q = 0; q < ENTRANT_EVERY_QUARTERS * 2 && entered === null; q++) {
      const r = applyCommand(state, { type: 'end_quarter' })
      state = r.state
      for (const e of r.events) if (e.type === 'airline_entered') entered = { name: e.name, hq: e.hq }
    }
    expect(entered, 'a new carrier took the empty seat').not.toBeNull()
    // The seat is RECYCLED — the field never accumulates corpses.
    expect(state.airlines).toHaveLength(founders)
    expect(state.airlines[1]!.bankrupt).toBe(false)
    expect(state.airlines[1]!.name).toBe(entered!.name)
    expect(state.airlines[1]!.enteredTurn).toBeGreaterThan(0)
  })

  it('the player is never restructured — bankruptcy still ends the career', () => {
    let state = newGame('jet_age', 'player-death-seed')
    state.airlines[0]!.cash = -50_000_000
    state.airlines[0]!.insolventQuarters = INSOLVENCY_QUARTERS_TO_FAIL - 1
    const r = applyCommand(state, { type: 'end_quarter' })
    state = r.state
    expect(r.events.some((e) => e.type === 'airline_restructured' && e.airline === 0)).toBe(false)
    expect(state.phase).toBe('lost')
  })
})
