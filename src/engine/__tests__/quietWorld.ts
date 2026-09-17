// Rules 5 rivals take an opening planning turn inside newGame (routes flown,
// slots queued, campaigns announced). Mechanics probes that stage a contested
// pair or a waiting list by hand want the old blank field instead.
import type { GameState } from '../types'

export function quietWorld(state: GameState): GameState {
  for (const airline of state.airlines) {
    if (airline.controller !== 'rival') continue
    airline.routes = []
    for (const ac of airline.fleet) { ac.routeId = null; delete ac.secondaryRouteId }
    airline.orders = []
    airline.slotRequests = []
    delete airline.slotInterest
    delete airline.campaign
    airline.servedUntil = {}
    airline.marketing = 0
  }
  return state
}
