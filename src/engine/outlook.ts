import { applyCommandBatchFor } from './index'
import { projectQuarter } from './turn'
import { getScenario } from '../data/scenarios'
import type { Command, GameState, QuarterStats } from './types'

export function capitalOutlook(previous: GameState, seat: number, commands: readonly Command[] = [], quarters = 4, adverse = false) {
  if (commands.some(c=>c.type === 'end_quarter')) throw new Error('Outlooks accept planning actions only')
  const applied = applyCommandBatchFor(previous, commands.map(command=>({seat,command})))
  const errors = applied.events.filter(e=>e.type === 'command_rejected')
  let state = structuredClone(applied.state)
  if (adverse) { state.world.fuelBp = Math.floor(state.world.fuelBp*12000/10000); state.world.economyBp = Math.floor(state.world.economyBp*9000/10000) }
  const rows: { stats: QuarterStats; deliveries: number; slots: number; commitments: number; endedContracts: number; hedgeExpires: boolean; fleet: number }[] = []
  let minCash = state.airlines[seat]!.cash, minTurn = state.turn
  const end = Math.min(previous.turn + Math.max(1, Math.min(8, Math.floor(quarters))), getScenario(previous.scenario).quarters)
  while (!errors.length && state.turn < end && state.phase === 'planning' && !state.airlines[seat]!.bankrupt) {
    const previousAirline = state.airlines[seat]!, oldContracts = previousAirline.deals?.length ?? 0, oldHedge = previousAirline.fuelHedge
    const next = projectQuarter(state); state = next.state
    const airline = state.airlines[seat]!, stats = airline.history.at(-1)!
    rows.push({ stats, fleet: airline.fleet.length,
      deliveries:next.events.filter(e=>e.type==='aircraft_delivered' && e.airline===seat).length,
      slots:next.events.filter(e=>e.type==='slots_granted' && e.airline===seat).length,
      commitments:airline.deals?.length ?? 0, endedContracts:Math.max(0,oldContracts-(airline.deals?.length ?? 0)), hedgeExpires:!!oldHedge && !airline.fuelHedge })
    if (stats.cash < minCash) { minCash = stats.cash; minTurn = stats.turn }
  }
  return { rows, minCash, minTurn, cashAfter:state.airlines[seat]!.cash, state, errors }
}
