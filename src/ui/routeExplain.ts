// Why a route earned what it did, in sentences (rules 6 results carry the
// pair's market and the route's cost split). Presentation only: every number
// comes from the engine's own last-quarter record.

import type { Route } from '../engine'

const COST_NAMES = { fuel: 'fuel', fees: 'landing and handling fees', flightPay: 'crew flight pay', service: 'cabin service' } as const

export function explainRoute(route: Route): string[] {
  const m = route.lastMarket
  const c = route.lastCostParts
  if (!m || !c) return []
  const n = (x: number) => x.toLocaleString('en-US')
  const pair = `${route.from}–${route.to}`
  const lines: string[] = []
  const share = m.carried > 0 ? Math.round((m.own * 100) / m.carried) : 0
  lines.push(`${n(m.demand)} travellers wanted ${pair} at the standard fare; ${n(m.carried)} flew. You carried ${n(m.own)} of them nonstop (${share}%).`)
  if (m.carried > m.demand) lines.push(`Discounts on the pair brought ${n(m.carried - m.demand)} extra travellers into the market.`)
  const others = m.carried - m.own
  if (others > 0) lines.push(`Rivals and connecting itineraries carried the other ${n(others)}.`)
  if (m.unserved > 0) {
    lines.push(m.full
      ? `Sold out: ${n(m.unserved)} travellers who wanted to fly found no seat. More frequency or a higher fare would earn from them.`
      : `${n(m.unserved)} travellers stayed home: the fares on offer priced them out or the schedule did not tempt them.`)
  } else if (m.full) {
    lines.push('Sold out, with nobody left waiting: the pair is fully served.')
  }
  const parts = (Object.keys(COST_NAMES) as (keyof typeof COST_NAMES)[]).map((k) => ({ k, v: c[k] })).sort((a, b) => b.v - a.v)
  const total = parts.reduce((s, p) => s + p.v, 0)
  if (total > 0) {
    const top = parts[0]!
    lines.push(`Flying costs: ${COST_NAMES[top.k]} is the largest at ${Math.round((top.v * 100) / total)}% of ${'$'}${n(total)}k (before aircraft, crew salaries and overhead).`)
  }
  return lines
}
