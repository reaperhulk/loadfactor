import { useEffect, useRef } from 'react'
import { getAircraftType } from '../data/aircraft'
import { distanceKm } from '../data/cities'
import { CABIN_REFIT_COST_BP } from '../data/constants'
import type { GameState } from '../engine'
import { cabinSeats, isGrounded, resaleValue } from '../engine/queries'
import { AircraftArt } from './AircraftArt'
import { OperationsPanel } from './OperationsPanel'
import { ConfirmButton } from './ConfirmButton'
import { assignAndSchedule } from './assign'
import { money } from './format'
import { dispatch, viewSeat } from './session'

export function AircraftDossier({ state, aircraftId, onClose }: { state: GameState; aircraftId: number; onClose: () => void }) {
  const panel = useRef<HTMLElement>(null)
  useEffect(() => { panel.current?.scrollTo(0,0); panel.current?.querySelector<HTMLButtonElement>('[data-testid=aircraft-dossier-close]')?.focus({ preventScroll:true }) }, [aircraftId])
  const airline = state.airlines[viewSeat()]!, ac = airline.fleet.find((a) => a.id === aircraftId)
  if (!ac) return null
  const type = getAircraftType(ac.type)
  return <aside className="city-panel aircraft-dossier" data-testid="aircraft-dossier" ref={panel}>
    <header className="city-panel-head"><div><span className="eyebrow">Aircraft #{ac.id}</span><h2>{type.name}</h2><small>{isGrounded(ac,state.turn) ? 'In maintenance' : ac.reserve ? 'Standby' : ac.routeId === null ? 'Unassigned' : 'In service'}{ac.leased ? ' · leased' : ' · owned'}</small></div><button data-testid="aircraft-dossier-close" aria-label="Back to aircraft list" onClick={onClose}>×</button></header>
    <AircraftArt type={ac.type} />
    <dl className="entity-facts"><div><dt>Age</dt><dd>{(ac.ageQuarters/4).toFixed(1)} years</dd></div><div><dt>Seats</dt><dd>{cabinSeats(ac.type,ac.cabin)}</dd></div><div><dt>Range</dt><dd>{type.rangeKm.toLocaleString()} km</dd></div><div><dt>Sale value</dt><dd>{ac.leased ? 'Leased' : money(resaleValue(ac.type,ac.ageQuarters))}</dd></div></dl>
    <h3>Assignment & cabin</h3>
    <label className="entity-field">Primary route<select aria-label="Aircraft primary route" value={ac.routeId ?? ''} onChange={(e) => e.target.value === '' ? dispatch({ type:'assign_aircraft',aircraftId:ac.id,routeId:null }) : assignAndSchedule(state,ac.id,Number(e.target.value))}>
      <option value="">{ac.reserve ? 'Standby' : 'Unassigned'}</option>{airline.routes.map((r) => <option key={r.id} value={r.id} disabled={distanceKm(r.from,r.to)>type.rangeKm}>{r.from}–{r.to}{distanceKm(r.from,r.to)>type.rangeKm ? ' · out of range' : ''}</option>)}
    </select></label>
    <label className="entity-field">Cabin fit<select aria-label="cabin fit" value={ac.cabin} onChange={(e) => dispatch({ type:'refit_cabin',aircraftId:ac.id,cabin:Number(e.target.value) })}><option value="1">Dense</option><option value="2">Standard</option><option value="3">Premium</option></select></label>
    <p className="hint">Changing cabin costs {money(Math.floor(type.price * CABIN_REFIT_COST_BP / 10000))}. Route assignments include a usable schedule and can be undone.</p>
    <OperationsPanel key={aircraftId} state={state} selectedAircraftId={aircraftId} mode="aircraft" />
    <details className="entity-actions"><summary>Ownership actions</summary><p className="hint">{ac.leased ? 'Return this aircraft to the lessor.' : `Sell this aircraft for ${money(resaleValue(ac.type,ac.ageQuarters))}.`} Its capacity will be removed from the schedule.</p><ConfirmButton label={ac.leased ? 'Return aircraft' : 'Sell aircraft'} confirmLabel="Confirm disposal?" onConfirm={() => { dispatch({ type:'sell_aircraft',aircraftId:ac.id }); onClose() }} /></details>
  </aside>
}
