import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { approvedPlan, dispatch, exportCurrentCareer, getSession, importSave, passSeat, reset, resumeSave, startGame } from '../session'
import { comparePlan, readApprovedPlans } from '../planReview'
import { hashState } from '../../harness/hash'
beforeEach(() => {
  const data = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => data.set(k, v), removeItem: (k: string) => data.delete(k) })
})
afterEach(() => { reset(); vi.unstubAllGlobals() })
it('saves approved expectations, reconciles every profit difference and restores them on import', () => {
  startGame('hub_defense', 'approved-expectations')
  dispatch({ type: 'end_quarter' })
  const plan = approvedPlan(0)!, s = getSession()!
  const comparison = comparePlan(plan, s.state.airlines[0]!.history[0]!, s.reportEvents)
  expect(comparison.movements.reduce((n, r) => n + r.delta, 0)).toBe(comparison.profitDelta)
  const before = hashState(s.state), exported = exportCurrentCareer()!
  reset()
  expect(importSave(exported, 0)).toBe(true)
  expect(resumeSave(0)).toBe(true)
  expect(approvedPlan(0)).toEqual(plan)
  expect(hashState(getSession()!.state)).toBe(before)
})
it('keeps each hot-seat forecast at the point that player handed over', () => {
  startGame('jet_age', 'approved-hotseat', undefined, undefined, 2)
  expect(passSeat()).toBe(true)
  const first = approvedPlan(0, 0)!
  dispatch({ type: 'set_marketing', level: 3 })
  dispatch({ type: 'end_quarter' })
  expect(approvedPlan(0, 0)).toEqual(first)
  expect(approvedPlan(0, 1)?.seat).toBe(1)
  reset(); expect(resumeSave(0)).toBe(true)
  expect(approvedPlan(0, 0)).toEqual(first)
})
it('ignores malformed optional metadata while preserving old careers', () => {
  expect(readApprovedPlans([null, {}, { turn: 0, seat: 50 }])).toEqual([])
  startGame('jet_age', 'old-no-forecast')
  const save = JSON.parse(exportCurrentCareer()!)
  delete save.approvedPlans
  reset(); expect(importSave(JSON.stringify(save), 0)).toBe(true)
  expect(resumeSave(0)).toBe(true)
  expect(approvedPlan(0)).toBeUndefined()
})
