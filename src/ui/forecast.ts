import type { GameState } from '../engine'
import { forecastQuarter } from '../engine/forecast'

// Session snapshots are immutable. Share one baseline forecast per snapshot
// and seat between the persistent HUD, review, desk and selected-entity tools.
// Weak keys release previous snapshots when undo and React no longer use them.
const forecasts = new WeakMap<GameState, Map<number, ReturnType<typeof forecastQuarter>>>()
export function planningForecast(state: GameState, seat: number) {
  let seats = forecasts.get(state)
  if (!seats) { seats = new Map(); forecasts.set(state, seats) }
  let forecast = seats.get(seat)
  if (!forecast) { forecast = forecastQuarter(state, seat); seats.set(seat, forecast) }
  return forecast
}
