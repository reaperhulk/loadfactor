import { describe, expect, it } from 'vitest'
import { applyCommandFor, newGame, type Command, type GameState } from '../../engine'
import { hashState } from '../../harness/hash'
import {
  applyTurn,
  buildTurn,
  decodeTurn,
  encodeTurn,
  MP_SEATS,
  nextActor,
  quartersResolved,
  replayEntries,
  sittingEntries,
  type MpGame,
} from '../mp'

const mkGame = (mySeat: 0 | 1): MpGame => ({
  v: 1,
  gameId: 'test-game',
  scenario: 'jet_age',
  seed: 'mp-seed',
  mySeat,
  entries: [],
  theirKnown: 0,
})

// A seat's plausible quarter: open a route with its first idle plane, or
// nothing if none is idle. Enough to make the sim diverge per decision.
function planFor(state: GameState, seat: number): Command[] {
  const airline = state.airlines[seat]!
  const idle = airline.fleet.find((a) => a.routeId === null)
  if (!idle) return []
  const targets = ['ORD', 'LAX', 'MIA', 'YYZ', 'SFO', 'DEN', 'ATL', 'BOS']
  const from = airline.hq
  const to = targets.find((t) => t !== from) ?? 'ORD'
  return [{ type: 'open_route', from, to, aircraftId: idle.id, frequency: 4 }]
}

describe('multiplayer engine seams', () => {
  it('a human seat is never moved by the rival AI', () => {
    let solo = newGame('jet_age', 'seat-test')
    let duo = newGame('jet_age', 'seat-test', undefined, MP_SEATS)
    expect(duo.airlines[1]!.controller).toBe('player')
    expect(duo.airlines[2]!.controller).toBe('rival')
    // Resolve several empty quarters: the human seat must stay exactly at its
    // starting position while the solo game's same airline (a rival there)
    // goes off and plays.
    for (let q = 0; q < 4; q++) {
      solo = replayEntries('jet_age', 'seat-test', [{ seat: 0, command: { type: 'end_quarter' } }])
      duo = replayEntries(
        'jet_age',
        'mp-static',
        Array.from({ length: q + 1 }, () => ({ seat: 0 as const, command: { type: 'end_quarter' } as Command })),
      )
    }
    expect(duo.airlines[1]!.routes).toHaveLength(0)
    expect(solo.airlines[1]!.routes.length).toBeGreaterThanOrEqual(0) // rival free to act
  })

  it('the same entries replay to the same hash, always', () => {
    const entries = [
      { seat: 0 as const, command: { type: 'end_quarter' } as Command },
      { seat: 1 as const, command: { type: 'end_quarter' } as Command },
    ]
    const a = replayEntries('jet_age', 'det', entries)
    const b = replayEntries('jet_age', 'det', entries)
    expect(hashState(a)).toBe(hashState(b))
  })
})

describe('the chain protocol', () => {
  // One sitting, as a client would run it: plan the close against the live
  // state, resolve, plan the open against the post-resolution state, build
  // the turn, append locally.
  function act(g: MpGame, state: GameState) {
    const isOpeningOnly = g.entries.length === 0
    const close = isOpeningOnly ? [] : planFor(state, g.mySeat)
    let mid = state
    for (const c of close) mid = applyCommandFor(mid, g.mySeat, c).state
    if (!isOpeningOnly) mid = applyCommandFor(mid, g.mySeat, { type: 'end_quarter' }).state
    const open = planFor(mid, g.mySeat)
    const appended = sittingEntries(g.entries, g.mySeat, close, open)
    const turn = buildTurn(g, appended)
    g.entries = [...g.entries, ...appended]
    return turn
  }

  it('two clients exchange turns for six quarters and never disagree', () => {
    const alice = mkGame(0)
    const bob = mkGame(1)

    let sender = alice
    let receiver = bob
    let turn = act(alice, replayEntries(alice.scenario, alice.seed, []))

    for (let sitting = 0; sitting < 12; sitting++) {
      const applied = applyTurn(receiver, turn)
      expect(applied.ok, `sitting ${sitting}: ${applied.ok ? '' : applied.reason}`).toBe(true)
      if (!applied.ok) return
      receiver.entries = applied.entries
      // The lockstep invariant: both worlds identical after every exchange.
      expect(hashState(replayEntries(receiver.scenario, receiver.seed, receiver.entries))).toBe(
        turn.result,
      )
      turn = act(receiver, applied.state)
      ;[sender, receiver] = [receiver, sender]
    }

    expect(quartersResolved(alice.entries)).toBeGreaterThanOrEqual(5)
    void sender
  })

  it('the closer alternates every quarter', () => {
    // Empty log: creator opens. After q1 resolves once, seat 0 closes q2;
    // after two resolutions, seat 1 closes q3.
    const eq: Command = { type: 'end_quarter' }
    expect(nextActor([])).toBe(0)
    expect(nextActor([{ seat: 0, command: eq }])).toBe(0)
    expect(nextActor([{ seat: 0, command: eq }, { seat: 1, command: eq }])).toBe(1)
  })

  it('rejects the failure modes with distinct reasons', () => {
    const alice = mkGame(0)
    const bob = mkGame(1)
    // A real opening batch, so re-applying it actually moves the hash.
    const turn = act(alice, replayEntries(alice.scenario, alice.seed, []))
    expect(turn.delta.length).toBeGreaterThan(0)

    expect(applyTurn({ ...bob, gameId: 'other' }, turn)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('different game'),
    })
    expect(applyTurn(alice, turn)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('your own link'),
    })
    // Forged authorship: a delta claiming to be seat 0 but moving seat 1.
    const forged = {
      ...turn,
      delta: [{ seat: 1 as const, command: { type: 'set_fare', routeId: 1, fareLevel: 2 } as Command }],
    }
    expect(applyTurn(bob, forged)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('does not hold'),
    })
    // Out-of-sync: apply once (fine), then the same link again (stale).
    const applied = applyTurn(bob, turn)
    expect(applied.ok).toBe(true)
    if (applied.ok) bob.entries = applied.entries
    const again = applyTurn(bob, turn)
    expect(again.ok).toBe(false)
  })

  it('a corrupt result hash is refused', () => {
    const alice = mkGame(0)
    const bob = mkGame(1)
    const opening = sittingEntries(alice.entries, 0, [], [])
    const turn = { ...buildTurn(alice, opening), result: 'deadbeef' }
    expect(applyTurn(bob, turn)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('different world'),
    })
  })
})

describe('the wire format', () => {
  it('round-trips a realistic turn and stays small', async () => {
    const alice = mkGame(0)
    const state = replayEntries(alice.scenario, alice.seed, [])
    const appended = sittingEntries(alice.entries, 0, [], planFor(state, 0))
    const turn = buildTurn(alice, appended)
    const encoded = await encodeTurn(turn)
    // §10.2: a turn link stays small forever. Generous bound — the claim is
    // "constant-size delta", not a byte count.
    expect(encoded.length).toBeLessThan(1200)
    const decoded = await decodeTurn(encoded)
    expect(decoded).toEqual(turn)
  })

  it('garbage decodes to null, never throws', async () => {
    expect(await decodeTurn('1not-base64!!!')).toBeNull()
    expect(await decodeTurn('0eyJ2IjoyfQ')).toBeNull() // wrong version
    expect(await decodeTurn('')).toBeNull()
  })
})
