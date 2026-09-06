import { describe, expect, it } from 'vitest'
import { applyCommand, newGame } from '../index'
import { canWithdrawOrder, orderRefund } from '../orders'
import { getAircraftType } from '../../data/aircraft'

describe('purchase withdrawals', () => {
  for (const rules of [1, 2]) it(`refunds a same-quarter purchase in rules ${rules} without changing old cancellations`, () => {
    const initial = newGame('jet_age', 'withdraw', undefined, undefined, rules)
    const bought = applyCommand(initial, { type: 'order_aircraft', aircraftType: 'caravelle' }).state
    const order = bought.airlines[0]!.orders[0]!
    const price = getAircraftType(order.type).price
    expect(orderRefund(order)).toBe(price)
    const result = applyCommand(bought, { type: 'withdraw_order', orderId: order.id })
    expect(result.events[0]).toMatchObject({ type: 'order_cancelled', refund: price })
    expect(result.state.airlines[0]!.cash).toBe(initial.airlines[0]!.cash)
    expect(result.state.airlines[0]!.orders).toHaveLength(0)
    const duplicate = applyCommand(result.state, { type: 'withdraw_order', orderId: order.id })
    expect(duplicate.events[0]!.type).toBe('command_rejected')
    expect(duplicate.state.airlines[0]!.cash).toBe(initial.airlines[0]!.cash)
    // Historical logs retain their original cash balances and hashes.
    expect(applyCommand(bought, { type: 'cancel_order', orderId: order.id }).events[0]).toMatchObject({ refund: Math.floor(price * .8) })
  })

  it('ends the refund window when the quarter advances and never refunds a lease payment that was not made', () => {
    let state = applyCommand(newGame('jet_age', 'withdraw-window'), { type: 'order_aircraft', aircraftType: 'caravelle' }).state
    const orderId = state.airlines[0]!.orders[0]!.id
    state = applyCommand(state, { type: 'end_quarter' }).state
    const order = state.airlines[0]!.orders.find((o) => o.id === orderId)!
    expect(order).toBeDefined()
    expect(canWithdrawOrder(order)).toBe(false)
    expect(applyCommand(state, { type: 'withdraw_order', orderId }).events[0]!.type).toBe('command_rejected')
    expect(applyCommand(state, { type: 'cancel_order', orderId }).events[0]).toMatchObject({ refund: orderRefund(order) })
    state = applyCommand(state, { type: 'lease_aircraft', aircraftType: 'caravelle' }).state
    const lease = state.airlines[0]!.orders.find((o) => o.leased)!
    expect(orderRefund(lease)).toBe(0)
    expect(applyCommand(state, { type: 'withdraw_order', orderId: lease.id }).events[0]!.type).toBe('command_rejected')
  })

  it('withdraws a replacement order without selling or detaching the aircraft it would replace', () => {
    const initial = newGame('jet_age', 'withdraw-replacement')
    const bought = applyCommand(initial, { type: 'order_replacement', aircraftId: 1, aircraftType: 'caravelle', leased: false }).state
    const result = applyCommand(bought, { type: 'withdraw_order', orderId: bought.airlines[0]!.orders[0]!.id })
    expect(result.state.airlines[0]!.fleet).toEqual(initial.airlines[0]!.fleet)
    expect(result.state.airlines[0]!.cash).toBe(initial.airlines[0]!.cash)
    expect(result.state.airlines[0]!.orders).toHaveLength(0)
  })
})
