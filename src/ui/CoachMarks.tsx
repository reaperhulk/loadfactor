// First-flight coaching: one contextual hint at a time, derived from game
// state — never a modal tour. Dismissal persists PER SCENARIO: waving off
// the hints in your first jet_age career must not silently disable coaching
// for every era you ever start (each one opens with a different board).

import { useState } from 'react'
import { pairKey } from '../data/cities'
import type { GameState } from '../engine'
import { slotCities } from '../engine/queries'
import { viewSeat } from './session'

const COACH_KEY = 'loadfactor:coach:v1' // legacy global key, still honored

function nextHint(state: GameState): string | null {
  const player = state.airlines[viewSeat()]!
  if (player.routes.length === 0) {
    return 'Start here: click one of your blue cities on the map, then “✈ Open route from here” and pick a destination.'
  }
  if (player.fleet.every((a) => a.routeId === null)) {
    return 'Your jets are parked. Assign them on the fleet tab (or click the route and assign from its dossier).'
  }
  if (state.turn === 0) {
    return 'Ready? End the quarter (space) to fly the schedule and see your first report.'
  }
  if (state.turn <= 4 && player.slotRequests.length === 0 && slotCities(player).length <= 4) {
    return 'Growth needs gates: open a city dossier and take a place in the line for slots at a new airport.'
  }
  // A rival is on one of your pairs and you're not fighting back with brand.
  const myPairs = new Set(player.routes.map((r) => pairKey(r.from, r.to)))
  const contested = state.airlines
    .filter((a) => a.id !== viewSeat())
    .some((a) => a.routes.some((r) => myPairs.has(pairKey(r.from, r.to))))
  if (state.turn >= 3 && contested && player.marketing === 0) {
    return 'A rival is on one of your pairs. Marketing (finance tab) buys appeal in every share battle.'
  }
  if (state.turn >= 3 && player.routes.length >= 1) {
    return 'Choose Find expansion options in the routes tab to compare feasible launches, costs and connecting traffic.'
  }
  return null
}

export function CoachMarks({ state }: { state: GameState }) {
  const scenarioKey = `${COACH_KEY}:${state.scenario}`
  const [dismissed, setDismissed] = useState(() => {
    try {
      // A pre-per-scenario global dismissal still silences jet_age only —
      // the era the player actually dismissed it in.
      const legacy = localStorage.getItem(COACH_KEY) === 'done' && state.scenario === 'jet_age'
      return legacy || localStorage.getItem(scenarioKey) === 'done'
    } catch {
      return true
    }
  })
  if (dismissed || state.turn > 2) return null
  const hint = nextHint(state)
  if (hint === null) return null
  return (
    <div className="coach" data-testid="coach" role="status">
      <div><strong>Flight school · {Math.min(3, state.turn + 1)} of 3 quarters</strong>
        <ol className="tutorial-steps"><li aria-current={state.turn === 0 ? 'step' : undefined}>Choose a market</li><li aria-current={state.turn === 1 ? 'step' : undefined}>Read profit & refine the schedule</li><li aria-current={state.turn === 2 ? 'step' : undefined}>Grow or protect your cash</li></ol>
        <span>💡 {state.turn === 1 ? 'Your report separates route contribution from company profit. Open the Planning workbench on Routes to compare a fare or schedule change, then commit it as one undoable action.' : state.turn === 2 ? 'Choose your pace: expand into another market, or keep a cash cushion and improve reliability. The operations desk explains the tradeoff.' : hint}</span>
      </div>
      <button
        data-testid="coach-dismiss"
        onClick={() => {
          try {
            localStorage.setItem(scenarioKey, 'done')
          } catch {
            // storage unavailable — session-only dismissal
          }
          setDismissed(true)
        }}
      >
        got it
      </button>
    </div>
  )
}
