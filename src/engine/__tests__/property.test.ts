// Property-based chaos (PLAN.md §5.4): random command sequences — valid or
// garbage — must never throw, and every invariant must hold after every step.

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { hashState } from '../../harness/hash'
import { CITY_IDS } from '../../data/cities'
import { AIRCRAFT } from '../../data/aircraft'
import { applyCommand, newGame, type Command } from '../index'
import { checkInvariants } from '../invariants'

const cityArb = fc.oneof(
  fc.constantFrom(...CITY_IDS),
  fc.constantFrom('XXX', 'JFK', ''), // sprinkle garbage and duplicates
)
const idArb = fc.integer({ min: -2, max: 30 })
const moneyArb = fc.integer({ min: -5000, max: 40000 })

const commandArb: fc.Arbitrary<Command> = fc.oneof(
  fc.record({
    type: fc.constant('open_route' as const),
    from: cityArb,
    to: cityArb,
    aircraftId: idArb,
    frequency: fc.integer({ min: -3, max: 60 }),
  }),
  fc.record({
    type: fc.constant('open_route' as const),
    from: cityArb,
    to: cityArb,
    aircraftId: idArb,
    frequency: fc.integer({ min: -3, max: 60 }),
    fareLevel: fc.integer({ min: -4, max: 4 }),
    serviceLevel: fc.integer({ min: 0, max: 5 }),
  }),
  fc.record({
    type: fc.constant('set_frequency' as const),
    routeId: idArb,
    frequency: fc.integer({ min: -3, max: 60 }),
  }),
  fc.record({ type: fc.constant('close_route' as const), routeId: idArb }),
  fc.record({ type: fc.constant('set_fare' as const), routeId: idArb, fareLevel: fc.integer({ min: -4, max: 4 }) }),
  fc.record({
    type: fc.constant('set_service' as const),
    routeId: idArb,
    serviceLevel: fc.integer({ min: 0, max: 5 }),
  }),
  fc.record({
    type: fc.constant('assign_aircraft' as const),
    aircraftId: idArb,
    routeId: fc.oneof(idArb, fc.constant(null)),
  }),
  fc.record({
    type: fc.constant('order_aircraft' as const),
    aircraftType: fc.constantFrom(...AIRCRAFT.map((a) => a.id), 'bogus'),
  }),
  fc.record({
    type: fc.constant('lease_aircraft' as const),
    aircraftType: fc.constantFrom(...AIRCRAFT.map((a) => a.id), 'bogus'),
  }),
  fc.record({ type: fc.constant('buy_used' as const), offerId: fc.integer({ min: -5, max: 500 }) }),
  fc.record({ type: fc.constant('hedge_fuel' as const), quarters: fc.integer({ min: -2, max: 12 }) }),
  fc.record({
    type: fc.constant('refit_cabin' as const),
    aircraftId: idArb,
    cabin: fc.integer({ min: -1, max: 5 }),
  }),
  fc.record({ type: fc.constant('sell_aircraft' as const), aircraftId: idArb }),
  fc.record({ type: fc.constant('negotiate_slots' as const), city: cityArb, spend: moneyArb }),
  fc.record({ type: fc.constant('take_loan' as const), amount: moneyArb }),
  fc.record({ type: fc.constant('repay_loan' as const), loanId: idArb, amount: moneyArb }),
  fc.constant({ type: 'end_quarter' } as Command),
)

describe('engine under random command fire', () => {
  it('never throws, never breaks invariants, stays JSON-stable', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 8 }),
        fc.array(commandArb, { minLength: 1, maxLength: 80 }),
        (seed, commands) => {
          let state = newGame('jet_age', seed)
          for (const command of commands) {
            state = applyCommand(state, command).state
            checkInvariants(state)
          }
          // Round-trip stability at wherever we ended up.
          expect(hashState(JSON.parse(JSON.stringify(state)))).toBe(hashState(state))
        },
      ),
      { numRuns: 60 },
    )
  })

  it('rejected commands leave the state untouched', () => {
    fc.assert(
      fc.property(commandArb, (command) => {
        const state = newGame('jet_age', 'reject-seed')
        const before = hashState(state)
        const result = applyCommand(state, command)
        if (result.events.some((e) => e.type === 'command_rejected')) {
          expect(hashState(result.state)).toBe(before)
        }
      }),
      { numRuns: 200 },
    )
  })
})
