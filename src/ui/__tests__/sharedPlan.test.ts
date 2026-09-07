import { afterEach, expect, it, vi } from 'vitest'
import { applyCommandFor, newGame } from '../../engine'
import { clearPlanningDraft, commandKey, getPlanningCommands, removePlanningCommand, stagePlanningCommands } from '../planningDrafts'
import { applyPlanningDraft } from '../planActions'
import { dispatch, getSession, passSeat, reset, startGame, undoLastAction } from '../session'

afterEach(() => { reset(); clearPlanningDraft(); vi.unstubAllGlobals() })
function start(humans = 1) {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} })
  startGame('hub_defense', 'shared-plan', undefined, undefined, humans)
  return getSession()!.state.airlines[0]!.routes[0]!
}
it('merges edits from multiple surfaces, applies once, and undoes the exact combined plan', () => {
  const r = start(), before = JSON.stringify(getSession()!.state)
  stagePlanningCommands([{ type: 'set_fare', routeId: r.id, fareLevel: -1 }])
  stagePlanningCommands([{ type: 'set_service', routeId: r.id, serviceLevel: 3 }])
  stagePlanningCommands([{ type: 'set_fare', routeId: r.id, fareLevel: 2 }])
  expect(getPlanningCommands()).toHaveLength(2)
  expect(JSON.stringify(getSession()!.state)).toBe(before)
  expect(applyPlanningDraft()).toBe(true)
  expect(getPlanningCommands()).toHaveLength(0)
  expect(undoLastAction()).toBe(true)
  expect(JSON.stringify(getSession()!.state)).toBe(before)
})
it('rejects an invalid combined plan before any command reaches the simulation', () => {
  const r = start(), before = JSON.stringify(getSession()!.state)
  stagePlanningCommands([{ type: 'set_fare', routeId: r.id, fareLevel: 1 }, { type: 'set_frequency', routeId: r.id, frequency: 100000 }])
  expect(applyPlanningDraft()).toBe(false)
  expect(JSON.stringify(getSession()!.state)).toBe(before)
  expect(getPlanningCommands()).toHaveLength(2)
  removePlanningCommand(commandKey(getPlanningCommands()[1]!))
  expect(applyPlanningDraft()).toBe(true)
})
it('does not leak drafts into a new quarter, career, or player handover', () => {
  const r = start(2)
  stagePlanningCommands([{ type: 'set_fare', routeId: r.id, fareLevel: 1 }])
  expect(passSeat()).toBe(true)
  expect(getPlanningCommands()).toHaveLength(0)
  stagePlanningCommands([{ type: 'set_marketing', level: 1 }])
  dispatch({ type: 'end_quarter' })
  expect(getPlanningCommands()).toHaveLength(0)
  stagePlanningCommands([{ type: 'set_marketing', level: 1 }])
  start()
  expect(getPlanningCommands()).toHaveLength(0)
})
it('keeps competing launches separate so reusing the same aircraft is detected', () => {
  const s = newGame('jet_age', 'shared-launch')
  const commands = [{ type: 'open_route' as const, from: 'JFK', to: 'ORD', aircraftId: 1, frequency: 10 }, { type: 'open_route' as const, from: 'JFK', to: 'MIA', aircraftId: 1, frequency: 10 }]
  stagePlanningCommands(commands)
  expect(getPlanningCommands()).toHaveLength(2)
  const first = applyCommandFor(s, 0, commands[0]!)
  expect(applyCommandFor(first.state, 0, commands[1]!).events.some(e=>e.type === 'command_rejected')).toBe(true)
})
