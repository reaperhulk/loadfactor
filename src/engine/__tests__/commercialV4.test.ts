import { expect, it } from 'vitest'
import { newGame, endQuarter } from '../index'
import { updateCustomerIdentity } from '../customerIdentity'
import { chooseCampaign } from '../campaigns'
import { forecastQuarter } from '../forecast'
import { runRivalTurn } from '../rivals'
import type { GameEvent } from '../types'

it('earns a persistent, bounded identity from passengers carried and changes direction gradually', () => {
  const airline=newGame('hub_defense','identity').airlines[0]!
  for(const route of airline.routes) { route.lastPax=1000; route.fareLevel=1; route.serviceLevel=3; route.frequency=14 }
  updateCustomerIdentity(airline)
  const first=airline.customerPreference!.business
  for(let q=0;q<7;q++) updateCustomerIdentity(airline)
  expect(airline.customerPreference!.business).toBeGreaterThan(first)
  expect(airline.customerPreference!.budget).toBeLessThan(10000)
  const remembered=airline.customerPreference!.business
  for(const route of airline.routes) { route.fareLevel=-2; route.serviceLevel=1 }
  updateCustomerIdentity(airline)
  expect(airline.customerPreference!.business).toBeGreaterThan(10000)
  expect(airline.customerPreference!.business).toBeLessThan(remembered)
  for(let q=0;q<80;q++) updateCustomerIdentity(airline)
  expect(airline.customerPreference!.budget).toBeGreaterThan(10000)
  expect(Object.values(airline.customerPreference!).every(n=>n>=8500 && n<=11500)).toBe(true)
})
it('uses public evidence and honors recovery and price campaigns after generic policy decisions', () => {
  const state=newGame('hub_defense','response'), rival=state.airlines[1]!
  rival.cash=0
  expect(chooseCampaign(state,1).kind).toBe('recover')
  rival.campaign={...chooseCampaign(state,1),fromTurn:0}
  const orders=rival.orders.length, slots=rival.slotRequests.length, events:GameEvent[]=[]
  runRivalTurn(state,1,events)
  expect(rival.orders.length).toBeLessThanOrEqual(orders)
  expect(rival.slotRequests.length).toBeLessThanOrEqual(slots)
  expect(events.some(e=>e.type==='command_rejected')).toBe(false)
  const source=state.airlines[0]!.routes[0]!
  rival.routes=[structuredClone(source)]; rival.routes[0]!.lastPax=10; rival.routes[0]!.lastRevenue=1000; rival.routes[0]!.lastCost=100
  source.lastPax=100; rival.cash=100000
  expect(chooseCampaign(state,1).evidence).toContain('10 boardings')
  expect(['price','premium']).toContain(chooseCampaign(state,1).kind)
})
it('stores bounded actual journeys with exact boarding totals, and preserves them through JSON', () => {
  const before=newGame('hub_defense','actual-paths'), after=endQuarter(before).state, player=after.airlines[0]!
  const flows=player.passengerHistory!
  expect(flows.boardings).toBe(player.history.at(-1)!.pax)
  expect(flows.journeys).toBe(flows.boardings-player.history.at(-1)!.transferPax!/2)
  expect(flows.own.length).toBeLessThanOrEqual(64)
  expect(JSON.parse(JSON.stringify(after))).toEqual(after)
  expect(forecastQuarter(after,0)).toEqual(forecastQuarter(JSON.parse(JSON.stringify(after)),0))
  expect(before.airlines[0]!.customerPreference).toBeUndefined()
  const legacy=endQuarter(newGame('hub_defense','actual-paths',undefined,undefined,3)).state
  expect(legacy.airlines[0]!.customerPreference).toBeUndefined()
  expect(legacy.airlines[0]!.passengerHistory).toBeUndefined()
})
