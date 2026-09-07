import type { Airline } from './types'

// Earned through the product passengers actually flew, not a purchased upgrade.
// One eighth of the gap closes each quarter; old customers take time to leave.
export function updateCustomerIdentity(airline: Airline): void {
  const targets = { business: 0, leisure: 0, budget: 0 }
  let passengers = 0
  for (const route of airline.routes) {
    const pax = route.lastPax
    if (pax <= 0) continue
    passengers += pax
    targets.business += pax * (10000 + (route.serviceLevel - 2) * 700 + Math.min(500, (route.frequency - 7) * 60) - Math.max(0, route.fareLevel - 1) * 250)
    targets.leisure += pax * (10000 + (route.serviceLevel - 2) * 250 - route.fareLevel * 250)
    targets.budget += pax * (10000 - route.fareLevel * 650)
  }
  const previous = airline.customerPreference ?? { business: 10000, leisure: 10000, budget: 10000 }
  const next = { ...previous }
  for (const segment of ['business', 'leisure', 'budget'] as const) {
    const product = passengers ? Math.floor(targets[segment] / passengers) : 10000
    const reliability = passengers ? Math.floor(((airline.reputationBp ?? 10000) - 10000) / 3) : 0
    const target = Math.max(8500, Math.min(11500, product + reliability))
    next[segment] = Math.floor((previous[segment] * 7 + target) / 8)
  }
  airline.customerPreference = next
}
