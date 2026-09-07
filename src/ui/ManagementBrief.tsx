import type { ExpansionOption } from '../engine/expansion'
import { checkDueIn } from '../engine/operations'
import { useMemo } from 'react'
import { getAircraftType } from '../data/aircraft'
import { distanceKm, getCity } from '../data/cities'
import { applyCommandBatchFor, type GameState } from '../engine'
import { planningEvaluator } from './forecast'
import { mergePlanningCommands, usePlanningCommands } from './planningDrafts'
import { idleSlotRent } from '../engine/slots'
import { estimateAircraftQuarterCost, estimateWeeklySeats, pairWeeklyDemand } from '../engine/market'
import { cabinSeats, isGrounded, roundTripsPerWeek, slotsFree } from '../engine/queries'
import { viewSeat } from './session'
import { money } from './format'

type BriefTab = 'routes' | 'fleet' | 'finance' | 'rivals' | 'airports'
export function ManagementBrief({ state, onTab, onInspect, onPlan, onAircraft }: { state: GameState; onTab: (tab: BriefTab) => void; onAircraft: (id: number) => void; onInspect: (routeId: number) => void; onPlan: (from: string, to: string, preset?: Pick<ExpansionOption, 'aircraftId' | 'frequency'>) => void }) {
  const seat = viewSeat(), draft=usePlanningCommands()
  const { forecast, firstFlights } = useMemo(() => {
    const firstPlan=draft.length && state.airlines[seat]!.routes.length===0 ? applyCommandBatchFor(state,draft.map(command=>({seat,command}))).state : state
    const a = firstPlan.airlines[seat]!
    const evaluate=planningEvaluator(state,seat), forecast=evaluate(draft)
    const idle = a.fleet.find((f) => f.routeId === null && !f.reserve && !isGrounded(f, state.turn))
    const candidates = a.routes.length === 0 && idle ? Object.keys(a.slots).filter((to) => to !== a.hq && slotsFree(a, to) > 0 && distanceKm(a.hq, to) <= getAircraftType(idle.type).rangeKm)
      .sort((x, y) => pairWeeklyDemand(state, a.hq, y) - pairWeeklyDemand(state, a.hq, x)).slice(0, 2) : []
    const firstFlights = candidates.map((to) => {
      const km = distanceKm(a.hq, to)
      const launch = a.fleet.filter((f) => f.routeId === null && !f.reserve && !isGrounded(f, state.turn) && getAircraftType(f.type).rangeKm >= km).sort((x,y) => {
        const perSeat = (f: typeof x) => Math.floor(estimateAircraftQuarterCost(state, f.type, km) * 1000 / Math.max(1, estimateWeeklySeats(f.type, km) * 13))
        return perSeat(x)-perSeat(y) || x.id-y.id
      })[0]!
      const frequency = Math.max(1, Math.min(roundTripsPerWeek(launch.type, distanceKm(a.hq, to), a.operationsPolicy?.reserveBp ?? 0), Math.ceil(pairWeeklyDemand(state, a.hq, to) * 0.7 / (cabinSeats(launch.type, launch.cabin) * 2))))
      const quote = evaluate(mergePlanningCommands(draft,[{ type: 'open_route', from: a.hq, to, aircraftId: launch.id, frequency }]))
      return { from: a.hq, to, quote, preset: { aircraftId: launch.id, frequency } }
    }).filter((choice) => choice.quote.errors.length === 0)
    return { forecast, firstFlights }
  }, [state, seat, draft])
  const airline = state.airlines[seat]!
  const worst = [...airline.routes].filter((r) => r.lastCapacity > 0).sort((a,b) => (a.lastRevenue-a.lastCost) - (b.lastRevenue-b.lastCost))[0]
  const due = airline.fleet.filter(a => airline.operationsPolicy && checkDueIn(airline, a, state.turn) === 0 && a.operations?.checkStart === undefined)
  const grounded = airline.fleet.filter((a) => isGrounded(a, state.turn)).length
  const idle = airline.fleet.filter((a) => a.routeId === null && !a.reserve && !isGrounded(a, state.turn)).length
  const campaign = state.airlines.find((a) => a.id !== seat && a.campaign)
  const items: { priority: number; title: string; detail: string; action: string; run: () => void }[] = []
  if (forecast.cashAfter < 0) items.push({ priority: 100, title: 'Protect the treasury', detail: `This plan ends the quarter at ${money(forecast.cashAfter)} cash. Review borrowing, leases and unproductive costs before advancing.`, action: 'Review finances', run: () => onTab('finance') })
  if (forecast.operations?.cancelledTrips) items.push({ priority: 92, title: `${forecast.operations.cancelledTrips} round trips need cover`, detail: 'Known checks or an undersupplied schedule leave gaps. Stagger checks, adjust frequencies or review reserve cover.', action: 'Review operations', run: () => onTab('fleet') })
  if (due.length) items.push({ priority: 89, title: `${due.length} aircraft checks due`, detail: 'Checks will be staggered automatically. Choose the start week yourself to manage cover and cost.', action: 'Schedule checks', run: () => onAircraft(due[0]!.id) })
  if (grounded) items.push({ priority: 90, title: `${grounded} aircraft unavailable`, detail: 'Review maintenance and standby cover before flying the schedule.', action: 'Open operations', run: () => onAircraft(airline.fleet.find((a) => isGrounded(a,state.turn))!.id) })
  if (worst && worst.lastRevenue < worst.lastCost) items.push({ priority: 80, title: `${worst.from}–${worst.to} needs attention`, detail: `Lost ${money(worst.lastCost-worst.lastRevenue)} before fixed company costs. Compare its schedule, fare and connecting revenue.`, action: 'Inspect route', run: () => onInspect(worst.id) })
  if (idle) items.push({ priority: 60, title: `${idle} idle aircraft`, detail: 'Crew and ownership costs continue. Assign useful work, keep a deliberate reserve, or sell surplus capacity.', action: 'Review fleet', run: () => onAircraft(airline.fleet.find((a) => a.routeId === null && !a.reserve && !isGrounded(a,state.turn))!.id) })
  if (idleSlotRent(airline) > 0) items.push({ priority:50, title:'Unused airport capacity', detail:`${money(idleSlotRent(airline))}/quarter in rent on unused slots. Keep strategic capacity or release surplus.`, action:'Review airports', run:() => onTab('airports') })
  if (airline.fuelHedge?.quartersLeft === 1) items.push({ priority:70,title:'Fuel hedge expires this quarter',detail:'Next quarter’s fuel bill will return to market prices.',action:'Review fuel protection',run:() => onTab('finance') })
  if (campaign) items.push({ priority: 40, title: `${campaign.name} has a plan`, detail: `${campaign.campaign!.kind} campaign at ${campaign.campaign!.city} · ${Math.max(0, campaign.campaign!.untilTurn-state.turn)} quarters remaining.`, action: 'Read rival plans', run: () => onTab('rivals') })
  if (!items.length) items.push({ priority: 0, title: 'Choose your next move', detail: 'Compare an expansion with improving the network you already have. Retain enough cash for a difficult quarter.', action: 'Plan route changes', run: () => onTab('routes') })
  return <section className="management-brief" data-testid="management-brief">
    <div className="brief-heading"><h2>Needs attention</h2><span>{draft.length ? 'With shared plan:' : 'Planned quarter:'} <strong className={forecast.profit >= 0 ? 'pos' : 'neg'}>{money(forecast.profit)} net profit</strong></span></div>
    {firstFlights.length > 0 ? <div className="brief-grid">{firstFlights.map((choice) => <article key={choice.to}><span className="eyebrow">Your first market</span><h3>{getCity(choice.to).name}</h3><p>{choice.from}–{choice.to} · {getCity(choice.to).tour >= getCity(choice.to).biz ? 'Leisure appeal' : 'Business demand'}</p><dl className="decision-metrics"><div><dt>Company profit / q</dt><dd>{money(choice.quote.profit)}</dd></div><div><dt>Ending cash</dt><dd>{money(choice.quote.cashAfter)}</dd></div><div><dt>Frequency</dt><dd>{choice.preset.frequency} return trips / week</dd></div><div><dt>Boardings / q</dt><dd>{choice.quote.routes.reduce((n,r)=>n+r.lastPax,0).toLocaleString('en-US')}</dd></div></dl><p className="hint">{getCity(choice.to).tour >= getCity(choice.to).biz ? 'More leisure exposure: watch seasonal demand and price sensitivity.' : 'More business exposure: schedule frequency and service help compete.'}</p><button onClick={() => onPlan(choice.from, choice.to, choice.preset)}>Compare this launch</button></article>)}</div>
      : <div className="brief-list">{items.sort((a,b)=>b.priority-a.priority).slice(0,5).map((item) => <article key={item.title}><div><h3>{item.title}</h3><p>{item.detail}</p></div><button onClick={item.run}>{item.action} <span aria-hidden="true">→</span></button></article>)}</div>}
    <p className="brief-assumptions">Inbox items marked as seen. Operational issues stay here until resolved. Planning forecast uses current fuel, demand and rival schedules.</p>
  </section>
}
