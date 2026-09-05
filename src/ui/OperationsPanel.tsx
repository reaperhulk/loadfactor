import { useMemo, useState } from 'react'
import { aircraftFamily, getAircraftType, typesOnSale } from '../data/aircraft'
import { distanceKm } from '../data/cities'
import { forecastReplacement } from '../engine/forecast'
import { debtCeiling, isGrounded, totalDebt, yearOf } from '../engine/queries'
import type { Command, GameState } from '../engine'
import { dispatch, dispatchBatch, viewSeat } from './session'
import { money } from './format'

export function OperationsPanel({ state }: { state: GameState }) {
  const seat = viewSeat()
  const airline = state.airlines[seat]!
  const [aircraftId, setAircraftId] = useState(airline.fleet[0]?.id ?? 0)
  const [replacement, setReplacement] = useState('')
  const [leased, setLeased] = useState(false)
  const [finance, setFinance] = useState(false)
  const { ac, choices, selected, quote } = useMemo(() => {
    const carrier = state.airlines[seat]!
    const ac = carrier.fleet.find((a) => a.id === aircraftId) ?? carrier.fleet[0]
    const choices = typesOnSale(yearOf(state)).filter((t) => carrier.routes.filter((r) => r.id === ac?.routeId || r.id === ac?.secondaryRouteId).every((r) => distanceKm(r.from, r.to) <= t.rangeKm))
    const selected = choices.find((t) => t.id === replacement) ?? choices[0]
    const quote = ac && selected ? forecastReplacement(state, seat, ac.id, selected.id, leased, finance) : null
    return { ac, choices, selected, quote }
  }, [state, seat, aircraftId, replacement, leased, finance])
  if ((state.rulesVersion ?? 1) < 2) return null
  const families = new Set(airline.fleet.map((a) => aircraftFamily(a.type))).size
  const primary = airline.routes.find((r) => r.id === ac?.routeId)
  const rotations = primary ? airline.routes.filter((r) => r.id !== primary.id && [primary.from, primary.to].some((c) => c === r.from || c === r.to) && distanceKm(r.from, r.to) <= getAircraftType(ac!.type).rangeKm) : []
  const borrowed = quote ? Math.max(0, quote.purchaseCash - airline.cash) : 0
  const canBuy = leased ? airline.cash >= (quote?.requiredCash ?? Infinity) : borrowed === 0 || (finance && borrowed <= debtCeiling(airline) - totalDebt(airline))
  return <section className="operations-panel" data-testid="operations-panel">
    <h3>Operations desk</h3>
    <p>{families} fleet {families === 1 ? 'family · 8% lower maintenance and administration' : 'families · each family beyond two adds 5% maintenance and administration (maximum 20%)'}.</p>
    <label>Connections <select aria-label="connection strategy" value={airline.hubMode ?? 'flexible'} onChange={(e) => dispatch({ type: 'set_hub_mode', mode: e.target.value as 'flexible' | 'banked' })}>
      <option value="flexible">Flexible schedules</option><option value="banked">Coordinated arrival banks</option>
    </select></label>
    <p className="dim">Banks improve connection appeal and cost {money(200 * airline.routes.length)}/quarter before inflation. Poor reliability hurts banked connections more.</p>
    {ac && <details>
      <summary>Maintenance, rotations & replacement</summary>
      <label>Aircraft <select aria-label="operations aircraft" value={ac.id} onChange={(e) => setAircraftId(Number(e.target.value))}>{airline.fleet.map((a) => <option key={a.id} value={a.id}>#{a.id} {getAircraftType(a.type).name} · {(a.ageQuarters / 4).toFixed(1)} years</option>)}</select></label>
      <p>{isGrounded(ac, state.turn) ? `In maintenance through quarter ${ac.groundedUntil}` : 'Available'} · {aircraftFamily(ac.type)} family</p>
      <button disabled={isGrounded(ac, state.turn) || (ac.maintainedUntil ?? 0) > state.turn || airline.cash < getAircraftType(ac.type).maintBase * 2} onClick={() => dispatch({ type: 'plan_maintenance', aircraftId: ac.id })}>Book maintenance · {money(getAircraftType(ac.type).maintBase * 2)}</button>
      <p className="dim">One quarter offline; failure risk reduced by 75% for eight quarters after return. A suitable standby aircraft covers the grounded rotation automatically.</p>
      {ac.routeId === null && <label><input type="checkbox" checked={ac.reserve ?? false} onChange={(e) => dispatch({ type: 'set_reserve', aircraftId: ac.id, reserve: e.target.checked })} /> Keep on standby (crew and ownership costs continue)</label>}
      {primary && <label>Shared rotation <select aria-label="secondary route" value={ac.secondaryRouteId ?? ''} onChange={(e) => dispatch({ type: 'set_rotation', aircraftId: ac.id, secondaryRouteId: e.target.value ? Number(e.target.value) : null })}>
        <option value="">All hours on {primary.from}–{primary.to}</option>{rotations.map((r) => <option key={r.id} value={r.id}>60% primary / 40% {r.from}–{r.to}</option>)}
      </select></label>}
      <h4>Replacement plan</h4>
      <label>New aircraft <select aria-label="replacement type" value={selected?.id ?? ''} onChange={(e) => setReplacement(e.target.value)}>{choices.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
      <label><input type="checkbox" checked={leased} onChange={(e) => setLeased(e.target.checked)} /> Lease the replacement</label>
      <label><input type="checkbox" checked={finance} onChange={(e) => setFinance(e.target.checked)} disabled={leased} /> Borrow the purchase shortfall</label>
      {quote && <><p>Pay {money(quote.purchaseCash)} now{finance && borrowed > 0 ? ` (${money(borrowed)} borrowed)` : ''}; delivery in {quote.deliveryQuarters} quarters. Estimated sale proceeds then: {money(quote.saleOnDelivery)}.</p>
        <p>Operating profit after replacement: {money(quote.projectedProfit)}/q · change <strong className={quote.quarterlySaving >= 0 ? 'pos' : 'neg'}>{money(quote.quarterlySaving)}/q</strong>.</p>
        <p className="dim">Forecast holds current demand, fuel and rival schedules fixed. Standard cabin; includes new-loan interest when financed. Your old aircraft flies until delivery, then its rotation transfers and it is sold or returned.</p>
        <button disabled={!canBuy || airline.orders.some((o) => o.replacesAircraftId === ac.id)} onClick={() => {
          const commands: Command[] = finance && borrowed > 0 ? [{ type: 'take_loan', amount: borrowed }] : []
          commands.push({ type: 'order_replacement', aircraftId: ac.id, aircraftType: selected!.id, leased })
          dispatchBatch(commands)
        }}>Order this replacement</button></>}
    </details>}
  </section>
}
