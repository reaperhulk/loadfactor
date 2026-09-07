// Headless careers: a bot plays the scenario turn by turn through the public
// engine surface — exactly the API the UI uses. Checkpoint hashes feed the
// golden tests; summaries feed the balance envelope.

import { applyCommandBatch, newGame } from '../engine'
import { checkInvariants } from '../engine/invariants'
import { getScenario } from '../data/scenarios'
import { netWorth, objectiveScore } from '../engine/queries'
import type { Command, GameState } from '../engine/types'
import { botCommands, type BotName } from './bots'
import { hashState } from './hash'

export interface CareerResult {
  race: {turn:number;leader:number;playerScore:number;leadingScore:number}[]
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
  const race:CareerResult['race']=[]
  const objective=getScenario(scenarioId).objective.kind
  const commandLog: Command[] = []
  const checkpointHashes: Record<number, string> = {}

  for (let q = 0; q < maxQuarters && state.phase === 'planning'; q++) {
    const commands = [...botCommands(state, bot), { type: 'end_quarter' } as const]
    state = applyCommandBatch(state, commands).state
    commandLog.push(...commands)
    checkInvariants(state)
    const leaders=state.airlines.filter(a=>!a.bankrupt).map(a=>({id:a.id,score:objectiveScore(a,objective)})).sort((a,b)=>b.score-a.score || a.id-b.id)
    race.push({turn:state.turn,leader:leaders[0]?.id??-1,leadingScore:leaders[0]?.score??0,playerScore:objectiveScore(state.airlines[0]!,objective)})
    if (state.turn % 10 === 0) checkpointHashes[state.turn] = hashState(state)
  }

  const player = state.airlines[0]!
  const lastStats = player.history[player.history.length - 1]
  return {
    state,
    race,
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
