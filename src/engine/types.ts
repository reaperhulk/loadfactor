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
  rivals: Rng
  offers: Rng
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
  // Leased airframes cost a quarterly payment instead of capital: no resale
  // value, no ownership cost, returned (not sold) when disposed.
  leased: boolean
  // Cabin fit: 1 = high-density (more seats, less appeal), 2 = standard,
  // 3 = premium (fewer seats, more appeal and yield). Refits cost cash.
  cabin: number
  // Grounded for maintenance until this turn: the airframe still draws crew
  // salaries and ownership, it just cannot fly. Old metal breaks (F2).
  groundedUntil?: number
}

export interface AircraftOrder {
  id: number
  type: string
  quartersLeft: number
  leased: boolean
}

// A used airframe on this quarter's market: instant delivery, already aged.
export interface UsedOffer {
  id: number
  type: string
  ageQuarters: number
  price: number // $k
}

// A fuel hedge locks the airline's effective fuel index for a few quarters.
export interface FuelHedge {
  bp: number
  quartersLeft: number
}

export interface RouteQuarter {
  turn: number
  pax: number
  transferPax: number // of pax, how many were connecting over a hub
  capacity: number
  loadFactorBp: number
  revenue: number // $k
  cost: number // $k
}

export interface Route {
  id: number
  from: string // city id, lexicographically < to
  to: string
  fareLevel: number // -2..+2
  serviceLevel: number // 1..3
  // Requested round trips per week. The schedule actually flown is
  // min(frequency, what the assigned fleet can fly) — see queries.ts.
  frequency: number
  // Last quarter's results, for the UI and bot policies.
  lastPax: number
  lastCapacity: number
  lastLoadFactorBp: number
  lastRevenue: number // $k
  lastCost: number // $k
  lastTransferPax: number
  // Rolling recent quarters (newest last, capped at ROUTE_HISTORY_QUARTERS).
  history: RouteQuarter[]
}

// A place on an airport's waiting list. The fee is paid at command time and
// refunded in full on cancellation; the queue is served in (queuedTurn,
// airline id) order, and a request holds its place until capacity exists.
export interface PendingSlotRequest {
  city: string
  fee: number // $k, already paid at command time
  queuedTurn: number
}

// Where the quarter's money went, $k. Sums exactly to QuarterStats.costs —
// every screen that explains costs draws from this, never from re-derivation.
export interface CostBreakdown {
  fuel: number
  fees: number // landing + handling
  flightPay: number // crew flight pay by block hour
  service: number // per-pax cabin service
  salaries: number // crew salaries per airframe, flying or not
  ownership: number // depreciation+insurance on owned, lease payments on leased
  maintenance: number
  admin: number // per-airframe administration
  slots: number // quarterly rent on every airport slot held
  overhead: number // airline overhead + quadratic route-count complexity
  marketing: number // brand spend (level × network size)
  interest: number
}

export interface QuarterStats {
  turn: number
  cash: number
  revenue: number
  costs: number
  profit: number
  debtPayment?: number // principal amortized this quarter (cash out, not a cost)
  pax: number
  transferPax?: number // connecting passengers carried (hub objectives)
  capacity?: number // seats flown (cost-per-seat objectives)
  netWorth: number
  breakdown: CostBreakdown
}

export interface Airline {
  id: number // index into GameState.airlines; 0 = player
  name: string
  controller: 'player' | 'rival'
  personality: string // rival archetype id ('player' for the human seat)
  hq: string
  cash: number // $k
  loans: Loan[]
  fleet: OwnedAircraft[]
  orders: AircraftOrder[]
  routes: Route[]
  slots: Record<string, number> // city id → slots held (read via sorted keys only)
  slotRequests: PendingSlotRequest[]
  // Market memory: pair key → last turn the airline flew it (stamped when a
  // route closes). Re-entry within ROUTE_MEMORY_QUARTERS skips the spool-up.
  servedUntil: Record<string, number>
  fuelHedge: FuelHedge | null
  marketing: number // brand spend level 0..MARKETING_MAX_LEVEL
  insolventQuarters: number
  bankrupt: boolean
  history: QuarterStats[]
  nextId: number // shared id counter for aircraft/orders/routes/loans
  deals?: ActiveDeal[] // accepted world offers still running
  // Operational reputation in basis points (10000 = spotless). Groundings
  // damage it and it heals slowly; it scales appeal on every contested pair,
  // so an aging fleet quietly costs market share as well as repair bills.
  reputationBp?: number
  restructures?: number // rivals only: chapter-11 rounds used (see RESTRUCTURE_MAX)
  enteredTurn?: number // set on late entrants; absent for founding airlines
  // Rivals only: the authority this carrier has announced it will queue at
  // next quarter. Campaigns are declared ahead so the player can get to the
  // waiting list first — the alternative is an ambush resolved inside a pass
  // nobody can watch.
  slotInterest?: string
}

export interface ActiveEvent {
  id: string // WorldEventDef id
  quartersLeft: number
  city: string | null
  region: Region | null
}

// A timed decision the world puts in front of the player (PLAN §2.3 / F5).
// World events are weather — they happen TO you. Offers are questions: pay
// now for a payoff later, take an asset and carry the obligation, bet on the
// fuel curve. They expire if ignored.
export interface WorldOffer {
  id: number
  kind: 'capacity_commitment' | 'regulator_slots' | 'fuel_contract'
  city: string | null
  expiresTurn: number // decide before this turn resolves
  costK: number // paid on acceptance
  upkeepK: number // charged each quarter until untilTurn
  benefitFromTurn: number // when the upside starts (commitments pay off later)
  untilTurn: number // when the benefit and the obligation both end
  slots: number // regulator_slots: authority granted at `city`
  demandBonusBp: number // capacity_commitment: appeal on routes touching `city`
  headline: string
  detail: string
}

// An accepted offer, living on the airline until it runs out.
export interface ActiveDeal {
  offerId: number
  kind: WorldOffer['kind']
  city: string | null
  fromTurn: number // the benefit starts here (a commitment pays off later)
  untilTurn: number
  upkeepK: number
  demandBonusBp: number
}

export interface WorldState {
  economyBp: number // random-walk index, 10000 = neutral
  fuelBp: number // random-walk fuel price index, 10000 = baseline
  events: ActiveEvent[]
  usedMarket: UsedOffer[] // rotates deterministically each quarter
  // The macro story per resolved quarter (fuel is the EFFECTIVE index,
  // event shocks included), rolling window for the finance charts.
  indexHistory: { turn: number; economyBp: number; fuelBp: number }[]
  offers: WorldOffer[] // open questions awaiting the player's answer
  nextOfferId: number
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
  | {
      type: 'open_route'
      from: string
      to: string
      // Opening a route is a real scheduling decision: it launches with a
      // specific aircraft and a weekly frequency that aircraft can fly.
      aircraftId: number
      frequency: number
      fareLevel?: number
      serviceLevel?: number
    }
  | { type: 'close_route'; routeId: number }
  | { type: 'set_fare'; routeId: number; fareLevel: number }
  | { type: 'set_service'; routeId: number; serviceLevel: number }
  | { type: 'set_frequency'; routeId: number; frequency: number }
  | { type: 'assign_aircraft'; aircraftId: number; routeId: number | null }
  | { type: 'order_aircraft'; aircraftType: string }
  | { type: 'cancel_order'; orderId: number }
  | { type: 'lease_aircraft'; aircraftType: string }
  | { type: 'buy_used'; offerId: number }
  | { type: 'hedge_fuel'; quarters: number }
  | { type: 'refit_cabin'; aircraftId: number; cabin: number }
  | { type: 'sell_aircraft'; aircraftId: number }
  | { type: 'set_marketing'; level: number }
  | { type: 'acquire_rival'; target: number }
  | { type: 'accept_offer'; offerId: number }
  | { type: 'decline_offer'; offerId: number }
  | { type: 'request_slots'; city: string }
  | { type: 'cancel_slot_request'; city: string }
  | { type: 'release_slots'; city: string; count: number }
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
  | { type: 'frequency_set'; airline: number; routeId: number; frequency: number }
  | { type: 'aircraft_assigned'; airline: number; aircraftId: number; routeId: number | null }
  | { type: 'aircraft_ordered'; airline: number; orderId: number; aircraftType: string; price: number }
  | { type: 'order_cancelled'; airline: number; orderId: number; refund: number }
  | { type: 'aircraft_leased'; airline: number; orderId: number; aircraftType: string; paymentPerQuarter: number }
  | { type: 'used_bought'; airline: number; aircraftId: number; aircraftType: string; price: number; ageQuarters: number }
  | { type: 'fuel_hedged'; airline: number; bp: number; quarters: number; premium: number }
  | { type: 'cabin_refit'; airline: number; aircraftId: number; cabin: number; cost: number }
  | { type: 'aircraft_delivered'; airline: number; aircraftId: number; aircraftType: string }
  | { type: 'aircraft_sold'; airline: number; aircraftId: number; proceeds: number }
  | { type: 'marketing_set'; airline: number; level: number }
  | { type: 'slot_requested'; airline: number; city: string; fee: number; queuePosition: number }
  | { type: 'airport_expanded'; city: string; slots: number }
  | { type: 'rival_acquired'; airline: number; target: number; price: number; aircraft: number; routes: number }
  | { type: 'slot_request_cancelled'; airline: number; city: string; refund: number }
  | { type: 'slots_released'; airline: number; city: string; slots: number }
  | { type: 'slots_granted'; airline: number; city: string; slots: number; waited: number }
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
      transferPax: number
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
      debtPayment: number // principal amortized (cash out, not a cost)
      cash: number
      netWorth: number
      pax: number
      breakdown: CostBreakdown
    }
  | { type: 'airline_bankrupt'; airline: number }
  | { type: 'airline_restructured'; airline: number; routesClosed: number; fleetSold: number; debtWiped: number }
  | { type: 'airline_entered'; airline: number; name: string; hq: string }
  | { type: 'offer_made'; offerId: number; kind: WorldOffer['kind']; headline: string; expiresTurn: number }
  | { type: 'offer_accepted'; offerId: number; kind: WorldOffer['kind']; costK: number }
  | { type: 'offer_declined'; offerId: number }
  | { type: 'offer_expired'; offerId: number; headline: string }
  | { type: 'deal_ended'; kind: WorldOffer['kind']; city: string | null }
  | { type: 'aircraft_grounded'; airline: number; aircraftId: number; aircraftType: string; quarters: number; repairK: number }
  | { type: 'milestone_reached'; airline: number; label: string; pctOfTarget: number }
  | { type: 'game_over'; result: 'won' | 'lost'; reason: string }

export interface EngineResult {
  state: GameState
  events: GameEvent[]
}
