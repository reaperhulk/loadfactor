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
