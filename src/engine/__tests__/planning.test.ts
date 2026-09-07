import { expect, it } from 'vitest'
import { newGame } from '../index'
import { createForecastPlanner, forecastQuarter } from '../forecast'
import { routeRecommendations, routeSignals } from '../planning'
import { hashState } from '../../harness/hash'
it('diagnoses a working hub and quotes only valid full-network improvements', () => {
  const state = newGame('hub_defense', 'diagnosis-contract'), before = hashState(state)
  const evaluate = createForecastPlanner(state, 0)
  for (const route of state.airlines[0]!.routes) {
    expect(routeSignals(state, 0, route, evaluate).length).toBeGreaterThan(0)
    for (const suggestion of routeRecommendations(state, 0, route, evaluate)) {
      const after = forecastQuarter(state, 0, suggestion.commands)
      expect(after.errors).toHaveLength(0)
      expect(after.profit - evaluate().profit).toBe(suggestion.profitDelta)
      expect(suggestion.profitDelta).toBeGreaterThan(0)
    }
    expect(routeRecommendations(state, 0, route, evaluate, ['fare','service','frequency'], false)).toEqual([])
  }
  expect(hashState(state)).toBe(before)
})
