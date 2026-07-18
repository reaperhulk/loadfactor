// First-flight coaching: one contextual hint at a time, derived from game
// state — never a modal tour. Dismiss once and it never returns (persisted).

import { useState } from 'react'
import type { GameState } from '../engine'
import { slotCities } from '../engine/queries'

const COACH_KEY = 'loadfactor:coach:v1'

function nextHint(state: GameState): string | null {
  const player = state.airlines[0]!
  if (player.routes.length === 0) {
    return 'Start here: click one of your blue cities on the map, then “✈ Open route from here” and pick a destination.'
  }
  if (player.fleet.every((a) => a.routeId === null)) {
    return 'Your jets are parked. Assign them on the fleet tab (or click the route and assign from its dossier).'
  }
  if (state.turn === 0) {
    return 'Ready? End the quarter (space) to fly the schedule and see your first report.'
  }
  if (state.turn <= 4 && player.negotiations.length === 0 && slotCities(player).length <= 4) {
    return 'Growth needs gates: open a city dossier and negotiate for slots at a new airport.'
  }
  return null
}

export function CoachMarks({ state }: { state: GameState }) {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(COACH_KEY) === 'done'
    } catch {
      return true
    }
  })
  if (dismissed || state.turn > 6) return null
  const hint = nextHint(state)
  if (hint === null) return null
  return (
    <div className="coach" data-testid="coach" role="status">
      <span>💡 {hint}</span>
      <button
        data-testid="coach-dismiss"
        onClick={() => {
          try {
            localStorage.setItem(COACH_KEY, 'done')
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
