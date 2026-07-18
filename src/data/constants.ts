// Tuning constants. Money is $k, rates/multipliers are basis points
// (10000 = ×1) unless noted. Balance changes here must go through
// `npm run goldens:update` and keep the balance envelope green (CLAUDE.md §7).

// --- Demand (PLAN.md §2.2) ---
// City mass = pop*4 + biz*3 + tour*2 (max 90). Weekly pair demand =
// max(0, massA*massB - DEMAND_MASS_FLOOR) * 100 / distance-band factor,
// then scaled by economy, era growth, events, and stateless noise.
export const DEMAND_MASS_FLOOR = 2000
// [maxKm, factor] bands: ground competition kills ultra-short hops, medium
// haul is the sweet spot, ultra-long-haul thins.
export const DEMAND_DIST_BANDS: readonly (readonly [number, number])[] = [
  [500, 400],
  [1500, 100],
  [4000, 80],
  [8000, 110],
  [Infinity, 170],
]
// Era growth: +1.25%/quarter compounding-ish (linear approx) ≈ 5%/yr jet-age boom.
export const DEMAND_GROWTH_BP_PER_QUARTER = 125
// Operating-cost inflation trails demand growth slightly: a saturated route's
// margin decays over the years, so growth must come from expansion and fleet
// renewal, never from sitting on a full plane (M1 anti-compounding rule).
// Applies to crew, fees, service, maintenance, admin, and overhead — not fuel
// (its own index) and not aircraft list prices (era-designed).
export const COST_INFLATION_BP_PER_QUARTER = 100
export const DEMAND_NOISE_SPREAD_BP = 800

// --- Fares & service ---
// One-way base fare in $, concave with distance (long-haul $/km taper):
// FARE_BASE + min(km, TAPER)*NEAR/100 + max(0, km-TAPER)*FAR/100.
export const FARE_BASE = 25
export const FARE_PER_100KM_NEAR = 12
export const FARE_TAPER_KM = 3000
export const FARE_PER_100KM_FAR = 6
// Fare level -2..+2 → price multiplier bp.
export const FARE_LEVEL_PRICE_BP: readonly number[] = [8000, 9000, 10000, 11500, 13000]
// Fare level -2..+2 → attractiveness weight (cheap wins share).
export const FARE_LEVEL_WEIGHT: readonly number[] = [150, 125, 100, 80, 65]
// Service level 1..3 → attractiveness weight and cost per pax ($).
export const SERVICE_LEVEL_WEIGHT: readonly number[] = [100, 115, 128]
export const SERVICE_COST_PER_PAX: readonly number[] = [10, 18, 28]

// --- Operations ---
export const WEEKS_PER_QUARTER = 13
// Quarters of per-route results kept for the UI (rolling window).
export const ROUTE_HISTORY_QUARTERS = 24
// Minutes of weekly block time one airframe can fly.
export const WEEKLY_BLOCK_MINUTES = 6000
export const MIN_ROUTE_KM = 300
// Bot/rival policies refuse routes shorter than this: the ground-competition
// demand band makes them traps (players may still open them).
export const AI_MIN_ROUTE_KM = 800
// Landing + handling fee per leg = FEE_BASE + seats * FEE_PER_SEAT ($).
export const LANDING_FEE_BASE = 300
export const LANDING_FEE_PER_SEAT = 3
export const CREW_COST_PER_BLOCK_HOUR = 500 // $
// Maintenance escalates with age: base * (10000 + AGE_BP*ageQuarters)/10000.
export const MAINT_AGE_BP_PER_QUARTER = 300
// Quarterly ownership cost (depreciation+insurance) as bp of list price.
export const OWNERSHIP_BP_PER_QUARTER = 250
export const AIRLINE_OVERHEAD_PER_QUARTER = 400 // $k
export const AIRCRAFT_ADMIN_PER_QUARTER = 40 // $k per airframe

// --- Fleet market ---
// Resale value: price * (RESALE_INITIAL_BP - RESALE_DECAY_BP*ageQuarters),
// floored. Aircraft depreciate the moment they deliver — buying fleet is a
// real capital decision, not a cash-to-asset shuffle.
export const RESALE_INITIAL_BP = 8800
export const RESALE_DECAY_BP_PER_QUARTER = 150
export const RESALE_FLOOR_BP = 3000

// --- Finance ---
export const BASE_LOAN_RATE_BP = 900 // annual
export const LOAN_RATE_ECONOMY_SLOPE = 5 // +1bp per 5bp of economy weakness
export const MIN_LOAN_RATE_BP = 500
// Debt ceiling = fleet resale value * LTV + DEBT_BASE_ALLOWANCE.
export const DEBT_LTV_BP = 6000
export const DEBT_BASE_ALLOWANCE = 20000 // $k
// Defeat: cash below zero at quarter end this many consecutive quarters.
export const INSOLVENCY_QUARTERS_TO_FAIL = 2

// --- Slots & negotiations ---
// Base negotiation difficulty scales with how attractive the city is:
// difficulty $k = NEG_DIFFICULTY_PER_POINT * (pop + biz).
export const NEG_DIFFICULTY_PER_POINT = 100
export const NEG_MIN_SPEND = 200 // $k
export const NEG_BASE_CHANCE_BP = 2000
export const NEG_SPEND_CHANCE_BP = 6000 // added at spend == difficulty, pro rata
export const NEG_MAX_CHANCE_BP = 8500
export const SLOTS_PER_GRANT = 2

// --- World walks (PLAN.md §2.3) ---
export const ECONOMY_MIN_BP = 7000
export const ECONOMY_MAX_BP = 13000
export const ECONOMY_STEP_BP = 300
export const ECONOMY_REVERSION_DIV = 20
export const FUEL_MIN_BP = 6000
export const FUEL_MAX_BP = 20000
export const FUEL_STEP_BP = 400
export const FUEL_REVERSION_DIV = 30
// Chance per quarter that a new world event is drawn (if any is eligible).
export const EVENT_DRAW_CHANCE_BP = 1500
