import { getAircraftType } from '../data/aircraft'
import { getCity } from '../data/cities'
import { getScenario, type AirlineSetup } from '../data/scenarios'
import { deriveStream } from './rng'
import type { Airline, GameState } from './types'

function makeAirline(id: number, setup: AirlineSetup, controller: 'player' | 'rival'): Airline {
  getCity(setup.hq) // validate data
  const airline: Airline = {
    id,
    name: setup.name,
    controller,
    hq: setup.hq,
    cash: setup.cash,
    loans: [],
    fleet: [],
    orders: [],
    routes: [],
    slots: { [setup.hq]: setup.hqSlots, ...setup.extraSlots },
    negotiations: [],
    insolventQuarters: 0,
    bankrupt: false,
    history: [],
    nextId: 1,
  }
  for (const type of setup.starterFleet) {
    getAircraftType(type) // validate data
    airline.fleet.push({ id: airline.nextId++, type, ageQuarters: 0, routeId: null })
  }
  return airline
}

export function newGame(scenarioId: string, seed: string): GameState {
  const scenario = getScenario(scenarioId)
  const airlines = [makeAirline(0, scenario.player, 'player')]
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
    world: { economyBp: 10000, fuelBp: 10000, events: [] },
    airlines,
  }
}
