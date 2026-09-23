import { getAircraftType } from '../data/aircraft'
import { ORDER_CANCEL_REFUND_BP } from '../data/constants'
import type { AircraftOrder, Airline } from './types'

// Delivery counters only decrease during quarter resolution. An untouched
// purchase is therefore still a reversible planning decision, even after
// saving/resuming or making unrelated changes. No extra save fields needed.
export function canWithdrawOrder(order: AircraftOrder): boolean {
  return !order.leased && order.quartersLeft === getAircraftType(order.type).deliveryQuarters
}

export function orderRefund(order: AircraftOrder, withdraw = canWithdrawOrder(order)): number {
  if (order.leased) return 0
  const price = getAircraftType(order.type).price
  return withdraw && canWithdrawOrder(order) ? price : Math.floor(price * ORDER_CANCEL_REFUND_BP / 10000)
}

// Orders placed this planning quarter: a pending lease always is (leases
// deliver the quarter after they are signed), and a purchase is while its
// counter still reads the full lead time.
export function ordersPlacedThisQuarter(airline: Pick<Airline, 'orders'>): number {
  return airline.orders.filter((o) => o.leased || o.quartersLeft === getAircraftType(o.type).deliveryQuarters).length
}
