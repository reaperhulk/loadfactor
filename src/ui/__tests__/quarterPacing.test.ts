import { expect, it } from 'vitest'
import { newGame, endQuarter } from '../../engine'
import { needsFullReport } from '../quarterPacing'
it('keeps quiet reports concise but never hides first quarters, losses, disruptions or decisions', () => {
  let state=newGame('hub_defense','pacing')
  state=endQuarter(state).state
  expect(needsFullReport(state,[],0)).toBe(true)
  state.turn=6
  const stats=state.airlines[0]!.history[0]!
  stats.profit=1000; stats.cash=10000; if(stats.operations)stats.operations.cancelledTrips=0
  state.airlines[0]!.history=[{...stats,turn:4},{...stats,turn:5}];state.world.offers=[]
  expect(needsFullReport(state,[],0)).toBe(false)
  expect(needsFullReport(state,[{type:'offer_made',offerId:1,kind:'fuel_contract',headline:'New choice',expiresTurn:7}],0)).toBe(true)
  expect(needsFullReport(state,[{type:'aircraft_delivered',airline:0,aircraftId:1,aircraftType:'dc8'}],0)).toBe(true)
  state.airlines[0]!.history[1]!.profit=-1
  expect(needsFullReport(state,[],0)).toBe(true)
})
