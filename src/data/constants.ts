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
// Era growth: +1.25%/quarter for the first decade of a scenario, tapering to
// +0.5%/quarter after — early jet-age boom, then a maturing market. Compresses
// the late-game money curve (M2 anti-compounding rule #2).
export const DEMAND_GROWTH_BP_PER_QUARTER = 125
export const DEMAND_GROWTH_TAPER_TURN = 40
export const DEMAND_GROWTH_LATE_BP_PER_QUARTER = 40
// Operating-cost inflation trails demand growth slightly: a saturated route's
// margin decays over the years, so growth must come from expansion and fleet
// renewal, never from sitting on a full plane (M1 anti-compounding rule).
// Applies to crew, fees, service, maintenance, admin, and overhead — not fuel
// (its own index) and not aircraft list prices (era-designed).
export const COST_INFLATION_BP_PER_QUARTER = 100
// Fuel's own nominal drift is gentler — the index walk supplies the drama.
export const FUEL_INFLATION_BP_PER_QUARTER = 50
export const DEMAND_NOISE_SPREAD_BP = 800

// --- Fares & service ---
// One-way base fare in $, concave with distance (long-haul $/km taper):
// FARE_BASE + min(km, TAPER)*NEAR/100 + max(0, km-TAPER)*FAR/100.
export const FARE_BASE = 22
export const FARE_PER_100KM_NEAR = 11
export const FARE_TAPER_KM = 3000
export const FARE_PER_100KM_FAR = 6
// Fare level -2..+2 → price multiplier bp.
export const FARE_LEVEL_PRICE_BP: readonly number[] = [8000, 9000, 10000, 11500, 13000]
// Fare level -2..+2 → attractiveness weight (cheap wins share).
export const FARE_LEVEL_WEIGHT: readonly number[] = [150, 125, 100, 80, 65]
// Fare level -2..+2 → demand elasticity bp: gouging sheds passengers even
// with no competitor on the pair (monopolies are not a free +30%).
export const FARE_DEMAND_BP: readonly number[] = [11000, 10500, 10000, 8900, 7400]
// Connecting traffic: for served city pairs with no direct flight, real
// itineraries route over a one-stop hub on the airline's own network, filling
// spare seats on both legs. Only this share of the pair's demand tolerates a
// connection, each leg sells at a through-fare discount, and the hub must not
// add more than this detour over the great-circle direct distance.
export const CONNECT_WILLING_BP = 5000
export const CONNECT_FARE_DISCOUNT_BP = 9000
export const CONNECT_DETOUR_MAX_BP = 14000
// Management complexity: quarterly overhead grows with the SQUARE of route
// count ($k × routes²) — sprawl has a real carrying cost.
export const ROUTE_OVERHEAD_QUAD = 25
// Service level 1..3 → attractiveness weight and cost per pax ($).
export const SERVICE_LEVEL_WEIGHT: readonly number[] = [100, 118, 140]
export const SERVICE_COST_PER_PAX: readonly number[] = [10, 17, 25]
// Cabin fit 1..3 (high-density / standard / premium): seats multiplier bp,
// attractiveness weight, and revenue-per-pax yield bp. Hardware trade-off —
// pack the tube or sell the space; service level is the soft product on top.
export const CABIN_SEATS_BP: readonly number[] = [11500, 10000, 8200]
export const CABIN_WEIGHT: readonly number[] = [90, 100, 118]
export const CABIN_YIELD_BP: readonly number[] = [9600, 10000, 12000]
// One refit costs this bp of the airframe's list price.
export const CABIN_REFIT_COST_BP = 250

// --- Operations ---
export const WEEKS_PER_QUARTER = 13
// Quarters of per-route results kept for the UI (rolling window).
export const ROUTE_HISTORY_QUARTERS = 24
// Spool-up: a route attaches only part of its demand share until travelers
// learn it exists — indexed by resolved quarters flown, then full strength.
// Incumbency is worth something; a raid takes quarters to bite.
export const ROUTE_SPOOL_BP = [8200, 9200, 9700] as const
// Market memory: re-entering a pair the airline served this recently skips
// the spool — travelers still know the product. Only genuinely new markets
// (or long-abandoned ones) ramp.
export const ROUTE_MEMORY_QUARTERS = 8
// Seasonality: tourism demand peaks in a city's summer quarter and dips in
// its winter (hemisphere by latitude sign; Q3 is northern summer). Amplitude
// scales with the city's tourism rating — beach towns breathe, business
// capitals barely notice.
export const SEASON_TOUR_BP_PER_POINT = 60
// Minutes of weekly block time one airframe can fly.
export const WEEKLY_BLOCK_MINUTES = 6000
export const MIN_ROUTE_KM = 300
// Bot/rival policies refuse routes shorter than this: the ground-competition
// demand band makes them traps (players may still open them).
export const AI_MIN_ROUTE_KM = 800
// Landing + handling fee per leg = FEE_BASE + seats * FEE_PER_SEAT ($).
export const LANDING_FEE_BASE = 200
export const LANDING_FEE_PER_SEAT = 2
// Flight pay on top of salaries — the marginal crew cost of one more hour.
export const CREW_COST_PER_BLOCK_HOUR = 150 // $
// Crews are salaried per airframe, flying or not, as bp of list price per
// quarter. The airplane-and-its-people are the expensive part of an airline;
// the marginal flight is comparatively cheap. Parking the schedule saves
// fuel and fees, not the payroll.
export const CREW_SALARY_BP_PER_QUARTER = 300
// Maintenance escalates with age: base * (10000 + AGE_BP*ageQuarters)/10000.
export const MAINT_AGE_BP_PER_QUARTER = 300
// Quarterly ownership cost (depreciation+insurance) as bp of list price.
export const OWNERSHIP_BP_PER_QUARTER = 400
export const AIRLINE_OVERHEAD_PER_QUARTER = 400 // $k
export const AIRCRAFT_ADMIN_PER_QUARTER = 40 // $k per airframe

// --- Brand (marketing spend) ---
// A per-quarter marketing budget (levels 0..3) that buys pair appeal in the
// share battle. Spend scales with network size so the lever stays priced to
// the airline it promotes; the weight edge multiplies routeShareWeight.
export const MARKETING_MAX_LEVEL = 3
export const MARKETING_BASE_PER_LEVEL = 400 // $k/q per level
export const MARKETING_PER_ROUTE_PER_LEVEL = 30 // $k/q per route per level
export const MARKETING_WEIGHT_BP_PER_LEVEL = 400 // +4% pair appeal per level

// --- Leasing, used market, hedging (M2 fleet depth) ---
// Cancelling a purchase order refunds this bp of the price paid — the
// manufacturer keeps a deposit. Leased orders cancel free (nothing was paid).
export const ORDER_CANCEL_REFUND_BP = 8000
// Quarterly lease payment as bp of list price (no capex, no resale). Sits
// above the ownership rate — flexibility costs a premium.
export const LEASE_BP_PER_QUARTER = 600
export const USED_OFFERS_PER_QUARTER = 3
// Used price: resale value plus a dealer margin.
export const USED_MARGIN_BP = 800
export const HEDGE_MIN_QUARTERS = 2
export const HEDGE_MAX_QUARTERS = 8
// Hedge premium per quarter hedged, per airframe in the fleet ($k).
export const HEDGE_PREMIUM_PER_AIRCRAFT = 30

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
// Use it or lose it: a city with this many (or more) unused slots for this
// many consecutive quarters hands one back to the authority. The HQ is exempt.
export const SLOT_IDLE_THRESHOLD = 2
export const SLOT_IDLE_QUARTERS_TO_LOSE = 4

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
