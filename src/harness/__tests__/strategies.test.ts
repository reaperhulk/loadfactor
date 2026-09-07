import { expect, it } from 'vitest'
import { runCareer } from '../simulate'
import { pacingMetrics } from '../pacing'
it('supports distinct commercial doctrines with surviving networks and measurable decision/race histories', () => {
  const results=(['premium','budget','connector'] as const).map(bot=>runCareer('jet_age','strategy-v4-0',bot,40))
  for(const result of results) {
    expect(result.summary.turn).toBe(40)
    expect(result.summary.routes).toBeGreaterThanOrEqual(3)
    const metrics=pacingMetrics(result)
    expect(metrics.actionTypes).toBeGreaterThan(5)
    expect(metrics.repeatedProposals).toBeLessThan(metrics.proposedActions)
    expect(metrics.competitiveQuarters).toBeGreaterThan(0)
  }
  expect(results[0]!.state.airlines[0]!.customerPreference!.business).toBeGreaterThan(results[1]!.state.airlines[0]!.customerPreference!.business)
  expect(results[1]!.state.airlines[0]!.customerPreference!.budget).toBeGreaterThan(results[0]!.state.airlines[0]!.customerPreference!.budget)
  expect(results[2]!.state.airlines[0]!.hubMode).toBe('banked')
})
