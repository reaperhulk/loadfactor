// The shared strategy brain (PLAN §5.6, M3/M4): every competence the
// reference bot, the rivals, and the fuzzer have in common lives here,
// parameterized by dials. Three hand-copied versions of these rules drifted
// apart once already — rivals slammed schedules to the fleet maximum (the
// exact widebody flood the bot was cured of), fare floors disagreed, and the
// three negotiation targeters shared nothing. One module, three callers;
// dials for the differences that are MEANT to differ.
//
// Every function is pure: (state, airlineIdx, dials) → Command[] computed
// against the given snapshot. Callers decide when to apply and in what order.

import { getAircraftType, typesOnSale } from '../data/aircraft'
import { CITIES, distanceKm, getCity, pairKey } from '../data/cities'
import {
  AI_MIN_ROUTE_KM,
  CONNECT_DETOUR_MAX_BP,
  ROUTE_OVERHEAD_QUAD,
  SPRAWL_HURDLE_BP,
  WEEKS_PER_QUARTER,
  SLOT_WAIT_PATIENCE,
  ROUTE_MEMORY_QUARTERS,
  ROUTE_SPOOL_BP,
  ENTRANT_GRACE_QUARTERS,
  RELEASE_KEEP_PAIR_SCORE,
  TAKEOVER_BASE_K,
  TAKEOVER_PREMIUM_BP,
} from '../data/constants'
import { estimateAircraftQuarterCost, inflationBp, pairWeeklyDemand, routeSpoolBp } from './market'
import { getScenario } from '../data/scenarios'
import { nextExpansion, slotFee, slotsRemaining, terminalBlocker, terminalCost } from './slots'
import {
  airlinesOnPair,
  debtCeiling,
  maxRouteFrequency,
  netWorth,
  networkCities,
  pairWeeklySeats,
  roundTripsPerWeek,
  routeWeeklyCapacity,
  slotCities,
  slotsFree,
  totalDebt,
  yearOf,
} from './queries'
import { effFuelBp } from './worldEvents'
import { getEventDef } from '../data/events'
import type { Airline, Command, GameState } from './types'

// Rules 6 planning horizons for capital that pays back slowly.
const TERMINAL_MIN_HORIZON = 16
const TAKEOVER_MIN_HORIZON = 8

// The dials that make one competent operator different from another. The
// rivals' personalities, the greedy bot, and every fuzz genome all map onto
// this shape.
export interface PolicyDials {
  connectionFocus?: boolean
  fareLevel: number // launch fare posture [-2..2]
  serviceLevel: number // launch service posture [1..3]
  fareFloor: number // yield management never cuts below this
  expandMinDemand: number // min market score before opening a new pair
  contestDiscountBp: number // how heavily fielded seats discount a pair
  slotBudgetBp: number // treasury buffer kept back from slot fees, in bp
  raidBonus: number // appetite for cities the leader is entrenched in
  homeRegionUntil: number // build this many slot cities at home first
  marketing: number // brand level held while liquid
}

// Treasury buffer proportional to the cost base — one shock quarter must
// never blow straight through it.
export function cashBufferFor(airline: Airline): number {
  const lastCosts = airline.history[airline.history.length - 1]?.costs ?? 0
  return Math.max(3000, Math.floor(lastCosts / 2))
}

export function treasuryCommands(state: GameState, idx: number): Command[] {
  const airline = state.airlines[idx]!
  const buffer = cashBufferFor(airline)
  if (airline.cash >= buffer) return []
  // Debt discipline: rolling a fresh buffer loan every quarter while
  // UNPROFITABLE and already leveraged is a treadmill — each top-up adds
  // interest + amortization that guarantees the next shortfall. When the
  // debt itself is the drain, the answer is shrinking, not borrowing.
  // — unless the insolvency clock is already ticking: bankruptcy is strictly
  // worse than expensive debt, so a survival loan always beats the receiver.
  const lastProfit = airline.history[airline.history.length - 1]?.profit ?? 0
  if (
    airline.insolventQuarters === 0 &&
    lastProfit <= 0 &&
    totalDebt(airline) * 4 > debtCeiling(airline)
  )
    return []
  const room = debtCeiling(airline) - totalDebt(airline)
  const want = Math.min(room, buffer)
  return want >= 2000 ? [{ type: 'take_loan', amount: want }] : []
}

// Lock in cheap fuel when it is cheap — a hedge smooths the oil shocks that
// flip whole networks into paper-losers overnight.
export function hedgeCommands(state: GameState, idx: number): Command[] {
  const airline = state.airlines[idx]!
  if (airline.fuelHedge === null && airline.fleet.length > 0 && effFuelBp(state.world) <= 10500) {
    return [{ type: 'hedge_fuel', quarters: 4 }]
  }
  // Rules 6: an announced fuel shock is worth hedging even at today's price —
  // the lock carries only half of the shock the market is about to charge.
  if ((state.rulesVersion ?? 1) >= 6 && airline.fuelHedge === null && airline.fleet.length > 0 &&
      (state.world.announced ?? []).some((e) => (getEventDef(e.id).fuelModBp ?? 10000) > 10000)) {
    return [{ type: 'hedge_fuel', quarters: 4 }]
  }
  return []
}

// Rules 6: the highest fare a doctrine will charge on a full route: two
// steps above its launch posture, never past the top of the ladder.
export function fareCeilingFor(farePosture: number): number {
  return Math.min(2, farePosture + 2)
}

// Yield management plus retaliation, one decision per route. Packed routes
// raise fares; slack MONOPOLY routes cut toward the floor; on a CONTESTED
// pair a deep share loss (pax down a third with seats going empty) answers
// with a fare cut even before the slack threshold trips.
export function yieldCommands(state: GameState, idx: number, fareFloor: number, farePosture = 0): Command[] {
  const airline = state.airlines[idx]!
  const commands: Command[] = []
  // Rules 6: a full plane is a reason to raise fares only as far as the
  // doctrine's posture allows — a discount carrier that gouges when full is
  // not a discount carrier, and the top fare now sheds real demand.
  const ceiling = (state.rulesVersion ?? 1) >= 6 ? fareCeilingFor(farePosture) : 2
  for (const route of airline.routes) {
    if (route.lastCapacity === 0) continue
    if (route.lastLoadFactorBp >= 9700 && route.fareLevel < ceiling) {
      commands.push({ type: 'set_fare', routeId: route.id, fareLevel: route.fareLevel + 1 })
      continue
    }
    if (route.fareLevel <= fareFloor) continue
    if (route.lastLoadFactorBp < 5500) {
      commands.push({ type: 'set_fare', routeId: route.id, fareLevel: route.fareLevel - 1 })
      continue
    }
    const h = route.history
    if (h.length >= 2) {
      const last = h[h.length - 1]!
      const prev = h[h.length - 2]!
      const contested = airlinesOnPair(state, route.from, route.to, idx) > 0
      if (contested && last.pax * 3 < prev.pax * 2 && last.loadFactorBp < 7000) {
        commands.push({ type: 'set_fare', routeId: route.id, fareLevel: route.fareLevel - 1 })
      }
    }
  }
  return commands
}

// Capacity discipline on the schedule: slack MONOPOLY routes trim (empty
// seats burn fuel with no share to defend); packed routes grow in measured
// +50% steps — never a slam to the fleet maximum. Contested pairs hold
// frequency; schedule is share there.
export function scheduleCommands(state: GameState, idx: number): Command[] {
  const airline = state.airlines[idx]!
  const commands: Command[] = []
  for (const route of airline.routes) {
    if (route.lastCapacity === 0) continue
    const max = maxRouteFrequency(airline, route)
    const eff = Math.min(route.frequency, max)
    const contested = airlinesOnPair(state, route.from, route.to, idx) > 0
    if (!contested && route.lastLoadFactorBp < 5500 && eff > 2) {
      commands.push({ type: 'set_frequency', routeId: route.id, frequency: Math.max(2, Math.floor((eff * 3) / 4)) })
    } else if (route.lastLoadFactorBp >= 9000 && eff < max) {
      commands.push({
        type: 'set_frequency',
        routeId: route.id,
        frequency: Math.min(max, Math.max(eff + 1, Math.ceil((eff * 3) / 2))),
      })
    }
  }
  return commands
}

// Prune structurally losing routes: revenue under 85% of cost for TWO
// consecutive quarters (one bad quarter is weather; two is structure), at
// most two closures a quarter (a fuel spike flips half the network at once —
// closing everything collapses revenue while salaries keep drawing), never
// the final route, and never a route still spooling in a genuinely new
// market.
export function pruneCommands(state: GameState, idx: number): Command[] {
  const airline = state.airlines[idx]!
  const commands: Command[] = []
  let closable = Math.min(2, airline.routes.length - 1)
  for (const route of airline.routes) {
    if (closable <= 0) break
    const h = route.history
    const prevQ = h.length >= 2 ? h[h.length - 2]! : null
    // A route nothing flies is pure overhead (the quadratic route-count
    // complexity keeps billing it): two resolved quarters with zero capacity
    // and no metal assigned → close. The old rule only recognized losers
    // that FLEW, so a distress-sold route leaked overhead forever.
    const abandoned =
      prevQ !== null &&
      route.lastCapacity === 0 &&
      h[h.length - 1]!.capacity === 0 &&
      prevQ.capacity === 0 &&
      !airline.fleet.some((a) => a.routeId === route.id)
    const losingNow = route.lastCapacity > 0 && route.lastRevenue * 100 < route.lastCost * 85
    const losingBefore = prevQ !== null && prevQ.capacity > 0 && prevQ.revenue * 100 < prevQ.cost * 85
    const structural =
      losingNow && losingBefore && routeSpoolBp(airline, route, state.turn) === 10000
    if (abandoned || structural) {
      commands.push({ type: 'close_route', routeId: route.id })
      closable--
    }
  }
  return commands
}

// Distress: under water, sell the two oldest sellable airframes — idle ones
// first (a parked plane is a liability with a payroll), keeping a two-frame
// core. Cash today breaks an insolvency streak that would otherwise be fatal.
export function distressCommands(state: GameState, idx: number): Command[] {
  const airline = state.airlines[idx]!
  if (airline.cash >= 0 || airline.fleet.length <= 2) return []
  const sellable = airline.fleet
    .filter((a) => !a.leased)
    .sort((a, b) => {
      const idleA = a.routeId === null ? 0 : 1
      const idleB = b.routeId === null ? 0 : 1
      return idleA - idleB || b.ageQuarters - a.ageQuarters || a.id - b.id
    })
    .slice(0, Math.min(2, airline.fleet.length - 2))
  return sellable.map((ac) => ({ type: 'sell_aircraft', aircraftId: ac.id }))
}

// Fleet renewal: maintenance escalates with age and inflation compounds it —
// retire up to two geriatric airframes a quarter, keeping a two-frame core.
export function renewalCommands(state: GameState, idx: number, renewAge = 48): Command[] {
  const airline = state.airlines[idx]!
  if (airline.fleet.length <= 2) return []
  if (airline.operationsPolicy) {
    const commands: Command[] = []
    let availableCash = airline.cash - cashBufferFor(airline)
    for (const ac of [...airline.fleet].sort((a,b) => b.ageQuarters-a.ageQuarters || a.id-b.id)) {
      if (ac.ageQuarters < Math.max(60, renewAge) || ac.routeId === null || airline.orders.some(o => o.replacesAircraftId === ac.id)) continue
      const routes = airline.routes.filter(r => r.id === ac.routeId || r.id === ac.secondaryRouteId)
      const km = Math.max(...routes.map(r => distanceKm(r.from, r.to)))
      const current = estimateAircraftQuarterCost(state, ac.type, km)
      const candidate = typesOnSale(yearOf(state)).filter(t => t.id !== ac.type && t.rangeKm >= km && t.seats >= getAircraftType(ac.type).seats * 3 / 4)
        .map(t => ({ t, cost: estimateAircraftQuarterCost(state, t.id, km) }))
        .filter(x => x.cost < current).sort((a,b) => a.cost-b.cost || a.t.price-b.t.price)[0]
      if (!candidate) continue
      const leased = availableCash < candidate.t.price
      const required = leased ? Math.floor(candidate.t.price * 600 / 10000) : candidate.t.price
      // Keep maintained older aircraft unless fuel savings pay for renewal.
      if (availableCash < required || (leased && current - candidate.cost <= Math.floor(candidate.t.price * 200 / 10000))) continue
      commands.push({ type: 'order_replacement', aircraftId: ac.id, aircraftType: candidate.t.id, leased })
      availableCash -= required
      if (commands.length === 2) break
    }
    return commands
  }
  const geriatric = airline.fleet
    .filter((a) => a.ageQuarters >= (airline.operationsPolicy ? Math.max(80, renewAge) : renewAge) && !a.leased)
    .sort((a, b) => b.ageQuarters - a.ageQuarters || a.id - b.id)
    .slice(0, Math.min(2, airline.fleet.length - 2))
  return geriatric.map((ac) => ({ type: 'sell_aircraft', aircraftId: ac.id }))
}

// Cash-strapped with metal on the ground: a surplus idle airframe draws
// salaries and ownership for nothing — liquidate one a quarter.
export function surplusCommands(state: GameState, idx: number): Command[] {
  const airline = state.airlines[idx]!
  if (airline.cash >= cashBufferFor(airline) || airline.fleet.length <= 3) return []
  let surplus: Airline['fleet'][number] | null = null
  for (const ac of airline.fleet) {
    if (ac.routeId !== null || ac.leased || (airline.operationsPolicy && ac.reserve)) continue
    if (surplus === null || ac.ageQuarters > surplus.ageQuarters) surplus = ac
  }
  return surplus ? [{ type: 'sell_aircraft', aircraftId: surplus.id }] : []
}

// Brand posture: hold the dial's marketing level while liquid and once the
// network can carry the spend; a thin treasury goes dark first.
export function marketingCommands(state: GameState, idx: number, level: number): Command[] {
  const airline = state.airlines[idx]!
  const want = airline.cash >= cashBufferFor(airline) && airline.routes.length >= 3 ? level : 0
  return airline.marketing !== want ? [{ type: 'set_marketing', level: want }] : []
}

// Bring the fleet toward a cabin doctrine, a couple of refits a quarter when
// cash allows — dense fits pack seats, premium fits sell space.
export function refitCommands(state: GameState, idx: number, cabin: number): Command[] {
  const airline = state.airlines[idx]!
  if (airline.cash < 6000) return []
  const commands: Command[] = []
  for (const ac of airline.fleet) {
    if (commands.length >= 2) break
    if (ac.cabin !== cabin) commands.push({ type: 'refit_cabin', aircraftId: ac.id, cabin })
  }
  return commands
}

// The endgame lever: a distressed rival's network for cash — only when the
// price leaves a double treasury buffer standing, and one deal a quarter.
// `rescueOnly` restricts targets to the actually insolvent: giving an AI the
// player's 4x-size clause once snowballed a rival into a runaway monster.
export function takeoverCommands(
  state: GameState,
  idx: number,
  rescueOnly: boolean,
): Command[] {
  const airline = state.airlines[idx]!
  const buffer = cashBufferFor(airline)
  for (const other of state.airlines) {
    if (other.id === idx || other.bankrupt) continue
    if (idx !== 0 && other.controller === 'player') continue // engine rejects it anyway
    // A newly capitalized entrant is not a distressed asset.
    if (other.enteredTurn !== undefined && state.turn - other.enteredTurn < ENTRANT_GRACE_QUARTERS) continue
    const worth = netWorth(other)
    // Small is not the same as failing: the size clause needs actual weakness
    // beside it, or a respawning field becomes a takeover farm for the leader.
    const lastProfit = other.history[other.history.length - 1]?.profit ?? 0
    const distressed = rescueOnly
      ? other.insolventQuarters >= 1
      : other.insolventQuarters >= 1 || (worth * 4 <= netWorth(airline) && lastProfit <= 0)
    if (!distressed || other.routes.length < 2) continue
    const price = Math.max(TAKEOVER_BASE_K, Math.floor((Math.max(0, worth) * TAKEOVER_PREMIUM_BP) / 10000))
    // Rules 6: a deal must buy something. The premium over book value has to
    // be cheaper than queueing for the target's slots, and there must be
    // time left to fly them. Earlier rules bought anything distressed.
    if ((state.rulesVersion ?? 1) >= 6 && !takeoverPaysFor(state, other, price)) continue
    if (airline.cash >= price + buffer * 2) {
      return [{ type: 'acquire_rival', target: other.id }]
    }
  }
  return []
}

// Rules 6 takeover hurdle: the premium over what the company is worth on the
// books must be less than the slot fees it would take to rebuild its airport
// positions, with at least TAKEOVER_MIN_HORIZON quarters left to use them.
export function takeoverPaysFor(state: GameState, target: Airline, price: number): boolean {
  if (getScenario(state.scenario).quarters - state.turn < TAKEOVER_MIN_HORIZON) return false
  let slotValue = 0
  for (const city of Object.keys(target.slots).sort()) {
    if (city === target.hq) continue
    slotValue += Math.floor((target.slots[city] ?? 0) / 2) * slotFee(city)
  }
  // The buyer receives fleet net of debt plus the target's cash (rules 6).
  const received = netWorth(target)
  return price - received <= slotValue
}

// Feeder potential values the other leg's passengers when choosing a new
// destination. A hub operator should seek complementary spokes rather than
// accidentally building a collection of strong, disconnected O/D markets.
export function connectionOpportunity(state: GameState, idx: number, from: string, to: string): number {
  const airline = state.airlines[idx]!
  let potential = 0
  for (const route of airline.routes) {
    for (const [hub, destination] of [[from, to], [to, from]] as const) {
      const origin = route.from === hub ? route.to : route.to === hub ? route.from : null
      if (origin === null || origin === destination) continue
      const total = distanceKm(origin, hub) + distanceKm(hub, destination)
      if (total * 10000 > distanceKm(origin, destination) * CONNECT_DETOUR_MAX_BP) continue
      const demand = pairWeeklyDemand(state, origin, destination)
      const share = Math.floor(demand / (2 + airlinesOnPair(state, origin, destination, idx)))
      potential += Math.min(share, routeWeeklyCapacity(airline, route))
    }
  }
  return potential
}

// Expansion score for an unserved pair: weekly demand net of the seats every
// airline already fields there, scaled by contest appetite. Pure and
// exported for tests.
export function expansionScore(demand: number, fieldedSeats: number, contestDiscountBp: number): number {
  return demand - Math.floor((fieldedSeats * contestDiscountBp) / 10000)
}

// The best unserved pair this airline could open: touches the network, both
// endpoints have free slots, within the fleet's (or order book's) range,
// valued at true first-quarter strength (market memory skips the spool).
export function bestUnservedPair(
  state: GameState,
  idx: number,
  contestDiscountBp: number,
  connectionFocus = false,
): { from: string; to: string; km: number; score: number } | null {
  const airline = state.airlines[idx]!
  let maxRange = 0
  for (const ac of airline.fleet) maxRange = Math.max(maxRange, getAircraftType(ac.type).rangeKm)
  for (const o of airline.orders) maxRange = Math.max(maxRange, getAircraftType(o.type).rangeKm)
  const cities = slotCities(airline)
  const served = new Set(airline.routes.map((r) => pairKey(r.from, r.to)))
  const network = networkCities(airline)
  let best: { from: string; to: string; km: number; score: number } | null = null
  for (let i = 0; i < cities.length; i++) {
    for (let j = i + 1; j < cities.length; j++) {
      const a = cities[i]!
      const b = cities[j]!
      if (served.has(pairKey(a, b))) continue
      if (!network.has(a) && !network.has(b)) continue // routes must touch the network
      if (slotsFree(airline, a) < 1 || slotsFree(airline, b) < 1) continue
      const km = distanceKm(a, b)
      if (km > maxRange || km < AI_MIN_ROUTE_KM) continue
      const mem = airline.servedUntil[pairKey(a, b)]
      const spoolBp =
        mem !== undefined && state.turn - mem <= ROUTE_MEMORY_QUARTERS ? 10000 : ROUTE_SPOOL_BP[0]!
      const score = ((state.rulesVersion ?? 1) >= 2 && connectionFocus ? connectionOpportunity(state, idx, a, b) * 2 : 0) + Math.floor(
        (expansionScore(pairWeeklyDemand(state, a, b), pairWeeklySeats(state, a, b), contestDiscountBp) *
          spoolBp) /
          10000,
      )
      if (score > (best?.score ?? 0)) best = { from: a, to: b, km, score }
    }
  }
  return best
}

// Size a launch schedule to the MARKET, not the airframe: a widebody at full
// frequency floods a thin pair and burns fuel on empty seats. ~70% of weekly
// demand, at least 2 round trips, at most what the airframe can fly.
export function launchFrequency(state: GameState, from: string, to: string, typeId: string, reserveBp = 0): number {
  const km = distanceKm(from, to)
  const maxFreq = roundTripsPerWeek(typeId, km, reserveBp)
  const seats = getAircraftType(typeId).seats
  const demand = pairWeeklyDemand(state, from, to)
  const wanted = Math.ceil((demand * 7) / 10 / Math.max(1, seats * 2))
  return Math.max(2, Math.min(maxFreq, wanted))
}

// Open the best unserved pair an idle airframe can actually fly.
export function launchCommands(
  state: GameState,
  idx: number,
  dials: Pick<PolicyDials, 'fareLevel' | 'serviceLevel' | 'expandMinDemand' | 'contestDiscountBp' | 'connectionFocus'>,
): { commands: Command[]; usedAircraft: number | null } {
  const airline = state.airlines[idx]!
  const pair = bestUnservedPair(state, idx, dials.contestDiscountBp, dials.connectionFocus)
  if (!pair || pair.score <= dials.expandMinDemand) return { commands: [], usedAircraft: null }
  if ((state.rulesVersion ?? 1) >= 5 && !clearsSprawlHurdle(state, airline, pair.score)) return { commands: [], usedAircraft: null }
  const launch = airline.fleet.find(
    (ac) => ac.routeId === null && !(airline.operationsPolicy && ac.reserve) && getAircraftType(ac.type).rangeKm >= pair.km,
  )
  if (!launch) return { commands: [], usedAircraft: null }
  return {
    commands: [
      {
        type: 'open_route',
        from: pair.from,
        to: pair.to,
        aircraftId: launch.id,
        frequency: launchFrequency(state, pair.from, pair.to, launch.type, airline.operationsPolicy?.reserveBp),
        fareLevel: dials.fareLevel,
        serviceLevel: dials.serviceLevel,
      },
    ],
    usedAircraft: launch.id,
  }
}

// Rules 5: one more route costs ROUTE_OVERHEAD_QUAD × (2n+1) of quadratic
// overhead every quarter. Judge the candidate by what this airline actually
// earns per passenger on its existing network; a thin pair that cannot pay
// for its own overhead is not expansion, it is dilution. Airlines with no
// results yet (or a losing network) are not held back — they need markets.
export function clearsSprawlHurdle(state: GameState, airline: Airline, weeklyPax: number): boolean {
  let pax = 0
  let contribution = 0
  for (const r of airline.routes) {
    pax += r.lastPax
    contribution += r.lastRevenue - r.lastCost
  }
  if (pax <= 0 || contribution <= 0) return true
  const n = airline.routes.length
  const marginalK = Math.floor((ROUTE_OVERHEAD_QUAD * (2 * n + 1) * (getScenario(state.scenario).rules.routeOverheadBp ?? 10000)) / 10000 * inflationBp(state.turn) / 10000)
  const expectedK = Math.floor((weeklyPax * WEEKS_PER_QUARTER * contribution) / pax)
  return expectedK * 10000 >= marginalK * SPRAWL_HURDLE_BP
}

// Buy the biggest affordable jet when the network is actually full (or the
// starter fleet is still building out, or renewal just thinned us) — with
// expansion credit when profitable-but-poor, and a post-purchase cushion
// that scales with the cost base.
export function orderCommands(
  state: GameState,
  idx: number,
  opts: { renewedThisQuarter?: boolean; buyLfBp?: number; debtAppetite?: number; cashFloor?: number } = {},
): Command[] {
  const airline = state.airlines[idx]!
  if (airline.orders.length > 0) return []
  if (airline.cash < 0) return [] // never order metal while under water
  let lastPax = 0
  let lastCapacity = 0
  for (const route of airline.routes) {
    lastPax += route.lastPax
    lastCapacity += route.lastCapacity
  }
  const networkFull = lastCapacity > 0 && lastPax * 10000 >= lastCapacity * (opts.buyLfBp ?? 7500)
  const bootstrapping = airline.fleet.length + airline.orders.length < 4
  if (!networkFull && !bootstrapping && !opts.renewedThisQuarter) return []
  const commands: Command[] = []
  const lastProfit = airline.history[airline.history.length - 1]?.profit ?? 0
  const debtAppetite = opts.debtAppetite ?? 10000
  let expectedCash = airline.cash
  if (debtAppetite > 0 && airline.cash < 12000 && lastProfit > 0) {
    const room = debtCeiling(airline) - totalDebt(airline)
    if (room >= 8000) {
      const amount = Math.min(room, debtAppetite)
      commands.push({ type: 'take_loan', amount })
      expectedCash += amount
    }
  }
  const buffer = Math.max(opts.cashFloor ?? 5000, cashBufferFor(airline))
  const affordable = typesOnSale(yearOf(state)).filter((t) => t.price + buffer <= expectedCash)
  if (affordable.length > 0) {
    let pick = affordable[0]!
    for (const t of affordable) if (t.seats > pick.seats) pick = t
    commands.push({ type: 'order_aircraft', aircraftType: pick.id })
  }
  return commands
}

// Which airport to queue at: the city whose best pair with the NETWORK is
// richest (competition-discounted, within a reach that includes what could be
// bought today, since slots outlive fleets) — not the biggest city on the
// map. A fortress builds out its home region first; raiders bias toward
// cities the current leader is entrenched in. Split out from the command so a
// rival can ANNOUNCE a target one quarter and join the list the next
// (rivals.ts): the scoring is the intent, the command is the follow-through.
//
// Capacity-aware: a city whose pool is full AND whose next building programme
// is a long way off is not worth a place in the line, however rich the market
// — that queue is a dead treasury for years.
export function slotTarget(
  state: GameState,
  idx: number,
  dials: Pick<PolicyDials, 'slotBudgetBp' | 'raidBonus' | 'homeRegionUntil' | 'connectionFocus'>,
  // 'fund' (rules 6) asks the opposite question: which FULL airport, too far
  // from its builders to queue at, is worth paying to expand?
  mode: 'queue' | 'fund' = 'queue',
): string | null {
  const airline = state.airlines[idx]!
  if (airline.cash < 4000) return null
  let reach = 0
  for (const ac of airline.fleet) reach = Math.max(reach, getAircraftType(ac.type).rangeKm)
  for (const t of typesOnSale(yearOf(state))) reach = Math.max(reach, t.rangeKm)
  const anchors = [...networkCities(airline)].sort()
  const homeRegion = getCity(airline.hq).region
  const stayHome = slotCities(airline).length < dials.homeRegionUntil
  let leader: Airline | null = null
  for (const other of state.airlines) {
    if (other.id === idx || other.bankrupt) continue
    if (leader === null || netWorth(other) > netWorth(leader)) leader = other
  }
  let target: string | null = null
  let bestScore = 0
  for (const c of CITIES) {
    // A held airport can still be worth expanding: it is where the next
    // route out of a full hub has to start.
    if (mode === 'queue' && (airline.slots[c.id] ?? 0) > 0) continue
    if (stayHome && c.region !== homeRegion) continue
    if (airline.slotRequests.some((r) => r.city === c.id)) continue
    const stuck = slotsRemaining(state, c.id) <= 0 && nextExpansion(state, c.id).quartersAway > SLOT_WAIT_PATIENCE
    // A full pool is only worth queueing for if the builders are close.
    if (mode === 'queue' ? stuck : !stuck || terminalBlocker(state, idx, c.id) !== null) continue
    let cityScore = 0
    for (const h of anchors) {
      // A takeover can put a route endpoint in the network with no slots
      // held there — the city is then both candidate and anchor.
      if (h === c.id) continue
      const km = distanceKm(c.id, h)
      if (km < AI_MIN_ROUTE_KM || km > reach) continue
      cityScore = Math.max(cityScore, pairScore(state, c.id, h, idx) + ((state.rulesVersion ?? 1) >= 2 && dials.connectionFocus ? connectionOpportunity(state, idx, c.id, h) * 2 : 0))
    }
    // Raid appetite: an entrenched leader makes the city up to +30% more
    // attractive (raidBonus 0..12 → +0..30% in pair-score units).
    if (leader !== null && (leader.slots[c.id] ?? 0) >= 2) {
      cityScore = Math.floor((cityScore * (10000 + dials.raidBonus * 250)) / 10000)
    }
    if (cityScore > bestScore) {
      bestScore = cityScore
      target = c.id
    }
  }
  return target
}

// Joining the list. `target` defaults to a fresh pick (the reference bot and
// the fuzzer choose in the moment, like a player); rivals pass the city they
// announced last quarter, and a stale announcement — slots since granted,
// treasury since spent — simply lapses.
//
// One place in one line at a time. The fee is real money committed a quarter
// or more ahead of any revenue, so an operator that queues everywhere at once
// starves the fleet that was supposed to use the slots.
export function slotRequestCommands(
  state: GameState,
  idx: number,
  dials: Pick<PolicyDials, 'slotBudgetBp' | 'raidBonus' | 'homeRegionUntil' | 'connectionFocus'>,
  target: string | null = slotTarget(state, idx, dials),
): Command[] {
  const airline = state.airlines[idx]!
  if (airline.slotRequests.length > 0) return []
  if (target === null) return []
  if ((airline.slots[target] ?? 0) > 0) return []
  const fee = slotFee(target)
  // Never spend the last of the treasury on a position that cannot fly for a
  // quarter: keep a working buffer, scaled by the operator's appetite.
  const buffer = Math.floor((cashBufferFor(airline) * dials.slotBudgetBp) / 10000)
  if (airline.cash - fee < buffer) return []
  return [{ type: 'request_slots', city: target }]
}

// Rules 6: a rich operator locked out of the market it wants pays to build
// the capacity. Only with a deep treasury (the programme plus a quadruple
// buffer), with years of career left to earn it back, one city a quarter.
export function terminalCommands(
  state: GameState,
  idx: number,
  dials: Pick<PolicyDials, 'slotBudgetBp' | 'raidBonus' | 'homeRegionUntil' | 'connectionFocus'>,
): Command[] {
  if ((state.rulesVersion ?? 1) < 6) return []
  const airline = state.airlines[idx]!
  if (getScenario(state.scenario).quarters - state.turn < TERMINAL_MIN_HORIZON) return []
  if (airline.cash < cashBufferFor(airline) * 4) return []
  const city = slotTarget(state, idx, dials, 'fund')
  if (city === null || airline.cash < terminalCost(state, city) + cashBufferFor(airline) * 4) return []
  return [{ type: 'fund_terminal', city }]
}

// Rent discipline: hand back capacity that is not carrying anything. Slots
// bill every quarter, so a position at a city no route touches is a standing
// charge for nothing — and holding it also denies the pool to everyone else.
// A city the network actually uses keeps its spare slots: that is headroom
// for the next airframe, not waste.
export function slotReleaseCommands(state: GameState, idx: number): Command[] {
  const airline = state.airlines[idx]!
  const commands: Command[] = []
  const touched = new Set<string>()
  for (const r of airline.routes) {
    touched.add(r.from)
    touched.add(r.to)
  }
  // Metal on the way means the positions have a purpose: an idle airframe or
  // an outstanding order is a route about to open. Shedding capacity in that
  // window would just buy it back next quarter, fee and all.
  if (airline.fleet.some((a) => a.routeId === null && !(airline.operationsPolicy && a.reserve)) || airline.orders.length > 0) return []
  // Rules 5: a foothold with a real market behind it is the next route, not
  // waste. Under the old rule every rival handed back its starting footholds
  // in quarter one (both starter jets on the first pair, nothing idle, no
  // order yet) and then spent years queueing to get them back.
  const modernRace = (state.rulesVersion ?? 1) >= 5
  let reach = 0
  if (modernRace) {
    for (const ac of airline.fleet) reach = Math.max(reach, getAircraftType(ac.type).rangeKm)
    for (const t of typesOnSale(yearOf(state))) reach = Math.max(reach, t.rangeKm)
  }
  const anchors = modernRace ? [...networkCities(airline)].sort() : []
  for (const city of slotCities(airline)) {
    if (city === airline.hq || touched.has(city)) continue
    if (city === airline.slotInterest) continue // the declared plan
    const free = slotsFree(airline, city)
    if (free <= 0) continue
    if (modernRace && anchors.some((h) => h !== city && distanceKm(h, city) >= AI_MIN_ROUTE_KM && distanceKm(h, city) <= reach && pairScore(state, city, h, idx) >= RELEASE_KEEP_PAIR_SCORE)) continue
    commands.push({ type: 'release_slots', city, count: free })
  }
  return commands
}

// Demand discounted by incumbent competition: a monopoly pair is worth far
// more than a contested one of equal size. `selfIdx` excludes the acting
// airline from the incumbent count.
export function pairScore(state: GameState, a: string, b: string, selfIdx = 0): number {
  const demand = pairWeeklyDemand(state, a, b)
  return Math.floor((demand * 100) / (100 + 150 * airlinesOnPair(state, a, b, selfIdx)))
}

// Assign every idle airframe to the route most starved for seats, then set
// the schedule to ~80% of demand (never the fleet maximum — that used to
// flood thin pairs the moment a second plane arrived). Commands are computed
// against the pre-apply snapshot, so pending capacity is tracked explicitly.
// `skip` excludes aircraft consumed by an open_route earlier in the batch.
export function assignmentCommands(state: GameState, idx: number, skip?: ReadonlySet<number>): Command[] {
  const airline = state.airlines[idx]!
  const commands: Command[] = []
  const pendingCapacity = new Map<number, number>()
  const pendingTrips = new Map<number, number>()
  for (const ac of airline.fleet) {
    if (ac.routeId !== null || skip?.has(ac.id) || (airline.operationsPolicy && ac.reserve)) continue
    const type = getAircraftType(ac.type)
    let bestRoute: (typeof airline.routes)[number] | null = null
    let bestGap = 0
    for (const route of airline.routes) {
      const km = distanceKm(route.from, route.to)
      if (km > type.rangeKm) continue
      const gap =
        pairWeeklyDemand(state, route.from, route.to) -
        routeWeeklyCapacity(airline, route) -
        (pendingCapacity.get(route.id) ?? 0)
      if (gap > bestGap) {
        bestGap = gap
        bestRoute = route
      }
    }
    if (bestRoute !== null) {
      const km = distanceKm(bestRoute.from, bestRoute.to)
      const trips = roundTripsPerWeek(ac.type, km, airline.operationsPolicy?.reserveBp)
      commands.push({ type: 'assign_aircraft', aircraftId: ac.id, routeId: bestRoute.id })
      const newMax = maxRouteFrequency(airline, bestRoute) + (pendingTrips.get(bestRoute.id) ?? 0) + trips
      const demand = pairWeeklyDemand(state, bestRoute.from, bestRoute.to)
      const target = Math.ceil((demand * 8) / 10 / Math.max(1, type.seats * 2))
      commands.push({
        type: 'set_frequency',
        routeId: bestRoute.id,
        frequency: Math.max(2, Math.min(newMax, Math.max(target, bestRoute.frequency))),
      })
      pendingCapacity.set(bestRoute.id, (pendingCapacity.get(bestRoute.id) ?? 0) + type.seats * 20)
      pendingTrips.set(bestRoute.id, (pendingTrips.get(bestRoute.id) ?? 0) + trips)
    }
  }
  return commands
}
