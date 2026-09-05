import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashState } from '../../harness/hash'
import { runReplay } from '../../engine'
import { rulesOf, RULES_VERSION } from '../../engine/version'
import { dispatch, exportCurrentCareer, getReplay, getSession, getStorageWarning, importSave, passSeat, reset, resumeSave, startGame, undoLastAction, viewSeat } from '../session'

beforeEach(() => {
  const data = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
  })
})
afterEach(() => { reset(); vi.unstubAllGlobals() })

describe('career continuity', () => {
  it('versions exports, replays both human seats and restores the active planner', () => {
    startGame('jet_age', 'portable-hotseat', undefined, undefined, 2)
    dispatch({ type: 'set_marketing', level: 1 })
    expect(passSeat()).toBe(true)
    dispatch({ type: 'set_marketing', level: 2 })
    const hash = hashState(getSession()!.state)
    const exported = exportCurrentCareer()!
    expect(JSON.parse(exported).rulesVersion).toBe(RULES_VERSION)
    expect(hashState(runReplay(getReplay()!).state)).toBe(hash)
    reset()
    expect(importSave(exported, 1)).toBe(true)
    expect(resumeSave(1)).toBe(true)
    expect(viewSeat()).toBe(1)
    expect(hashState(getSession()!.state)).toBe(hash)
  })
  it('keeps unversioned logs on original rules and refuses unknown future versions', () => {
    expect(rulesOf({})).toBe(1)
    expect(() => rulesOf({ rulesVersion: 999 })).toThrow(/unsupported/)
    expect(importSave(JSON.stringify({ version: 1, rulesVersion: 999, seed: 'future', scenario: 'jet_age', commands: [] }), 0)).toBe(false)
  })
  it('keeps an export available when storage is full', () => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => { throw new Error('quota') } })
    startGame('jet_age', 'quota')
    expect(getStorageWarning()).toMatch(/Automatic saving failed/)
    expect(JSON.parse(exportCurrentCareer()!).seed).toBe('quota')
  })
  it('undo after resume preserves the resolved world and report archive', () => {
    startGame('jet_age', 'quarter-cache')
    for (let q = 0; q < 3; q++) dispatch({ type: 'end_quarter' })
    reset()
    expect(resumeSave(0)).toBe(true)
    const previous = getSession()!
    const hash = hashState(previous.state)
    dispatch({ type: 'set_marketing', level: 1 })
    dispatch({ type: 'set_marketing', level: 2 })
    expect(undoLastAction()).toBe(true)
    expect(getSession()!.state.airlines[0]!.marketing).toBe(1)
    expect(undoLastAction()).toBe(true)
    expect(hashState(getSession()!.state)).toBe(hash)
    expect(getSession()!.reportArchive).toEqual(previous.reportArchive)
  })
})
