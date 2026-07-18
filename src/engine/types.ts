import type { Region } from '../data/cities'
import type { Rng } from './rng'

// GameState is the entire simulation. It must stay plain JSON data: no classes,
// Maps, functions, or undefined holes. JSON round-tripping mid-career is
// lossless (determinism.test.ts proves it). A full game is
// (scenario, seed, Command[]) — see PLAN.md §3.1.

export type Phase = 'planning' | 'won' | 'lost'

export interface RngStreams {
  economy: Rng
  events: Rng
  negotiations: Rng
  rivals: Rng
}

export interface Loan {
  id: number
  principal: number // $k
  annualRateBp: number
}

export interface OwnedAircraft {
  id: number
  type: string // AircraftType id
  ageQuarters: number
  routeId: number | null
}

export interface AircraftOrder {
  id: number
  type: string
  quartersLeft: number
}

export interface Route {
  id: number
  from: string // city id, lexicographically < to
  to: string
  fareLevel: number // -2..+2
  serviceLevel: number // 1..3
  // Last quarter's results, for the UI and bot policies.
  lastPax: number
  lastCapacity: number
  lastLoadFactorBp: number
  lastRevenue: number // $k
  lastCost: number // $k
}

export interface PendingNegotiation {
  city: string
  spend: number // $k, already paid at command time
}

export interface QuarterStats {
  turn: number
  cash: number
  revenue: number
  costs: number
  profit: number
  pax: number
  netWorth: number
}

export interface Airline {
  id: number // index into GameState.airlines; 0 = player
  name: string
  controller: 'player' | 'rival'
  hq: string
  cash: number // $k
  loans: Loan[]
  fleet: OwnedAircraft[]
  orders: AircraftOrder[]
  routes: Route[]
  slots: Record<string, number> // city id → slots held (read via sorted keys only)
  negotiations: PendingNegotiation[]
  insolventQuarters: number
  bankrupt: boolean
  history: QuarterStats[]
  nextId: number // shared id counter for aircraft/orders/routes/loans
}

export interface ActiveEvent {
  id: string // WorldEventDef id
  quartersLeft: number
  city: string | null
  region: Region | null
}

export interface WorldState {
  economyBp: number // random-walk index, 10000 = neutral
  fuelBp: number // random-walk fuel price index, 10000 = baseline
  events: ActiveEvent[]
}

export interface GameState {
  scenario: string
  seed: string
  turn: number // quarters since scenario start
  phase: Phase
  rng: RngStreams
  world: WorldState
  airlines: Airline[]
}

// Player actions. Serializable, validated by applyCommand; invalid commands
// reject with a command_rejected event, never throw.
export type Command =
  | { type: 'open_route'; from: string; to: string; fareLevel?: number; serviceLevel?: number }
  | { type: 'close_route'; routeId: number }
  | { type: 'set_fare'; routeId: number; fareLevel: number }
  | { type: 'set_service'; routeId: number; serviceLevel: number }
  | { type: 'assign_aircraft'; aircraftId: number; routeId: number | null }
  | { type: 'order_aircraft'; aircraftType: string }
  | { type: 'sell_aircraft'; aircraftId: number }
  | { type: 'negotiate_slots'; city: string; spend: number }
  | { type: 'take_loan'; amount: number }
  | { type: 'repay_loan'; loanId: number; amount: number }
  | { type: 'end_quarter' }

// Observable effects — the only channel out of the engine. The UI report,
// tests, and bot telemetry are all built from these.
export type GameEvent =
  | { type: 'command_rejected'; airline: number; command: Command; reason: string }
  | { type: 'route_opened'; airline: number; routeId: number; from: string; to: string }
  | { type: 'route_closed'; airline: number; routeId: number }
  | { type: 'fare_set'; airline: number; routeId: number; fareLevel: number }
  | { type: 'service_set'; airline: number; routeId: number; serviceLevel: number }
  | { type: 'aircraft_assigned'; airline: number; aircraftId: number; routeId: number | null }
  | { type: 'aircraft_ordered'; airline: number; orderId: number; aircraftType: string; price: number }
  | { type: 'aircraft_delivered'; airline: number; aircraftId: number; aircraftType: string }
  | { type: 'aircraft_sold'; airline: number; aircraftId: number; proceeds: number }
  | { type: 'negotiation_started'; airline: number; city: string; spend: number }
  | { type: 'negotiation_failed'; airline: number; city: string }
  | { type: 'slots_granted'; airline: number; city: string; slots: number }
  | { type: 'loan_taken'; airline: number; loanId: number; amount: number; annualRateBp: number }
  | { type: 'loan_repaid'; airline: number; loanId: number; amount: number; remaining: number }
  | { type: 'world_event_started'; eventId: string; city: string | null; region: Region | null }
  | { type: 'world_event_ended'; eventId: string }
  | { type: 'economy_updated'; economyBp: number; fuelBp: number }
  | {
      type: 'route_result'
      airline: number
      routeId: number
      pax: number
      capacity: number
      loadFactorBp: number
      revenue: number // $k
      cost: number // $k
    }
  | {
      type: 'quarter_report'
      airline: number
      turn: number
      revenue: number
      costs: number
      profit: number
      cash: number
      netWorth: number
      pax: number
    }
  | { type: 'airline_bankrupt'; airline: number }
  | { type: 'game_over'; result: 'won' | 'lost'; reason: string }

export interface EngineResult {
  state: GameState
  events: GameEvent[]
}
