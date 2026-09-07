import { expect, it } from 'vitest'
import { runCareer } from '../../harness/simulate'
import { resolveOperations } from '../operations'

it('aggregate operations exactly match timed dispatch, including allocation order and wear', () => {
  for (const scenario of ['jet_age', 'hub_defense']) for (const turn of [3, 12, 25]) {
    const state = runCareer(scenario, 'aggregate-contract', 'greedy', turn).state
    for (const airline of state.airlines.filter(a => !a.bankrupt)) {
      // An already-finished, free incident forces interval dispatch without
      // removing flying time or changing ending state. This is an oracle for
      // the aggregate path, not a second copy of its arithmetic.
      const past = airline.fleet.map(ac => ({ aircraftId: ac.id, start: -10, end: -5, cost: 0 }))
      expect(resolveOperations(state, airline, 'forecast')).toEqual(resolveOperations(state, airline, 'forecast', past))
    }
  }
})

it('mixed aggregate and timed recovery matches full temporal dispatch under simultaneous repairs', () => {
  const state = runCareer('jet_age', 'mixed-dispatch-contract', 'greedy', 25).state
  const airline = state.airlines[0]!
  airline.operationsPolicy!.recovery = true
  const start = state.turn * 131040
  const incidents = airline.fleet.slice(0, 3).map(ac => ({ aircraftId: ac.id, start: start + 40320, end: start + 44640, cost: 100 }))
  const past = airline.fleet.map(ac => ({ aircraftId: ac.id, start: -10, end: -5, cost: 0 }))
  expect(resolveOperations(state, airline, 'forecast', incidents)).toEqual(resolveOperations(state, airline, 'forecast', [...incidents, ...past]))
})
