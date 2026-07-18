// Dev/e2e hooks (CLAUDE.md “Browser playtesting”): everything the Playwright
// suite or a console session needs to drive the game deterministically.

import type { Command, GameEvent, GameState, Replay } from '../engine'
import { dispatch, getReplay, getSession, reset, startGame } from './session'

export interface Harness {
  getState(): GameState | null
  dispatch(command: Command): GameEvent[]
  endQuarter(): GameEvent[]
  newGame(scenarioId: string, seed: string): void
  getReplay(): Replay | null
  reset(): void
}

export function installHarness(): void {
  const harness: Harness = {
    getState: () => getSession()?.state ?? null,
    dispatch: (command) => dispatch(command),
    endQuarter: () => dispatch({ type: 'end_quarter' }),
    newGame: (scenarioId, seed) => startGame(scenarioId, seed),
    getReplay: () => getReplay(),
    reset: () => reset(),
  }
  ;(window as unknown as { __harness: Harness }).__harness = harness
}
