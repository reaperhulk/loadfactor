import { expect, it } from 'vitest'
import { newGame } from '../index'
import { passengerFlows } from '../flows'
import { forecastQuarter } from '../forecast'
import { operationsBoard } from '../operationsBoard'
import { resolveOperations, type OperationsWeek } from '../operations'
import { hashState } from '../../harness/hash'

it('traces actual allocated journeys without double-counting connecting passengers', () => {
  const state=newGame('hub_defense','flow-conservation'), before=hashState(state), result=passengerFlows(state,0)
  const forecast=forecastQuarter(state,0)
  expect(result.own.some(c=>c.via!==null)).toBe(true)
  expect(result.boardings).toBe(forecast.routes.reduce((n,r)=>n+r.lastPax,0))
  expect(result.journeys).toBe(result.boardings-forecast.routes.reduce((n,r)=>n+r.lastTransferPax,0)/2)
  for(const market of result.markets) {
    expect(market.choices.reduce((n,c)=>n+c.journeys,0)).toBe(market.carried)
    expect(market.carried).toBeLessThanOrEqual(market.demand)
  }
  expect(hashState(state)).toBe(before)
})
it('calendar annotations leave dispatch identical and reconcile completed, covered and cancelled flights', () => {
  const state=newGame('hub_defense','calendar-contract'), airline=state.airlines[0]!, ac=airline.fleet[0]!
  ac.operations!.checkStart=0; ac.operations!.checkEnd=7*24*60
  const before=hashState(state), calendar:OperationsWeek[]=[]
  expect(resolveOperations(state,airline,'forecast',undefined,calendar)).toEqual(resolveOperations(state,airline,'forecast'))
  const board=operationsBoard(state,0)
  expect(calendar).toHaveLength(airline.fleet.length*13)
  expect(calendar.reduce((n,w)=>n+w.completed,0)).toBe(board.summary.completedTrips)
  expect(calendar.reduce((n,w)=>n+w.covered,0)).toBe(board.summary.coveredTrips)
  expect(calendar.reduce((n,w)=>n+w.cancelled,0)).toBeLessThanOrEqual(board.summary.cancelledTrips)
  expect(board.gaps.every(r=>r.reasons.length>0)).toBe(true)
  expect(hashState(state)).toBe(before)
})

it('explains constrained cover already based at either endpoint without a self-distance lookup', () => {
  const state=newGame('hub_defense','endpoint-cover'),airline=state.airlines[0]!,route=airline.routes[0]!,source=airline.fleet.find(a=>a.routeId===route.id)!
  airline.fleet.push({...structuredClone(source),id:airline.nextId++,routeId:null,reserve:true})
  for(const aircraft of airline.fleet) {aircraft.operations!.checkStart=0;aircraft.operations!.checkEnd=7*24*60}
  for(const base of [route.from,route.to]) {
    airline.fleet.at(-1)!.operations!.base=base
    const board=operationsBoard(state,0)
    expect(board.gaps.some(g=>g.routeId===route.id && g.reasons.some(r=>r.startsWith('Nearby compatible aircraft')))).toBe(true)
  }
})
