import { getAircraftType } from '../data/aircraft'
import { ORDER_CANCEL_REFUND_BP } from '../data/constants'
import type { AircraftOrder } from './types'

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
