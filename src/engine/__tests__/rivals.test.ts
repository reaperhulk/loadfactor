import { describe, expect, it } from 'vitest'
import { getCity } from '../../data/cities'
import {
  ENTRANT_EVERY_QUARTERS,
  ENTRANT_EVERY_QUARTERS_V5,
  INSOLVENCY_QUARTERS_TO_FAIL,
  RESTRUCTURE_MAX,
} from '../../data/constants'
import { chooseCampaign } from '../campaigns'
import { applyCommand, endQuarter, newGame, type GameEvent } from '../index'
import { slotRequestCommands, yieldCommands } from '../policy'
import { slotFee } from '../slots'
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

  it('a rival takes a place in the line and waits there rather than re-shopping', () => {
    const state = newGame('jet_age', 'queue-seed')
    const rival = state.airlines[1]!
    rival.cash = 500_000
    const events: GameEvent[] = []
    runRivalTurn(state, 1, events) // announces
    runRivalTurn(state, 1, events) // joins the list it announced
    const req = rival.slotRequests[0]
    expect(req, 'the rival is on a waiting list').toBeDefined()
    expect(req!.city).toBe(rival.slotInterest)
    expect(req!.fee).toBe(slotFee(req!.city))
    // Another quarter without capacity must not shuffle it to a new airport:
    // the place in line IS the investment.
    runRivalTurn(state, 1, events)
    expect(rival.slotRequests.map((r) => r.city)).toEqual([req!.city])
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
      slotBudgetBp: 10000,
      raidBonus: 0,
      homeRegionUntil: 0,
    }
    const roam = slotRequestCommands(opened, 0, dials)
    const home = slotRequestCommands(opened, 0, { ...dials, homeRegionUntil: 10 })
    expect(home).toHaveLength(1)
    if (home[0]!.type === 'request_slots') {
      expect(getCity(home[0]!.city).region).toBe(getCity(opened.airlines[0]!.hq).region)
    }
    expect(roam).toHaveLength(1)
  })

  // F4: a rival's slot campaign is declared state, not a decision taken
  // inside a pass nobody can watch. The player reads `slotInterest` during
  // planning and can take a place in that line first — so it has to be
  // honest about what the rival will actually do.
  it('a rival announces the authority it will court, then queues exactly there', () => {
    const state = newGame('jet_age', 'intent-seed')
    const rival = state.airlines[1]!
    const events: GameEvent[] = []
    runRivalTurn(state, 1, events)
    const announced = rival.slotInterest
    expect(announced).toBeDefined()
    expect(rival.slotRequests.map((r) => r.city)).toEqual([announced])

    // The campaign is binding across quarters: drop the request as if the
    // list had moved on, and the rival returns to the SAME city rather than
    // chasing whatever now scores highest.
    rival.slotRequests = []
    runRivalTurn(state, 1, events)
    expect(rival.slotRequests.map((r) => r.city)).toEqual([announced])
    expect(rival.slotInterest).toBe(announced)

    // Once the slots are held the campaign is over and the next one is named.
    rival.slotRequests = []
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

// Rules 5 rivals open the game already flying; these probes want a blank one.
function idle<T extends { routes: unknown[]; fleet: { routeId: number | null; secondaryRouteId?: number }[]; campaign?: unknown; slotRequests: unknown[]; slotInterest?: string; servedUntil: Record<string, number> }>(rival: T): T {
  rival.routes = []
  for (const ac of rival.fleet) { ac.routeId = null; delete ac.secondaryRouteId }
  delete rival.campaign
  rival.slotRequests = []
  delete rival.slotInterest
  rival.servedUntil = {}
  return rival
}

describe('rules 5: a race, not a procession', () => {
  it('rivals are already flying when the player arrives', () => {
    const state = newGame('jet_age', 'opening-seed')
    for (const rival of state.airlines.filter((a) => a.controller === 'rival')) {
      expect(rival.routes.length, rival.name).toBeGreaterThanOrEqual(1)
      expect(rival.campaign, rival.name).toBeDefined()
    }
    expect(state.airlines[0]!.routes).toHaveLength(0)
    expect(state.turn).toBe(0)
    // Legacy openings stay empty, and a human seat is never moved.
    const legacy = newGame('jet_age', 'opening-seed', undefined, undefined, 4)
    expect(legacy.airlines.every((a) => a.routes.length === 0)).toBe(true)
    const hotseat = newGame('jet_age', 'opening-seed', undefined, [1])
    expect(hotseat.airlines[1]!.routes).toHaveLength(0)
    expect(hotseat.airlines[2]!.routes.length).toBeGreaterThanOrEqual(1)
  })

  it('a rival opens a second market with an idle airframe instead of parking it on the first route', () => {
    for (const [rules, expectedRoutes] of [[4, 1], [5, 2]] as const) {
      let state = newGame('jet_age', 'launch-order', undefined, undefined, rules)
      const rival = state.airlines[2]! // Pacific Crown: HND with HKG/SEL/PEK footholds
      rival.cash = 60_000
      runRivalTurn(state, rival.id, [])
      expect(state.airlines[2]!.routes.length).toBe(1)
      state = endQuarter(state).state
      // A third airframe arrives idle; under the old stage order assignment
      // ate it before the launch stage ever ran.
      const again = state.airlines[2]!
      again.fleet.push({ id: again.nextId++, type: 'caravelle', ageQuarters: 0, routeId: null, leased: false, cabin: 2 })
      again.cash = 60_000
      runRivalTurn(state, again.id, [])
      expect(state.airlines[2]!.routes.length, `rules ${rules}`).toBe(expectedRoutes)
    }
  })

  it('a raid names the leader\'s best reachable market, then opens it at a discount', () => {
    const state = newGame('jet_age', 'raid-seed')
    const player = state.airlines[0]!
    const rival = idle(state.airlines[1]!) // Albion, premium: raids with full service at the standard fare
    player.cash = 400_000
    player.routes.push({ id: player.nextId++, from: 'JFK', to: 'ORD', fareLevel: 0, serviceLevel: 2, frequency: 10, lastPax: 30_000, lastCapacity: 32_000, lastLoadFactorBp: 9375, lastRevenue: 9_000, lastCost: 5_000, lastTransferPax: 0, history: [] })
    rival.cash = 80_000
    rival.slots['JFK'] = 2
    rival.slots['ORD'] = 2
    rival.routes.push({ id: rival.nextId++, from: 'JFK', to: 'LHR', fareLevel: 1, serviceLevel: 3, frequency: 4, lastPax: 5000, lastCapacity: 8000, lastLoadFactorBp: 6250, lastRevenue: 4000, lastCost: 3000, lastTransferPax: 0, history: [] })
    rival.fleet[0]!.routeId = rival.routes[0]!.id
    const campaign = chooseCampaign(state, rival.id)
    expect(campaign.kind).toBe('raid')
    expect(campaign.pair).toBe('JFK-ORD')
    expect(campaign.target).toBe(0)
    expect(campaign.evidence).toContain('JFK–ORD')
    rival.campaign = { ...campaign, fromTurn: state.turn }
    const events: GameEvent[] = []
    runRivalTurn(state, rival.id, events)
    const raid = state.airlines[1]!.routes.find((r) => r.from === 'JFK' && r.to === 'ORD')
    expect(raid, 'the raid opened the market').toBeDefined()
    expect(raid!.serviceLevel).toBe(3)
    expect(events.some((e) => e.type === 'route_opened' && e.airline === 1)).toBe(true)
    // A rival that already flies the pair does not raid it twice.
    expect(chooseCampaign(state, rival.id).pair).not.toBe('JFK-ORD')
  })

  it('a raid queues for the airport it still needs before anything else', () => {
    const state = newGame('jet_age', 'raid-queue')
    const player = state.airlines[0]!, rival = idle(state.airlines[1]!)
    player.cash = 400_000
    player.routes.push({ id: player.nextId++, from: 'JFK', to: 'ORD', fareLevel: 0, serviceLevel: 2, frequency: 10, lastPax: 30_000, lastCapacity: 32_000, lastLoadFactorBp: 9375, lastRevenue: 9_000, lastCost: 5_000, lastTransferPax: 0, history: [] })
    rival.cash = 80_000
    rival.slots['JFK'] = 2 // reaches New York, but not Chicago
    rival.routes.push({ id: rival.nextId++, from: 'JFK', to: 'LHR', fareLevel: 1, serviceLevel: 3, frequency: 4, lastPax: 5000, lastCapacity: 8000, lastLoadFactorBp: 6250, lastRevenue: 4000, lastCost: 3000, lastTransferPax: 0, history: [] })
    rival.fleet[0]!.routeId = rival.routes[0]!.id
    const campaign = chooseCampaign(state, rival.id)
    expect(campaign.kind).toBe('raid')
    expect(campaign.city).toBe('ORD')
    expect(campaign.untilTurn - campaign.fromTurn).toBeGreaterThan(4)
    rival.campaign = { ...campaign, fromTurn: state.turn }
    runRivalTurn(state, rival.id, [])
    expect(state.airlines[1]!.slotInterest).toBe('ORD')
    expect(state.airlines[1]!.slotRequests.some((r) => r.city === 'ORD')).toBe(true)
  })

  it('a late entrant is capitalized against the field, and a dominant leader draws a state-backed carrier', () => {
    const seat = (state: ReturnType<typeof newGame>, cash: number, seed: string) => {
      const s = structuredClone(state)
      s.turn = ENTRANT_EVERY_QUARTERS_V5 // the seat is filled on the cadence tick
      s.seed = seed
      s.airlines[3]!.bankrupt = true
      s.airlines[3]!.routes = []; s.airlines[3]!.fleet = []; s.airlines[3]!.slots = {}
      s.airlines[0]!.cash = cash
      return s
    }
    const base = newGame('jet_age', 'entrant-capital')
    const modest = endQuarter(seat(base, 30_000, 'entrant-capital')).state
    const rich = endQuarter(seat(base, 900_000, 'entrant-capital')).state
    const entrantOf = (s: ReturnType<typeof newGame>) => s.airlines.find((a) => a.enteredTurn !== undefined)!
    expect(entrantOf(modest)).toBeDefined()
    expect(entrantOf(rich).cash + entrantOf(rich).fleet.length * 1000).toBeGreaterThan(entrantOf(modest).cash + entrantOf(modest).fleet.length * 1000)
    expect(entrantOf(rich).fleet.length).toBeGreaterThan(entrantOf(modest).fleet.length)
    expect(entrantOf(rich).name).toContain('state-backed')
    expect(entrantOf(modest).name).not.toContain('state-backed')
    // A rules-4 world still seats the old modest entrant.
    const legacy = endQuarter({ ...seat(newGame('jet_age', 'entrant-capital', undefined, undefined, 4), 900_000, 'entrant-capital'), turn: ENTRANT_EVERY_QUARTERS }).state
    expect(entrantOf(legacy).fleet.length).toBe(2)
    expect(entrantOf(legacy).name).not.toContain('state-backed')
  })
})
