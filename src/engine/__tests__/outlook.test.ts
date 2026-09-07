import { expect, it } from 'vitest'
import { newGame } from '../index'
import { capitalOutlook } from '../outlook'
import { projectQuarter } from '../turn'
import { hashState } from '../../harness/hash'
import { forecastQuarter } from '../forecast'
import { networkRecommendations } from '../planning'
import { planningValue, type PlanningGoal } from '../planningGoals'

it('projects deliveries, replacements and debt without mutating inputs or peeking at future RNG', () => {
  const state = newGame('hub_defense','capital-contract'), before = hashState(state)
  const ac = state.airlines[0]!.fleet[0]!
  const commands = [{type:'order_replacement' as const,aircraftId:ac.id,aircraftType:ac.type,leased:true}]
  const result = capitalOutlook(state,0,commands,4)
  expect(result.errors).toHaveLength(0)
  expect(result.rows).toHaveLength(4)
  expect(result.rows[0]!.deliveries).toBe(1)
  expect(result.state.airlines[0]!.fleet.some(a=>a.id === ac.id)).toBe(false)
  expect(result.state.airlines[0]!.routes).toHaveLength(state.airlines[0]!.routes.length)
  expect(result.minCash).toBeLessThanOrEqual(result.cashAfter)
  expect(hashState(state)).toBe(before)
  expect(result.state.rng).toEqual(state.rng)
  const other = structuredClone(state); other.rng = newGame('hub_defense','different-hidden-future').rng
  expect(capitalOutlook(other,0,commands,4).rows).toEqual(result.rows)
})
it('reconciles projected cash with debt payments and rejects invalid capital plans', () => {
  const state = newGame('jet_age','outlook-finances')
  const result = capitalOutlook(state,0,[{type:'take_loan',amount:2000}],4)
  let cash = state.airlines[0]!.cash+2000
  for (const row of result.rows) { cash += row.stats.profit-(row.stats.debtPayment ?? 0); expect(row.stats.cash).toBe(cash) }
  expect(capitalOutlook(state,0,[{type:'order_aircraft',aircraftType:'missing'}],4).rows).toHaveLength(0)
  expect(projectQuarter(state).state.rng).toEqual(state.rng)
  expect(capitalOutlook(state,0,[],99).rows.length).toBeLessThanOrEqual(8)
})
it('scores all adviser goals on whole-network outcomes and honors a cash floor', () => {
  const state = newGame('hub_defense','goal-contract')
  const before = forecastQuarter(state,0)
  for (const goal of ['profit','pax','transfer','loadFactor','resilience','scenario'] as PlanningGoal[]) {
    const suggestions = networkRecommendations(state,0,{}, {goal,minCash:0})
    for (const s of suggestions) {
      const after = forecastQuarter(state,0,s.commands)
      expect(after.cashAfter).toBeGreaterThanOrEqual(0)
      expect(planningValue(state,0,after,goal)).toBeGreaterThan(planningValue(state,0,before,goal))
      expect(after.profit-before.profit).toBe(s.profitDelta)
    }
  }
  expect(networkRecommendations(state,0,{}, {goal:'pax',minCash:1e12})).toEqual([])
})
