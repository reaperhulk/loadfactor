import { afterEach, describe, expect, it } from 'vitest'
import { hashState } from '../../harness/hash'
import { balancedScheduleCommands } from '../assign'
import {
  canUndo,
  dispatch,
  dispatchBatch,
  getSession,
  reset,
  startGame,
  undoLastAction,
} from '../session'

afterEach(reset)

describe('reversible planning', () => {
  it('undoes one command without changing the career baseline', () => {
    startGame('jet_age', 'undo-one')
    const before = hashState(getSession()!.state)
    dispatch({ type: 'set_marketing', level: 3 })
    expect(canUndo()).toBe(true)
    expect(getSession()!.state.airlines[0]!.marketing).toBe(3)
    expect(undoLastAction()).toBe(true)
    expect(hashState(getSession()!.state)).toBe(before)
    expect(canUndo()).toBe(false)
  })

  it('undoes a multi-command intent as one action', () => {
    startGame('jet_age', 'undo-batch')
    const before = hashState(getSession()!.state)
    dispatchBatch([
      { type: 'set_marketing', level: 1 },
      { type: 'set_marketing', level: 2 },
    ])
    expect(getSession()!.state.airlines[0]!.marketing).toBe(2)
    expect(undoLastAction()).toBe(true)
    expect(hashState(getSession()!.state)).toBe(before)
  })

  it('locks undo after a quarter resolves', () => {
    startGame('jet_age', 'undo-quarter')
    dispatch({ type: 'set_marketing', level: 1 })
    dispatch({ type: 'end_quarter' })
    expect(canUndo()).toBe(false)
  })
})

describe('schedule delegation', () => {
  it('produces only valid schedule changes and commits them as one undo step', () => {
    startGame('jet_age', 'balance-schedules')
    const initial = getSession()!.state
    const aircraft = initial.airlines[0]!.fleet[0]!
    dispatch({
      type: 'open_route',
      from: initial.airlines[0]!.hq,
      to: 'ORD',
      aircraftId: aircraft.id,
      frequency: 1,
    })
    const beforeBalance = hashState(getSession()!.state)
    const commands = balancedScheduleCommands(getSession()!.state, 0)
    expect(commands.length).toBeGreaterThan(0)
    dispatchBatch(commands)
    expect(getSession()!.lastEvents.every((event) => event.type !== 'command_rejected')).toBe(true)
    expect(undoLastAction()).toBe(true)
    expect(hashState(getSession()!.state)).toBe(beforeBalance)
  })
})
