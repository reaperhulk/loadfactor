// Headless careers: a bot plays the scenario turn by turn through the public
// engine surface — exactly the API the UI uses. Checkpoint hashes feed the
// golden tests; summaries feed the balance envelope.

import { applyCommandBatch, newGame } from '../engine'
import { checkInvariants } from '../engine/invariants'
import { netWorth } from '../engine/queries'
import type { Command, GameState } from '../engine/types'
import { botCommands, type BotName } from './bots'
import { hashState } from './hash'

export interface CareerResult {
  state: GameState
  commandLog: Command[]
  checkpointHashes: Record<number, string> // turn → hash, every 10 quarters
  summary: {
    turn: number
    phase: string
    cash: number
    netWorth: number
    routes: number
    fleet: number
    quarterlyProfit: number
  }
}

export function runCareer(
  scenarioId: string,
  seed: string,
  bot: BotName,
  maxQuarters: number,
  rulesVersion?: number,
): CareerResult {
  let state = newGame(scenarioId, seed, undefined, undefined, rulesVersion)
  const commandLog: Command[] = []
  const checkpointHashes: Record<number, string> = {}

  for (let q = 0; q < maxQuarters && state.phase === 'planning'; q++) {
    const commands = [...botCommands(state, bot), { type: 'end_quarter' } as const]
    state = applyCommandBatch(state, commands).state
    commandLog.push(...commands)
    checkInvariants(state)
    if (state.turn % 10 === 0) checkpointHashes[state.turn] = hashState(state)
  }

  const player = state.airlines[0]!
  const lastStats = player.history[player.history.length - 1]
  return {
    state,
    commandLog,
    checkpointHashes,
    summary: {
      turn: state.turn,
      phase: state.phase,
      cash: player.cash,
      netWorth: netWorth(player),
      routes: player.routes.length,
      fleet: player.fleet.length,
      quarterlyProfit: lastStats ? lastStats.profit : 0,
    },
  }
}
