import { useState } from 'react'
import type { Command, GameState } from '../engine'
import { commandKey, clearPlanningDraft, removePlanningCommand, usePlanningCommands } from './planningDrafts'
import { applyPlanningDraft, planEvaluator } from './planActions'
import { viewSeat } from './session'
import { money } from './format'

export function planningCommandLabel(state: GameState, seat: number, c: Command) {
  const r = 'routeId' in c ? state.airlines[seat]!.routes.find(r => r.id === c.routeId) : undefined
  const entity = r ? `${r.from}–${r.to}` : 'aircraftId' in c ? `Aircraft #${c.aircraftId}` : 'city' in c ? c.city : ''
  if (c.type === 'open_route') return `${c.from}–${c.to}: launch aircraft #${c.aircraftId}, ${c.frequency} round trips/week`
  if (c.type === 'set_fare') return `${entity}: ${['Deep discount','Discount','Standard','Premium','Top fare'][c.fareLevel+2]} fare`
  if (c.type === 'set_service') return `${entity}: ${['','Basic','Standard','Premium'][c.serviceLevel]} service`
  if (c.type === 'set_frequency') return `${entity}: ${c.frequency} round trips/week`
  if (c.type === 'plan_maintenance') return `${entity}: check starts week ${(c.startWeek ?? 0)+1}`
  if (c.type === 'order_replacement') return `${entity}: ${c.leased ? 'lease' : 'buy'} replacement ${c.aircraftType}`
  if (c.type === 'order_aircraft' || c.type === 'lease_aircraft') return `${c.type === 'lease_aircraft' ? 'Lease' : 'Buy'} ${c.aircraftType}`
  if (c.type === 'take_loan') return `Borrow ${money(c.amount)}`
  return `${entity}: ${c.type.replaceAll('_', ' ')}`
}
export function PlanTray({ state }: { state: GameState }) {
  const commands = usePlanningCommands(), seat = viewSeat(), [open, setOpen] = useState(false)
  if (!commands.length) return null
  const evaluate = planEvaluator(state, seat), before = evaluate(), after = evaluate(commands)
  return <aside className="plan-tray" data-testid="plan-tray" aria-label="Shared quarter plan">
    <div className="plan-tray-bar"><button aria-expanded={open} onClick={() => setOpen(!open)}>{commands.length} planned changes</button><span>Profit {money(before.profit)} → <strong>{money(after.profit)}</strong><small>Ending cash {money(after.cashAfter)}</small></span><button className="primary-action" data-testid="apply-shared-plan" disabled={!!after.errors.length} onClick={() => applyPlanningDraft()}>Apply plan</button></div>
    {open && <div className="plan-tray-detail"><p className="hint">Shared across every workspace. These changes have not been applied. One apply, one undo.</p><ul>{commands.map(c => <li key={commandKey(c)}><span>{planningCommandLabel(state, seat, c)}</span><button aria-label={`Remove ${planningCommandLabel(state, seat, c)}`} onClick={() => removePlanningCommand(commandKey(c))}>Remove</button></li>)}</ul><button onClick={clearPlanningDraft}>Discard all changes</button></div>}
    {!!after.errors.length && <p role="alert">Resolve before applying: {after.errors.map(e=>e.reason).join(' · ')}</p>}
  </aside>
}
