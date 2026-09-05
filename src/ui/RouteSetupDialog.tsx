// Opening a route is a scheduling decision: pick the launch aircraft and the
// weekly round-trip frequency it will fly (bounded by its speed and the
// distance), plus fare and service posture. Confirm dispatches open_route.

import { useMemo, useState } from 'react'
import { getAircraftType } from '../data/aircraft'
import { distanceKm } from '../data/cities'
import type { GameState } from '../engine'
import { estimateAircraftQuarterCost, estimateWeeklySeats, fareFor, pairWeeklyDemand } from '../engine/market'
import { cabinSeats, isGrounded, roundTripsPerWeek } from '../engine/queries'
import { forecastQuarter } from '../engine/forecast'
import { viewSeat, dispatch } from './session'
import { money } from './format'

interface RouteSetupDialogProps {
  state: GameState
  from: string
  to: string
  onClose: () => void
}

export function RouteSetupDialog({ state, from, to, onClose }: RouteSetupDialogProps) {
  const player = state.airlines[viewSeat()]!
  const km = distanceKm(from, to)
  const candidates = player.fleet
    .filter((ac) => ac.routeId === null && !isGrounded(ac, state.turn) && getAircraftType(ac.type).rangeKm >= km)
    .sort((a, b) => {
      // Best default first: cheapest quarterly cost per seat on THIS route.
      const perSeat = (ac: typeof a) => {
        const cost = estimateAircraftQuarterCost(state, ac.type, km)
        const seats = estimateWeeklySeats(ac.type, km) * 13
        return seats > 0 ? Math.floor((cost * 1000) / seats) : Number.MAX_SAFE_INTEGER
      }
      return perSeat(a) - perSeat(b) || a.id - b.id
    })
  const [aircraftId, setAircraftId] = useState<number | null>(candidates[0]?.id ?? null)
  const chosen = candidates.find((ac) => ac.id === aircraftId) ?? null
  const maxFreq = chosen ? roundTripsPerWeek(chosen.type, km) : 0
  const [frequency, setFrequency] = useState(maxFreq)
  const [fareLevel, setFareLevel] = useState(0)
  const [serviceLevel, setServiceLevel] = useState(2)

  const clampedFreq = Math.max(1, Math.min(frequency, maxFreq))
  const demand = pairWeeklyDemand(state, from, to)
  const seats = chosen ? cabinSeats(chosen.type, chosen.cabin) * clampedFreq * 2 : 0
  const seat = viewSeat()
  const baseline = useMemo(() => forecastQuarter(state, seat), [state, seat])
  const preview = useMemo(() => aircraftId === null ? null : forecastQuarter(state, seat, [{
    type: 'open_route', from, to, aircraftId, frequency: clampedFreq, fareLevel, serviceLevel,
  }]), [state, seat, from, to, aircraftId, clampedFreq, fareLevel, serviceLevel])
  const launch = preview?.routes.find((route) => !player.routes.some((existing) => existing.id === route.id))

  return (
    <div className="gameover-overlay" data-testid="route-setup" onClick={onClose}>
      <div className="gameover-card report-card" onClick={(e) => e.stopPropagation()}>
        <h2>
          Open {from}–{to}
        </h2>
        <p className="dim">
          {km}km · demand {demand}/wk · base fare ${fareFor(km, fareLevel)}
        </p>
        {candidates.length === 0 ? (
          <>
            <p>No idle aircraft has the range for this route.</p>
            <button data-testid="route-setup-cancel" onClick={onClose}>
              Close
            </button>
          </>
        ) : (
          <>
            <label>
              Aircraft:{' '}
              <select
                data-testid="route-setup-aircraft"
                value={aircraftId ?? ''}
                onChange={(e) => {
                  const id = Number(e.target.value)
                  setAircraftId(id)
                  const ac = candidates.find((c) => c.id === id)
                  if (ac) setFrequency(roundTripsPerWeek(ac.type, km))
                }}
              >
                {candidates.map((ac) => {
                  const t = getAircraftType(ac.type)
                  return (
                    <option key={ac.id} value={ac.id}>
                      {t.name} ({t.seats} seats, max {roundTripsPerWeek(ac.type, km)} rt/wk)
                    </option>
                  )
                })}
              </select>
            </label>
            <div className="freq-row">
              <label htmlFor="freq-slider">
                Frequency: <strong data-testid="route-setup-freq">{clampedFreq} rt/wk</strong>{' '}
                <span className="dim">({seats} seats/wk)</span>
              </label>
              <input
                id="freq-slider"
                type="range"
                min={1}
                max={Math.max(1, maxFreq)}
                value={clampedFreq}
                onChange={(e) => setFrequency(Number(e.target.value))}
              />
            </div>
            <div className="dossier-controls">
              <label>
                Fare:{' '}
                <select value={fareLevel} onChange={(e) => setFareLevel(Number(e.target.value))}>
                  {[-2, -1, 0, 1, 2].map((l) => (
                    <option key={l} value={l}>
                      ${fareFor(km, l)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Service:{' '}
                <select value={serviceLevel} onChange={(e) => setServiceLevel(Number(e.target.value))}>
                  <option value={1}>basic</option>
                  <option value={2}>standard</option>
                  <option value={3}>premium</option>
                </select>
              </label>
            </div>
            {preview && launch && (
              <div className="forecast-card" data-testid="route-setup-estimate" aria-live="polite">
                <p>First-quarter revenue <strong>{money(launch.lastRevenue)}/q</strong> · flight costs {money(launch.lastCost)}/q</p>
                <p>Route contribution <strong className={launch.lastRevenue >= launch.lastCost ? 'pos' : 'neg'}>{money(launch.lastRevenue - launch.lastCost)}/q</strong></p>
                <p>Airline net profit <strong>{money(preview.profit)}/q</strong> · change {money(preview.profit - baseline.profit)}/q</p>
                <p>Cash after quarter {money(preview.cashAfter)} · launch cash {money(preview.cashRequired)}</p>
                <p className="dim">Includes the selected schedule, cabin, current maintenance, lease payments, hedges and connecting traffic. Holds today's economy and rival schedules fixed; new routes ramp over 3 quarters.</p>
              </div>
            )}
            <button
              data-testid="route-setup-confirm"
              onClick={() => {
                if (chosen === null) return
                dispatch({
                  type: 'open_route',
                  from,
                  to,
                  aircraftId: chosen.id,
                  frequency: clampedFreq,
                  fareLevel,
                  serviceLevel,
                })
                onClose()
              }}
            >
              ✈ Open route
            </button>{' '}
            <button data-testid="route-setup-cancel" onClick={onClose}>
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  )
}
