// The incursion alert must carry the player's route id for that pair so the
// toast can open the battle card — an alert you can act on, not just read.

import { describe, expect, it } from 'vitest'
import { applyCommand, newGame } from '../../engine'
import type { GameEvent } from '../../engine'
import { decideWithin, eventImpact, toastsFor } from '../toasts'

function stateWithRoute() {
  let state = newGame('jet_age', 'toast-test')
  const idle = state.airlines[0]!.fleet.find((a) => a.routeId === null)!
  state = applyCommand(state, {
    type: 'open_route',
    from: 'JFK',
    to: 'ORD',
    aircraftId: idle.id,
    frequency: 5,
  }).state
  return state
}

describe('incursion toasts', () => {
  it('attaches my route id when a rival moves onto my pair', () => {
    const state = stateWithRoute()
    const myRouteId = state.airlines[0]!.routes[0]!.id
    const events: GameEvent[] = [
      { type: 'route_opened', airline: 1, routeId: 999, from: 'ORD', to: 'JFK' },
    ]
    const toasts = toastsFor(events, state)
    expect(toasts).toHaveLength(1)
    expect(toasts[0]!.icon).toBe('⚔️')
    expect(toasts[0]!.routeId).toBe(myRouteId)
    expect(toasts[0]!.text).toContain(state.airlines[1]!.name)
  })

  it('gives my own openings no battle link and ignores rival pairs I do not fly', () => {
    const state = stateWithRoute()
    const events: GameEvent[] = [
      { type: 'route_opened', airline: 0, routeId: 1, from: 'JFK', to: 'ORD' },
      { type: 'route_opened', airline: 1, routeId: 998, from: 'LAX', to: 'SFO' },
    ]
    const toasts = toastsFor(events, state)
    expect(toasts).toHaveLength(1) // only my own celebration toast
    expect(toasts[0]!.kind).toBe('route')
    expect(toasts[0]!.routeId).toBeUndefined()
  })

  it('a rival absorbing another rival is market news; my own deal is a victory', () => {
    const state = stateWithRoute()
    const consolidation: GameEvent[] = [
      { type: 'rival_acquired', airline: 1, target: 2, price: 5000, aircraft: 3, routes: 2 },
    ]
    const news = toastsFor(consolidation, state)
    expect(news).toHaveLength(1)
    expect(news[0]!.kind).toBe('event')
    expect(news[0]!.text).toContain(state.airlines[1]!.name)
    expect(news[0]!.text).toContain(state.airlines[2]!.name)

    const myDeal: GameEvent[] = [
      { type: 'rival_acquired', airline: 0, target: 1, price: 5000, aircraft: 3, routes: 2 },
    ]
    const cheer = toastsFor(myDeal, state)
    expect(cheer).toHaveLength(1)
    expect(cheer[0]!.kind).toBe('victory')
    expect(cheer[0]!.text).toContain(state.airlines[1]!.name)
  })
})

describe('rules 6 news', () => {
  it('an announced event says when it lands and what it will do', () => {
    const toasts = toastsFor([{ type: 'world_event_announced', eventId: 'oil_shock', city: null, region: null, startsTurn: 5 }], stateWithRoute())
    expect(toasts).toHaveLength(1)
    expect(toasts[0]!.text).toBe('Next quarter: Oil shock (fuel +75%, demand −6%, 6q)')
    expect(eventImpact('conflict')).toBe('demand there −50%, 4q')
  })

  it('offers count the planning quarters left, including this one', () => {
    const state = stateWithRoute()
    expect(decideWithin(state.turn, state)).toBe('decide this quarter')
    expect(decideWithin(state.turn + 3, state)).toBe('decide within 4 quarters')
    const toast = toastsFor([{ type: 'offer_made', offerId: 1, kind: 'airlift_contract', headline: 'Airlift?', expiresTurn: state.turn }], state)[0]!
    expect(toast.text).toBe('Airlift? — decide this quarter')
  })

  it('funded terminals and airlifts are the player\'s own news only', () => {
    const state = stateWithRoute()
    const mine = toastsFor([{ type: 'terminal_funded', airline: 0, city: 'LHR', cost: 100, slots: 2, opensTurn: 1 }, { type: 'airlift_flown', airline: 0, city: 'JFK', trips: 40 }], state)
    expect(mine.map((t) => t.icon)).toEqual(['🏗️', '🛩️'])
    expect(toastsFor([{ type: 'terminal_funded', airline: 1, city: 'LHR', cost: 100, slots: 2, opensTurn: 1 }], state)).toHaveLength(0)
  })
})
