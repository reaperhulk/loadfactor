import { expect, it } from 'vitest'
import { applyCommand, newGame } from '../index'
import { createForecastPlanner, forecastQuarter } from '../forecast'
import { networkRecommendations, routeRecommendations, routeSignals } from '../planning'
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

import { expansionOptions } from '../expansion'
it('network advice obeys per-setting locks and validates each quoted improvement', () => {
  const state = newGame('hub_defense', 'advice-locks')
  const first = state.airlines[0]!.routes[0]!
  const locks = { [first.id]: ['fare', 'frequency', 'service'] as const }
  const suggestions = networkRecommendations(state, 0, { [first.id]: [...locks[first.id]!] })
  expect(suggestions.every(s => s.routeId !== first.id)).toBe(true)
  for (const suggestion of suggestions) expect(forecastQuarter(state, 0, suggestion.commands).profit - forecastQuarter(state, 0).profit).toBe(suggestion.profitDelta)
})
it('expansion quotes feasible aircraft and slots without borrowing or changing the plan', () => {
  const state = newGame('jet_age', 'expansion-contract'), before = hashState(state)
  const result = expansionOptions(state, 0)
  expect(result.options.length).toBeGreaterThan(0)
  for (const option of result.options) {
    const applied = applyCommand(state, option.command)
    expect(applied.events.some(e => e.type === 'command_rejected')).toBe(false)
    const after = forecastQuarter(state, 0, [option.command])
    expect(after.profit - forecastQuarter(state, 0).profit).toBe(option.profitDelta)
    expect(after.cashAfter).toBe(option.cashAfter)
  }
  expect(result.blocked.length).toBeGreaterThan(0)
  expect(hashState(state)).toBe(before)
})
