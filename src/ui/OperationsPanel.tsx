import {
  aircraftBase,
  aircraftOperations,
  checkDueIn,
  crewFamily,
  maintenanceQuote,
  QUARTER_MINUTES,
  tripMinutes,
  weeklyPlan,
  WEEK_MINUTES,
} from '../engine/operations'
import { planningForecast } from './forecast'
import { OperationsSummary } from './OperationsSummary'
import { useMemo, useState } from 'react'
import { aircraftFamily, getAircraftType, typesOnSale } from '../data/aircraft'
import { distanceKm } from '../data/cities'
import { forecastReplacement } from '../engine/forecast'
import { debtCeiling, isGrounded, totalDebt, yearOf } from '../engine/queries'
import type { Command, GameState } from '../engine'
import { dispatch, dispatchBatch, viewSeat } from './session'
import { money } from './format'

export function OperationsPanel({
  state,
  selectedAircraftId,
  mode = 'all',
}: {
  state: GameState
  selectedAircraftId?: number
  mode?: 'all' | 'policy' | 'aircraft'
}) {
  const seat = viewSeat()
  const airline = state.airlines[seat]!
  const [aircraftId, setAircraftId] = useState(airline.fleet[0]?.id ?? 0)
  const [replacement, setReplacement] = useState('')
  const [leased, setLeased] = useState(false)
  const [finance, setFinance] = useState(false)
  const [startWeek, setStartWeek] = useState(0)
  const readiness = useMemo(
    () => (airline.operationsPolicy ? planningForecast(state, seat).operations : undefined),
    [state, seat, airline.operationsPolicy],
  )
  const { ac, choices, selected, quote } = useMemo(() => {
    const carrier = state.airlines[seat]!
    const ac = carrier.fleet.find((a) => a.id === (selectedAircraftId ?? aircraftId)) ?? carrier.fleet[0]
    const choices = typesOnSale(yearOf(state)).filter((t) =>
      carrier.routes
        .filter((r) => r.id === ac?.routeId || r.id === ac?.secondaryRouteId)
        .every((r) => distanceKm(r.from, r.to) <= t.rangeKm),
    )
    const selected = choices.find((t) => t.id === replacement) ?? choices[0]
    const quote =
      mode !== 'policy' && ac && selected
        ? forecastReplacement(state, seat, ac.id, selected.id, leased, finance)
        : null
    return { ac, choices, selected, quote }
  }, [state, seat, aircraftId, selectedAircraftId, replacement, leased, finance, mode])
  if ((state.rulesVersion ?? 1) < 2) return null
  const families = new Set(airline.fleet.map((a) => aircraftFamily(a.type))).size
  const primary = airline.routes.find((r) => r.id === ac?.routeId)
  const rotations = primary
    ? airline.routes.filter(
        (r) =>
          r.id !== primary.id &&
          [primary.from, primary.to].some((c) => c === r.from || c === r.to) &&
          distanceKm(r.from, r.to) <= getAircraftType(ac!.type).rangeKm,
      )
    : []
  const borrowed = quote ? Math.max(0, quote.purchaseCash - airline.cash) : 0
  const canBuy = leased
    ? airline.cash >= (quote?.requiredCash ?? Infinity)
    : borrowed === 0 || (finance && borrowed <= debtCeiling(airline) - totalDebt(airline))
  const o = ac ? aircraftOperations(airline, ac, state.turn) : undefined
  const check = ac ? maintenanceQuote(ac) : undefined
  const due = ac ? checkDueIn(airline, ac, state.turn) : 0
  const working = o?.checkStart !== undefined && o.checkStart < state.turn * QUARTER_MINUTES
  const bases = Object.keys(airline.slots).filter(
    (c) =>
      airline.slots[c]! > 0 &&
      (!primary ||
        airline.routes
          .filter((r) => r.id === ac?.routeId || r.id === ac?.secondaryRouteId)
          .every((r) => r.from === c || r.to === c)),
  )
  const plan = weeklyPlan(airline)
  const pools = new Map<string, { aircraft: number; standby: number; hours: number }>()
  for (const a of airline.fleet) {
    const key = `${aircraftBase(airline, a)} · ${crewFamily(a.type)}`
    const pool = pools.get(key) ?? { aircraft: 0, standby: 0, hours: 0 }
    pool.aircraft++
    if (a.reserve) pool.standby++
    const minutes = airline.routes.reduce(
      (n, r) =>
        n +
        (plan.get(r.id) ?? [])
          .filter((t) => t.aircraftId === a.id)
          .reduce((sum, t) => sum + t.trips * tripMinutes(a.type, r), 0),
      0,
    )
    pool.hours += Math.floor((6000 - minutes) / 60)
    pools.set(key, pool)
  }
  return (
    <section
      className="operations-panel"
      data-testid={mode === 'policy' ? 'fleet-policy' : 'operations-panel'}
    >
      {mode !== 'aircraft' && (
        <>
          <h3>Fleet policy</h3>
          <p>
            {families} fleet{' '}
            {families === 1
              ? 'family · 8% lower maintenance and administration'
              : 'families · each family beyond two adds 5% maintenance and administration (maximum 20%)'}
            .
          </p>
          {!airline.operationsPolicy &&
            state.airlines.filter((a) => a.controller === 'player').length === 1 && (
              <div className="operations-upgrade" data-testid="operations-upgrade">
                <h4>Upgrade this career’s operations</h4>
                <p>
                  Use short repairs, reserve hours and scheduled checks from this quarter onward. Existing
                  results stay intact. Outstanding groundings become three-day repairs; schedules allow 5%
                  reserve hours.
                </p>
                <button onClick={() => dispatch({ type: 'upgrade_operations' })}>
                  Enable improved operations
                </button>
              </div>
            )}
          {airline.operationsPolicy && (
            <>
              <label>
                Reserve hours{' '}
                <select
                  aria-label="Reserve hours"
                  value={airline.operationsPolicy.reserveBp}
                  onChange={(e) =>
                    dispatch({
                      type: 'set_operations_policy',
                      reserveBp: Number(e.target.value),
                      recovery: airline.operationsPolicy!.recovery,
                    })
                  }
                >
                  <option value={0}>0% · maximum schedule</option>
                  <option value={500}>5% · balanced</option>
                  <option value={1000}>10% · resilient</option>
                  <option value={1500}>15% · cautious</option>
                </select>
              </label>
              <p className="dim">
                Increasing reserves trims schedules to fit. Lowering reserves frees hours; increase route
                frequencies to use them.
              </p>
              <label>
                <input
                  type="checkbox"
                  aria-label="Paid recovery"
                  checked={airline.operationsPolicy.recovery}
                  onChange={(e) =>
                    dispatch({
                      type: 'set_operations_policy',
                      reserveBp: airline.operationsPolicy!.reserveBp,
                      recovery: e.target.checked,
                    })
                  }
                />{' '}
                Buy short-term recovery when fleet cover runs out
              </label>
              <p className="dim">
                Paid recovery covers at most 10% of planned round trips. Flight costs and a charter premium
                are included in the quarter’s bill.
              </p>
              <div className="operations-pools" data-testid="operations-pools">
                {[...pools].map(([key, pool]) => (
                  <div key={key}>
                    <strong>{key}</strong>
                    <span>
                      {pool.aircraft} aircraft · {pool.standby} standby
                    </span>
                    <span>{pool.hours} unscheduled hours/week</span>
                  </div>
                ))}
              </div>
              <p className="dim">
                Cover uses compatible crews and aircraft with free hours. Standby aircraft must be at a route
                endpoint or within a 1,000 km ferry; range, ferry time and existing flights still limit cover.
              </p>
              {readiness && <OperationsSummary summary={readiness} routes={airline.routes} forecast />}
            </>
          )}
          <label>
            Connections{' '}
            <select
              aria-label="connection strategy"
              value={airline.hubMode ?? 'flexible'}
              onChange={(e) =>
                dispatch({ type: 'set_hub_mode', mode: e.target.value as 'flexible' | 'banked' })
              }
            >
              <option value="flexible">Flexible schedules</option>
              <option value="banked">Coordinated arrival banks</option>
            </select>
          </label>
          <p className="dim">
            Banks improve connection appeal and cost {money(200 * airline.routes.length)}/quarter before
            inflation. Poor reliability hurts banked connections more.
          </p>
        </>
      )}
      {ac && mode !== 'policy' && (
        <details open={mode === 'aircraft' ? true : undefined}>
          <summary>Maintenance, rotations & replacement</summary>
          {selectedAircraftId === undefined && (
            <label>
              Aircraft{' '}
              <select
                aria-label="operations aircraft"
                value={ac.id}
                onChange={(e) => setAircraftId(Number(e.target.value))}
              >
                {airline.fleet.map((a) => (
                  <option key={a.id} value={a.id}>
                    #{a.id} {getAircraftType(a.type).name} · {(a.ageQuarters / 4).toFixed(1)} years
                  </option>
                ))}
              </select>
            </label>
          )}
          {airline.operationsPolicy && o && check ? (
            <div className="aircraft-readiness" data-testid="aircraft-readiness">
              <p>
                <strong>
                  {working
                    ? 'Check in progress'
                    : o.checkStart !== undefined
                      ? `Check booked · week ${Math.floor((o.checkStart - state.turn * QUARTER_MINUTES) / WEEK_MINUTES) + 1}`
                      : due === 0
                        ? 'Check due this quarter'
                        : `Check due in ${due} quarters`}
                </strong>{' '}
                · {crewFamily(ac.type)} crew family
              </p>
              <p className="dim">
                {Math.floor(o.flightMinutes / 60).toLocaleString('en-US')} lifetime block hours ·{' '}
                {o.cycles.toLocaleString('en-US')} cycles ·{' '}
                {Math.floor(o.sinceCheckMinutes / 60).toLocaleString('en-US')} hours since check.
              </p>
              <label>
                Operating base{' '}
                <select
                  aria-label="Operating base"
                  value={aircraftBase(airline, ac)}
                  onChange={(e) =>
                    dispatch({ type: 'set_aircraft_base', aircraftId: ac.id, city: e.target.value })
                  }
                >
                  {bases.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label>
                Check starts{' '}
                <select
                  aria-label="Check start week"
                  value={startWeek}
                  onChange={(e) => setStartWeek(Number(e.target.value))}
                  disabled={working}
                >
                  {Array.from({ length: 13 }, (_, i) => (
                    <option key={i} value={i}>
                      Week {i + 1}
                    </option>
                  ))}
                </select>
              </label>
              <button
                disabled={working}
                onClick={() => dispatch({ type: 'plan_maintenance', aircraftId: ac.id, startWeek })}
              >
                {o.checkStart !== undefined ? 'Reschedule' : 'Book'} check · {check.days} days ·{' '}
                {money(check.cost)}
              </button>
              {o.checkStart !== undefined && !working && (
                <button onClick={() => dispatch({ type: 'cancel_maintenance', aircraftId: ac.id })}>
                  Cancel check booking
                </button>
              )}
              <p className="dim">
                Charged when work starts. Due checks are staggered automatically if unbooked; an early check
                lets you choose a quieter week. Most repairs take hours or a few days. Late checks and rare
                major repairs can carry into the next quarter.
              </p>
              {readiness &&
                (() => {
                  const info = readiness.aircraft.find((a) => a.aircraftId === ac.id)
                  return info ? (
                    <p>
                      Planned availability{' '}
                      {(100 - (info.unavailableMinutes * 100) / QUARTER_MINUTES).toFixed(1)}% ·{' '}
                      {Math.floor(info.flightMinutes / 60)} block hours this quarter ·{' '}
                      {Math.floor(info.spareMinutes / 60)} spare hours.
                    </p>
                  ) : null
                })()}
            </div>
          ) : (
            <>
              <p>
                {isGrounded(ac, state.turn)
                  ? `In maintenance through quarter ${ac.groundedUntil}`
                  : 'Available'}{' '}
                · {aircraftFamily(ac.type)} family
              </p>
              <button
                disabled={
                  isGrounded(ac, state.turn) ||
                  (ac.maintainedUntil ?? 0) > state.turn ||
                  airline.cash < getAircraftType(ac.type).maintBase * 2
                }
                onClick={() => dispatch({ type: 'plan_maintenance', aircraftId: ac.id })}
              >
                Book maintenance · {money(getAircraftType(ac.type).maintBase * 2)}
              </button>
              <p className="dim">
                One quarter offline; failure risk reduced by 75% for eight quarters after return. Upgrade
                Fleet policy to use short repairs and scheduled checks.
              </p>
            </>
          )}
          {ac.routeId === null && (
            <label>
              <input
                type="checkbox"
                checked={ac.reserve ?? false}
                onChange={(e) =>
                  dispatch({ type: 'set_reserve', aircraftId: ac.id, reserve: e.target.checked })
                }
              />{' '}
              Keep on standby (crew and ownership costs continue)
            </label>
          )}
          {primary && (
            <label>
              Shared rotation{' '}
              <select
                aria-label="secondary route"
                value={ac.secondaryRouteId ?? ''}
                onChange={(e) =>
                  dispatch({
                    type: 'set_rotation',
                    aircraftId: ac.id,
                    secondaryRouteId: e.target.value ? Number(e.target.value) : null,
                  })
                }
              >
                <option value="">
                  All hours on {primary.from}–{primary.to}
                </option>
                {rotations.map((r) => (
                  <option key={r.id} value={r.id}>
                    60% primary / 40% {r.from}–{r.to}
                  </option>
                ))}
              </select>
            </label>
          )}
          <h4>Replacement plan</h4>
          <label>
            New aircraft{' '}
            <select
              aria-label="replacement type"
              value={selected?.id ?? ''}
              onChange={(e) => setReplacement(e.target.value)}
            >
              {choices.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <input type="checkbox" checked={leased} onChange={(e) => setLeased(e.target.checked)} /> Lease the
            replacement
          </label>
          <label>
            <input
              type="checkbox"
              checked={finance}
              onChange={(e) => setFinance(e.target.checked)}
              disabled={leased}
            />{' '}
            Borrow the purchase shortfall
          </label>
          {quote && (
            <>
              <p>
                Pay {money(quote.purchaseCash)} now
                {finance && borrowed > 0 ? ` (${money(borrowed)} borrowed)` : ''}; delivery in{' '}
                {quote.deliveryQuarters} quarters. Estimated sale proceeds then: {money(quote.saleOnDelivery)}
                .
              </p>
              <p>
                Operating profit after replacement: {money(quote.projectedProfit)}/q · change{' '}
                <strong className={quote.quarterlySaving >= 0 ? 'pos' : 'neg'}>
                  {money(quote.quarterlySaving)}/q
                </strong>
                .
              </p>
              <p className="dim">
                Forecast holds current demand, fuel and rival schedules fixed. Standard cabin; includes
                new-loan interest when financed. Your old aircraft flies until delivery, then its rotation
                transfers and it is sold or returned.
              </p>
              <button
                disabled={!canBuy || airline.orders.some((o) => o.replacesAircraftId === ac.id)}
                onClick={() => {
                  const commands: Command[] =
                    finance && borrowed > 0 ? [{ type: 'take_loan', amount: borrowed }] : []
                  commands.push({
                    type: 'order_replacement',
                    aircraftId: ac.id,
                    aircraftType: selected!.id,
                    leased,
                  })
                  dispatchBatch(commands)
                }}
              >
                Order this replacement
              </button>
            </>
          )}
        </details>
      )}
    </section>
  )
}
