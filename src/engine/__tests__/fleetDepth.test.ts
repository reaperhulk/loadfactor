// M2 fleet depth: leasing, the used market, and fuel hedging.

import { describe, expect, it } from 'vitest'
import { LEASE_BP_PER_QUARTER } from '../../data/constants'
import { getAircraftType } from '../../data/aircraft'
import { applyCommand, newGame } from '../index'

describe('fleet depth', () => {
  it('leasing delivers fast, pays quarterly, and returns for nothing', () => {
    let r = applyCommand(newGame('jet_age', 'lease-seed'), { type: 'lease_aircraft', aircraftType: 'meridian80' })
    expect(r.events[0]).toMatchObject({
      type: 'aircraft_leased',
      paymentPerQuarter: Math.floor((getAircraftType('meridian80').price * LEASE_BP_PER_QUARTER) / 10000),
    })
    expect(r.state.airlines[0]!.cash).toBe(18000) // no capex
    r = applyCommand(r.state, { type: 'end_quarter' })
    const leased = r.state.airlines[0]!.fleet.find((a) => a.leased)
    expect(leased).toBeDefined()
    // Returning a leased airframe yields nothing.
    const sold = applyCommand(r.state, { type: 'sell_aircraft', aircraftId: leased!.id })
    expect(sold.events[0]).toMatchObject({ type: 'aircraft_sold', proceeds: 0 })
  })

  it('the used market rotates deterministic offers that deliver instantly', () => {
    let r = applyCommand(newGame('jet_age', 'used-seed'), { type: 'end_quarter' })
    const offers = r.state.world.usedMarket
    expect(offers.length).toBeGreaterThan(0)
    const offer = offers[0]!
    const cashBefore = r.state.airlines[0]!.cash
    r = applyCommand(r.state, { type: 'buy_used', offerId: offer.id })
    const bought = r.state.airlines[0]!.fleet.find((a) => a.ageQuarters === offer.ageQuarters)
    expect(bought).toBeDefined()
    expect(r.state.airlines[0]!.cash).toBe(cashBefore - offer.price)
    // The same offer cannot be bought twice.
    const again = applyCommand(r.state, { type: 'buy_used', offerId: offer.id })
    expect(again.events[0]).toMatchObject({ type: 'command_rejected' })
  })

  it('a fuel hedge locks the index, runs off, and cannot be doubled', () => {
    let r = applyCommand(newGame('jet_age', 'hedge-seed'), { type: 'hedge_fuel', quarters: 4 })
    expect(r.events[0]).toMatchObject({ type: 'fuel_hedged', quarters: 4 })
    expect(r.state.airlines[0]!.fuelHedge).toMatchObject({ quartersLeft: 4 })
    const doubled = applyCommand(r.state, { type: 'hedge_fuel', quarters: 4 })
    expect(doubled.events[0]).toMatchObject({ type: 'command_rejected' })
    for (let q = 0; q < 4; q++) r = applyCommand(r.state, { type: 'end_quarter' })
    expect(r.state.airlines[0]!.fuelHedge).toBeNull()
    // Bad durations reject.
    const bad = applyCommand(newGame('jet_age', 'hedge-seed'), { type: 'hedge_fuel', quarters: 99 })
    expect(bad.events[0]).toMatchObject({ type: 'command_rejected' })
  })
})
