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
// Hubs aren't free: every connecting pax pays baggage/transfer handling on
// EACH leg. Without this, transfer revenue had zero marginal cost beyond
// cabin service, and hub density was nearly free margin.
export const TRANSFER_HANDLING_PER_PAX = 8 // $ per connecting pax per leg
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
// Bidding wars: when several airlines court the same slot authority in one
// quarter, every outbid attempt keeps only this share of its odds — the
// authority is entertaining a richer suitor.

// --- Takeovers (M3 endgame) ---
// A DISTRESSED rival (insolvent last quarter, or worth a quarter of you or
// less) can be acquired for its net worth plus a premium, floored at a base
// fee — lawyers get paid even when the equity is worthless. Everything
// transfers: fleet, routes, slots, orders, and the debt.
export const TAKEOVER_PREMIUM_BP = 13000
export const TAKEOVER_BASE_K = 2000
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
export const OPERATIONS_MAINT_AGE_BP_PER_QUARTER = 150 // gradual aging: +6% of base maintenance per year
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
// Principal amortizes at this share of the remaining balance per quarter
// (with a $100k floor so stubs extinguish). Debt used to be perpetual
// interest-only capital — free leverage that compounded the late game.
export const LOAN_AMORT_BP = 500
export const BASE_LOAN_RATE_BP = 900 // annual
export const LOAN_RATE_ECONOMY_SLOPE = 5 // +1bp per 5bp of economy weakness
export const MIN_LOAN_RATE_BP = 500
// Debt ceiling = fleet resale value * LTV + DEBT_BASE_ALLOWANCE.
export const DEBT_LTV_BP = 6000
export const DEBT_BASE_ALLOWANCE = 20000 // $k
// Defeat: cash below zero at quarter end this many consecutive quarters.
export const INSOLVENCY_QUARTERS_TO_FAIL = 2
// A failing RIVAL restructures instead of liquidating, up to this many times:
// creditors take the loss, the fleet and network shrink to a survivable core,
// and the airline keeps racing. Only after the last chance does it die. A
// race with nobody left in it is not a race (probes showed every rival
// bankrupt by quarter 30 of 80).
export const RESTRUCTURE_MAX = 2
export const RESTRUCTURE_CASH_K = 9000 // survival capital injected, $k (inflated at use)
export const RESTRUCTURE_KEEP_ROUTES = 3
export const RESTRUCTURE_KEEP_FLEET = 3
// An empty seat draws a new entrant on this cadence — the industry never
// stays a one-airline world.
export const ENTRANT_EVERY_QUARTERS = 6
// A freshly capitalized entrant is not a distressed asset: it cannot be
// bought for this many quarters. Without the grace period a respawning field
// becomes a takeover farm for whoever is already winning.
export const ENTRANT_GRACE_QUARTERS = 8
// Market dominance draws regulatory scrutiny: above this share of industry
// seats, an airline's overhead climbs with its excess share. Applies to
// everyone, player included — the anti-runaway force that is also the
// thematically honest one (regulators hate monopolies).
// Dominance is measured against FAIR SHARE, not an absolute number: with
// three airlines parity is 33%, so a flat 40% threshold taxes whoever is
// merely ahead. Scrutiny starts at this multiple of parity (1.8x) — 60% in a
// three-way race, 45% in a four-way.
export const DOMINANCE_PARITY_MULT_BP = 18000
// Charged against REVENUE (not overhead) so it scales with the airline it is
// restraining rather than being rounding error to a monopolist.
export const DOMINANCE_SCRUTINY_BP = 5000
// Hard ceiling on the charge: scrutiny is a drag on dominance, never a
// death sentence. The reference bot cannot perceive this mechanic, so an
// uncapped version reads as pure punishment in the balance envelope.
export const DOMINANCE_SCRUTINY_MAX_BP = 600

// --- Airport capacity (see engine/slots.ts) ---
// Slots are rented from an airport authority, not auctioned. Both prices
// scale with (pop + biz) — capacity at a great airport is dear to take and
// dear to keep.
export const SLOTS_PER_GRANT = 2
// One-off fee to join a city's waiting list, per (pop + biz) point. Sized so
// a foothold at a major hub is a real capital decision next to an airframe,
// not the rounding error the old bidding spend had become.
export const SLOT_FEE_PER_POINT = 150 // $k
// Quarterly rent per slot held, per point. This is what makes hoarding
// positions you cannot fly a visible bill instead of the silent confiscation
// use-it-or-lose-it performed.
export const SLOT_RENT_PER_POINT = 3 // $k
// Airport building programmes: every city expands on this cadence, with a
// per-city phase so the world's openings are spread across the calendar.
export const EXPANSION_EVERY_QUARTERS = 24
export const EXPANSION_SIZE_BASE = 1
export const EXPANSION_SIZE_PER_POINT = 10 // +1 slot per this many (pop + biz)
// How long an operator will wait for capacity that does not exist yet: queue
// at a full airport only if the builders arrive within this many quarters.
export const SLOT_WAIT_PATIENCE = 12

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

// ---- World offers (F5): timed questions the world puts to the player ----
export const OFFER_CHANCE_BP = 1400 // per quarter, when nothing is pending
export const OFFER_DECISION_QUARTERS = 3 // answer within this many quarters
export const OFFER_GAMES_LEAD_QUARTERS = 6 // commitments pay off this far out
export const OFFER_GAMES_BONUS_BP = 3500 // +35% appeal on routes touching the host
export const OFFER_SLOTS_GRANTED = 3
export const OFFER_FUEL_PREMIUM_BP = 500 // the price of three years of certainty

// ---- Reliability and reputation (F2): risk that scales with the airline ----
// Airframes past this age start breaking; the chance climbs with every extra
// quarter of service. Deferring renewal is now a gamble, not just a saving.
export const GROUNDING_AGE_QUARTERS = 28
export const GROUNDING_BP_PER_QUARTER_OVER = 18 // per quarter of age past the threshold
export const GROUNDING_MAX_BP = 1400 // ceiling on any single airframe's risk
export const GROUNDING_QUARTERS = 1 // out of service
export const GROUNDING_REPAIR_BP = 400 // repair bill as bp of list price
export const REPUTATION_HIT_PER_GROUNDING = 250 // bp knocked off per grounding
export const REPUTATION_RECOVERY_BP = 120 // bp healed per quarter
export const REPUTATION_MIN_BP = 7000 // reputation floor — never a death spiral
// How strongly reputation moves appeal on a contested pair: at the floor an
// airline carries a noticeable, survivable disadvantage.
export const REPUTATION_APPEAL_WEIGHT_BP = 5000
// Milestones on the era's objective, as percentages of its target. A rate
// metric (load factor) needs a different ladder: 25% of a target load factor
// is a terrible quarter, not an achievement — so rates mark the approach.
export const MILESTONE_PCTS: readonly number[] = [25, 50, 75, 100]
export const MILESTONE_PCTS_RATE: readonly number[] = [85, 95, 100]

// --- Rules 5: the race (see engine/rivals.ts, engine/turn.ts) ---
// A late entrant arrives capitalized against the FIELD, not the era's opening
// stake: this share of the leader's net worth (floored at the scenario
// stake), spent partly on metal so it can fly on arrival.
export const ENTRANT_CAPITAL_LEADER_BP = 3000
// When the leader is dominant (ahead of the runner-up by this multiple) the
// empty seat draws a state-backed flag carrier with a deeper treasury.
export const ENTRANT_BACKED_CAPITAL_BP = 5000
export const DOMINANT_LEAD_MULT_BP = 20000
// Metal on arrival: up to this many airframes, never more than half the
// capital.
export const ENTRANT_MAX_FRAMES = 8
export const ENTRANT_EVERY_QUARTERS_V5 = 4
// Chapter 11 under rules 5 recapitalizes against the field too, so a rival
// that stumbles in year 12 comes back as an airline, not a footnote.
export const RESTRUCTURE_LEADER_BP = 1000
// A raid needs appetite: cash above this multiple of the operating buffer.
export const RAID_CASH_BUFFER_MULT_BP = 15000
// A held city stays held while some network anchor still offers a pair at
// least this rich (competition-discounted weekly pax); the reference bot and
// the rivals both keep such footholds instead of renting them twice.
export const RELEASE_KEEP_PAIR_SCORE = 800

// --- Rules 5: the world asks questions (see engine/offers.ts, worldEvents.ts) ---
// Events land about every four quarters instead of every seven.
export const EVENT_DRAW_CHANCE_BP_V5 = 2500
// A type is news for its first eight quarters on sale: seats flown on it
// carry this much extra appeal (capacity-weighted) — early adopters win share.
export const DEBUT_APPEAL_BP = 1500
export const DEBUT_APPEAL_QUARTERS = 8
// One offer every four quarters, seven kinds; the answer window stays four.
export const OFFER_EVERY_QUARTERS_V5 = 4
// An unsettled hub strike grounds this share of the airline's trips touching
// the struck city for one quarter.
export const STRIKE_CAPACITY_BP = 7000
// A production slot that jumps the queue costs this premium on list price.
export const EARLY_DELIVERY_PREMIUM_BP = 1500
// A liquidation sale prices used metal at this share of resale value.
export const FLEET_SALE_PRICE_BP = 5500
// Bilateral route rights: exclusivity on one pair for this many quarters.
export const ROUTE_RIGHTS_QUARTERS = 8

// --- Rules 5: the cabin is a product, not a seat count ---
// Under rules 2-4 only business travellers saw the cabin (through yield),
// so a high-density fit was 15% more seats for nothing: the one dominant
// build every doctrine converged on. Now each segment weighs the fit:
// business hates a dense cabin, leisure notices it, budget does not care.
// Indexed by cabin - 1 (dense / standard / premium), bp.
export const CABIN_SEGMENT_APPEAL_BP = {
  business: [7000, 10000, 12000],
  leisure: [8500, 10000, 11000],
  budget: [10000, 10000, 10000],
} as const
// A rules-5 price campaign is a real war: fares go to the floor at the city.
export const PRICE_WAR_FARE_LEVEL = -2
// Rules 5 yields: a dense cabin sells cheaper seats (15% more of them at 92%
// of the fare), so at full loads it earns only a little more and loses the
// travellers who notice legroom wherever there is a choice.
export const CABIN_YIELD_BP_V5: readonly number[] = [9200, 10000, 12000]
// Rules 5 brain: the (n+1)th route must be expected to contribute at least
// this multiple of the quadratic overhead it adds, judged by the airline's
// own contribution per passenger last quarter. Sprawl has a price, and the
// reference bot, the rivals and the fuzz genome all read it.
export const SPRAWL_HURDLE_BP = 15000

// --- Rules 6: price is a lever again, the world warns, cash has a use ---
// How strongly each segment walks away from a fare above the standard ladder
// (bp of the excess). Steeper than rules 2-5 at the top: a top fare now sheds
// travellers even on a monopoly, so it is a yield choice, not a default. On
// the probe (jet_age, greedy and budget, three seeds) the profit-maximizing
// fare at year 15 moved from +2 on 94% of routes to 0/+1/+2 at 27/41/32%.
// Indexing fares to inflation was tried and rejected: at half the cost drift
// it doubled late-career net worth and broke the runaway bound.
export const FARE_ELASTICITY_V6 = { business: 5000, leisure: 11000, budget: 15000 } as const
// Cheap fares grow the market: travellers who would not have flown at the
// standard fare fly at a discount (bp of the discount), capped.
export const FARE_STIMULATION_V6 = { business: 0, leisure: 8000, budget: 15000 } as const
export const FARE_STIMULATION_CAP_BP = 14000
// Business travellers notice price too, gently: their weight scales by
// (priceAppeal + this) / (standard priceAppeal + this).
export const BUSINESS_PRICE_DAMPING = 22000
// Service yields: a better product earns a better fare mix per passenger
// (upgrades, fewer discounted seats), so service pays even on a full plane.
// Standard service is the reference fare. Probed against the doctrine race
// and the runaway bound: +14% at full service overheated Oil Crisis past
// 10x its target, and a 5% basic-service discount trapped the pax-mandate
// bot on a deregulation seed; this curve cleared both.
export const SERVICE_YIELD_BP_V6: readonly number[] = [9800, 10000, 10900]
// Hedges price as a share of the fuel bill they cover, per quarter, and
// may cover part of the burn. A 100% hedge on a large fleet was 0.6% of the
// bill — free insurance. Now it is a real premium, scaled to what it saves.
export const HEDGE_PREMIUM_BP_OF_FUEL_V6 = 400
export const HEDGE_COVER_OPTIONS_BP: readonly number[] = [5000, 10000]
// Every world event is announced this many quarters before it lands, so an
// oil shock is a decision (hedge, trim, bank cash) instead of an ambush.
export const EVENT_WARNING_QUARTERS_V6 = 1
// Terminal programmes: pay the authority to bring a city's next expansion
// forward to next quarter. Price per slot delivered, per (pop + biz) point.
export const TERMINAL_COST_PER_SLOT_POINT_V6 = 90 // $k
// The funder takes this many of the new slots straight away; the rest go to
// the waiting list as usual.
export const TERMINAL_FUNDER_SLOTS_V6 = 2
// New-build delivery lines: at most this many new-build orders (purchase or
// lease) per airline per quarter, rivals and players alike.
export const ORDERS_PER_QUARTER_V6 = 4
// A raid picks among the leader's top markets by a stateless hash, not
// always the single best one.
export const RAID_CHOICES_V6 = 3
// Load-factor mandates weigh scale: to qualify, an airline's seats flown last
// quarter must reach this share of the median live competitor's. Filling a
// token schedule was the winning efficiency play; now it disqualifies.
export const LF_FIELD_SCALE_BP_V6 = 5000
// Event-linked offers: the world asks what you will do about the news.
export const OFFICIAL_CARRIER_DEMAND_BP_V6 = 2500 // +25% demand on the host's pairs you fly
export const AIRLIFT_CAPACITY_BP_V6 = 5000 // share of trips into the region still flying
