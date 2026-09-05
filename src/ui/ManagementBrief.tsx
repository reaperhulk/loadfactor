import { useMemo } from 'react'
import { getAircraftType } from '../data/aircraft'
import { distanceKm, getCity } from '../data/cities'
import type { GameState } from '../engine'
import { forecastQuarter } from '../engine/forecast'
import { pairWeeklyDemand } from '../engine/market'
import { cabinSeats, isGrounded, roundTripsPerWeek, slotsFree } from '../engine/queries'
import { viewSeat } from './session'
import { money } from './format'

type BriefTab = 'routes' | 'fleet' | 'finance' | 'rivals'
export function ManagementBrief({ state, onTab, onInspect, onPlan }: { state: GameState; onTab: (tab: BriefTab) => void; onInspect: (routeId: number) => void; onPlan: (from: string, to: string) => void }) {
  const seat = viewSeat()
  const { forecast, firstFlights } = useMemo(() => {
    const a = state.airlines[seat]!
    const forecast = forecastQuarter(state, seat)
    const idle = a.fleet.find((f) => f.routeId === null && !f.reserve && !isGrounded(f, state.turn))
    const candidates = a.routes.length === 0 && idle ? Object.keys(a.slots).filter((to) => to !== a.hq && slotsFree(a, to) > 0 && distanceKm(a.hq, to) <= getAircraftType(idle.type).rangeKm)
      .sort((x, y) => pairWeeklyDemand(state, a.hq, y) - pairWeeklyDemand(state, a.hq, x)).slice(0, 2) : []
    const firstFlights = candidates.map((to) => {
      const frequency = Math.max(1, Math.min(roundTripsPerWeek(idle!.type, distanceKm(a.hq, to)), Math.ceil(pairWeeklyDemand(state, a.hq, to) * 0.7 / (cabinSeats(idle!.type, idle!.cabin) * 2))))
      const quote = forecastQuarter(state, seat, [{ type: 'open_route', from: a.hq, to, aircraftId: idle!.id, frequency }])
      return { from: a.hq, to, quote }
    }).filter((choice) => choice.quote.errors.length === 0)
    return { forecast, firstFlights }
  }, [state, seat])
  const airline = state.airlines[seat]!
  const worst = [...airline.routes].filter((r) => r.lastCapacity > 0).sort((a,b) => (a.lastRevenue-a.lastCost) - (b.lastRevenue-b.lastCost))[0]
  const grounded = airline.fleet.filter((a) => isGrounded(a, state.turn)).length
  const idle = airline.fleet.filter((a) => a.routeId === null && !a.reserve && !isGrounded(a, state.turn)).length
  const campaign = state.airlines.find((a) => a.id !== seat && a.campaign)
  const items: { priority: number; title: string; detail: string; action: string; run: () => void }[] = []
  if (forecast.cashAfter < 0) items.push({ priority: 100, title: 'Protect the treasury', detail: `This plan ends the quarter at ${money(forecast.cashAfter)} cash. Review borrowing, leases and unproductive costs before advancing.`, action: 'Review finances', run: () => onTab('finance') })
  if (grounded) items.push({ priority: 90, title: `${grounded} aircraft unavailable`, detail: 'Review maintenance and standby cover before flying the schedule.', action: 'Open operations', run: () => onTab('fleet') })
  if (worst && worst.lastRevenue < worst.lastCost) items.push({ priority: 80, title: `${worst.from}–${worst.to} needs attention`, detail: `Lost ${money(worst.lastCost-worst.lastRevenue)} before fixed company costs. Compare its schedule, fare and connecting revenue.`, action: 'Inspect route', run: () => onInspect(worst.id) })
  if (idle) items.push({ priority: 60, title: `${idle} idle aircraft`, detail: 'Crew and ownership costs continue. Assign useful work, keep a deliberate reserve, or sell surplus capacity.', action: 'Review fleet', run: () => onTab('fleet') })
  if (campaign) items.push({ priority: 40, title: `${campaign.name} has a plan`, detail: `${campaign.campaign!.kind} campaign at ${campaign.campaign!.city} · ${Math.max(0, campaign.campaign!.untilTurn-state.turn)} quarters remaining.`, action: 'Read rival plans', run: () => onTab('rivals') })
  if (!items.length) items.push({ priority: 0, title: 'Choose your next move', detail: 'Compare an expansion with improving the network you already have. Retain enough cash for a difficult quarter.', action: 'Plan route changes', run: () => onTab('routes') })
  return <section className="management-brief" data-testid="management-brief">
    <div className="brief-heading"><h2>From the operations desk</h2><span>Planned quarter: <strong className={forecast.profit >= 0 ? 'pos' : 'neg'}>{money(forecast.profit)} net profit</strong></span></div>
    {firstFlights.length > 0 ? <div className="brief-grid">{firstFlights.map((choice) => <article key={choice.to}><span className="eyebrow">Your first market</span><h3>{getCity(choice.to).name}</h3><p>{choice.from}–{choice.to} · {getCity(choice.to).tour >= getCity(choice.to).biz ? 'Leisure appeal' : 'Business demand'}</p><p>Estimated company profit {money(choice.quote.profit)}/q.</p><button onClick={() => onPlan(choice.from, choice.to)}>Compare this launch</button></article>)}</div>
      : <div className="brief-grid">{items.sort((a,b)=>b.priority-a.priority).slice(0,3).map((item) => <article key={item.title}><h3>{item.title}</h3><p>{item.detail}</p><button onClick={item.run}>{item.action}</button></article>)}</div>}
    <p className="brief-assumptions">Planning forecast at current fuel, demand and rival schedules. Review a proposal before committing cash.</p>
  </section>
}
