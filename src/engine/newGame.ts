import { getAircraftType } from '../data/aircraft'
import { CITIES, distanceKm, getCity } from '../data/cities'
import { AI_MIN_ROUTE_KM } from '../data/constants'
import { getScenario, type AirlineSetup } from '../data/scenarios'
import { deriveStream } from './rng'
import type { Airline, GameState } from './types'

// Player customization at game start. Part of the replay: the same
// (scenario, seed, customization, commands) always reproduces the same game.
export interface PlayerSetup {
  name?: string
  hq?: string // city id; foothold slots are derived from it
}

// A custom HQ replaces the scenario's authored footholds with a derived set:
// the three best nearby cities (close enough to reach with a starter fleet,
// far enough to clear the ground-competition demand band), strongest first.
// Deterministic — pure data, no RNG.
export function deriveFootholds(hq: string): Record<string, number> {
  const candidates = CITIES.filter((c) => {
    if (c.id === hq) return false
    const km = distanceKm(hq, c.id)
    return km >= AI_MIN_ROUTE_KM && km <= 3000
  })
    .map((c) => ({ id: c.id, mass: c.pop * 4 + c.biz * 3 + c.tour * 2, km: distanceKm(hq, c.id) }))
    .sort((a, b) => b.mass - a.mass || a.km - b.km || a.id.localeCompare(b.id))
    .slice(0, 3)
  const out: Record<string, number> = {}
  candidates.forEach((c, i) => {
    out[c.id] = i === 0 ? 4 : 2
  })
  return out
}

function makeAirline(id: number, setup: AirlineSetup, controller: 'player' | 'rival'): Airline {
  getCity(setup.hq) // validate data
  const airline: Airline = {
    id,
    name: setup.name,
    controller,
    personality: controller === 'player' ? 'player' : (setup.personality ?? 'balanced'),
    hq: setup.hq,
    cash: setup.cash,
    loans: [],
    fleet: [],
    orders: [],
    routes: [],
    slots: { [setup.hq]: setup.hqSlots, ...setup.extraSlots },
    negotiations: [],
    slotIdle: {},
    fuelHedge: null,
    insolventQuarters: 0,
    bankrupt: false,
    history: [],
    nextId: 1,
  }
  for (const type of setup.starterFleet) {
    getAircraftType(type) // validate data
    airline.fleet.push({ id: airline.nextId++, type, ageQuarters: 0, routeId: null, leased: false, cabin: 2 })
  }
  return airline
}

export function newGame(scenarioId: string, seed: string, player?: PlayerSetup): GameState {
  const scenario = getScenario(scenarioId)
  // Customization overlays the scenario's authored player seat. A custom HQ
  // swaps the authored footholds for ones derived around the new home.
  let playerSetup: AirlineSetup = scenario.player
  if (player?.name !== undefined && player.name.trim() !== '') {
    playerSetup = { ...playerSetup, name: player.name.trim().slice(0, 40) }
  }
  if (player?.hq !== undefined && player.hq !== scenario.player.hq) {
    getCity(player.hq) // throws on unknown city
    playerSetup = { ...playerSetup, hq: player.hq, extraSlots: deriveFootholds(player.hq) }
  }
  const airlines = [makeAirline(0, playerSetup, 'player')]
  scenario.rivals.forEach((r, i) => airlines.push(makeAirline(i + 1, r, 'rival')))
  return {
    scenario: scenarioId,
    seed,
    turn: 0,
    phase: 'planning',
    rng: {
      economy: deriveStream(seed, 'economy'),
      events: deriveStream(seed, 'events'),
      negotiations: deriveStream(seed, 'negotiations'),
      rivals: deriveStream(seed, 'rivals'),
    },
    world: { economyBp: 10000, fuelBp: 10000, events: [], usedMarket: [] },
    airlines,
  }
}
