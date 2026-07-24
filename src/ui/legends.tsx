// In-context legends for the game's systems — the deepest levers (hubs,
// spool-up, seasonality, marketing, hedging, slots, takeovers) each get an
// explainer next to the place they are used, plus the original pair for the
// easily-confused cabin/service tiers. Every number is read from the live
// tuning constants — a legend can never drift from the engine.

import {
  CABIN_REFIT_COST_BP,
  CABIN_SEATS_BP,
  CABIN_WEIGHT,
  CABIN_YIELD_BP,
  CONNECT_DETOUR_MAX_BP,
  CONNECT_FARE_DISCOUNT_BP,
  CONNECT_WILLING_BP,
  HEDGE_MAX_QUARTERS,
  HEDGE_MIN_QUARTERS,
  HEDGE_PREMIUM_PER_AIRCRAFT,
  INSOLVENCY_QUARTERS_TO_FAIL,
  LOAN_AMORT_BP,
  MARKETING_BASE_PER_LEVEL,
  MARKETING_PER_ROUTE_PER_LEVEL,
  MARKETING_WEIGHT_BP_PER_LEVEL,
  NEG_OUTBID_MALUS_BP,
  ROUTE_MEMORY_QUARTERS,
  ROUTE_SPOOL_BP,
  SEASON_TOUR_BP_PER_POINT,
  SERVICE_COST_PER_PAX,
  SERVICE_LEVEL_WEIGHT,
  SLOT_IDLE_QUARTERS_TO_LOSE,
  SLOT_IDLE_THRESHOLD,
  TAKEOVER_PREMIUM_BP,
  TRANSFER_HANDLING_PER_PAX,
} from '../data/constants'

const pctFrom = (bp: number): string => {
  const delta = (bp - 10000) / 100
  return `${delta >= 0 ? '+' : ''}${delta.toFixed(0)}%`
}

const CABIN_NAMES = ['Dense', 'Standard', 'Premium']
const SERVICE_NAMES = ['Basic', 'Standard', 'Premium']

export function CabinLegend() {
  return (
    <details className="game-legend" data-testid="cabin-legend">
      <summary className="dim">What do cabin fits do?</summary>
      <p className="dim">
        The cabin is the airplane's hardware: how many seats are bolted in and what each one sells for.
        Set per airframe; a refit costs {(CABIN_REFIT_COST_BP / 100).toFixed(1)}% of list price. (Service,
        set per route, is the soft product on top.)
      </p>
      <table>
        <thead>
          <tr className="dim">
            <th>fit</th>
            <th title="seat count vs the standard layout">seats</th>
            <th title="revenue per passenger vs standard">fare/pax</th>
            <th title="how strongly this cabin attracts riders in a contested split (standard = 100)">appeal</th>
          </tr>
        </thead>
        <tbody>
          {CABIN_NAMES.map((name, i) => (
            <tr key={name}>
              <td>{name}</td>
              <td>{pctFrom(CABIN_SEATS_BP[i]!)}</td>
              <td>{pctFrom(CABIN_YIELD_BP[i]!)}</td>
              <td>{CABIN_WEIGHT[i]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint">
        Dense packs commuters onto short trunks; premium sells space on long, rich routes. There is no
        best fit — match the airplane to its market.
      </p>
    </details>
  )
}

export function ServiceLegend() {
  return (
    <details className="game-legend" data-testid="service-legend">
      <summary className="dim">What do service tiers do?</summary>
      <p className="dim">
        Service is the soft product — meals, staffing, lounges — set per route. It costs per passenger
        carried and sways riders when a pair is contested. (Cabin fits, set per airplane, are the
        hardware underneath.)
      </p>
      <table>
        <thead>
          <tr className="dim">
            <th>tier</th>
            <th title="cost per passenger carried">cost/pax</th>
            <th title="how strongly this tier attracts riders in a contested split (basic = 100)">appeal</th>
          </tr>
        </thead>
        <tbody>
          {SERVICE_NAMES.map((name, i) => (
            <tr key={name}>
              <td>{name}</td>
              <td>${SERVICE_COST_PER_PAX[i]}</td>
              <td>{SERVICE_LEVEL_WEIGHT[i]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint">
        Premium service only pays where riders exist to win — monopoly routes gain appeal nobody
        contests, but the per-passenger cost is real either way.
      </p>
    </details>
  )
}

export function HubLegend() {
  return (
    <details className="game-legend" data-testid="hub-legend">
      <summary className="dim">How do hubs and connecting traffic work?</summary>
      <p className="dim">
        When two cities you serve have no direct route between them, up to{' '}
        {(CONNECT_WILLING_BP / 100).toFixed(0)}% of that pair's demand will take a one-stop over your
        network — if both legs exist, the detour stays under {(CONNECT_DETOUR_MAX_BP / 100 - 100).toFixed(0)}%
        of the direct distance, and spare seats remain (connecting riders board strictly after direct
        ones). They pay {(CONNECT_FARE_DISCOUNT_BP / 100).toFixed(0)}% of each leg's fare, and you pay
        ${TRANSFER_HANDLING_PER_PAX}/passenger per leg in transfer handling.
      </p>
      <p className="hint">
        The glowing rings on the map are your hubs — cities where connecting passengers change planes.
        A dense star of routes from one city quietly fills seats network-wide.
      </p>
    </details>
  )
}

export function SpoolLegend() {
  return (
    <details className="game-legend" data-testid="spool-legend">
      <summary className="dim">Why do new routes ramp up?</summary>
      <p className="dim">
        A new route attaches only part of its market share while riders discover it:{' '}
        {ROUTE_SPOOL_BP.map((bp) => `${bp / 100}%`).join(' → ')} over its first{' '}
        {ROUTE_SPOOL_BP.length} quarters, then 100%. The market remembers: re-open a pair you served
        within the last {ROUTE_MEMORY_QUARTERS} quarters and it flies at full strength immediately.
      </p>
      <p className="hint">
        Budget for a soft first year on genuinely new markets — and don't judge a spooling route by
        its first quarter's numbers.
      </p>
    </details>
  )
}

export function SeasonLegend() {
  return (
    <details className="game-legend" data-testid="season-legend">
      <summary className="dim">How does seasonality work?</summary>
      <p className="dim">
        Tourist demand follows the sun: each city's demand swings by {SEASON_TOUR_BP_PER_POINT / 100}%
        per point of its tourism rating — peaking in its summer quarter (Q3 north of the equator, Q1
        south) and dipping the same amount in its winter.
      </p>
      <p className="hint">
        The 🌞/❄ icons and the season map lens show which way the calendar is leaning. Beach pairs
        whipsaw; business trunks barely notice.
      </p>
    </details>
  )
}

export function MarketingLegend() {
  return (
    <details className="game-legend" data-testid="marketing-legend">
      <summary className="dim">What does marketing do?</summary>
      <p className="dim">
        Brand spend adds +{MARKETING_WEIGHT_BP_PER_LEVEL / 100}% appeal per level to EVERY route you
        fly when a pair's demand is split between airlines. It costs ${MARKETING_BASE_PER_LEVEL}k per
        level per quarter, plus ${MARKETING_PER_ROUTE_PER_LEVEL}k per route — the bill scales with
        your network.
      </p>
      <p className="hint">
        Worth most when many of your pairs are contested; pure overhead in a monopoly. Cut it first
        when cash runs thin.
      </p>
    </details>
  )
}

export function HedgeLegend() {
  return (
    <details className="game-legend" data-testid="hedge-legend">
      <summary className="dim">How does fuel hedging work?</summary>
      <p className="dim">
        A hedge locks today's fuel price for {HEDGE_MIN_QUARTERS}–{HEDGE_MAX_QUARTERS} quarters at a
        premium of ${HEDGE_PREMIUM_PER_AIRCRAFT}k per airframe. While it runs, oil shocks cannot touch
        your fuel bill — and cheap fuel cannot reach it either.
      </p>
      <p className="hint">
        Hedge when the index is low and the era is shock-prone (the Oil Crisis, the Low-Cost Wars).
        The premium is the insurance you pay either way.
      </p>
    </details>
  )
}

export function SlotLegend() {
  return (
    <details className="game-legend" data-testid="slot-legend">
      <summary className="dim">How do slots and bidding wars work?</summary>
      <p className="dim">
        Routes need a slot at both endpoints, won by negotiation — spend more against a city's
        difficulty for better odds. When several airlines court the same city in the same quarter it
        becomes an auction: the top spender bids at full strength, everyone below keeps only{' '}
        {(10000 - NEG_OUTBID_MALUS_BP) / 100}% of their odds. Use them or lose them: holding more than{' '}
        {SLOT_IDLE_THRESHOLD} idle slots at a city for {SLOT_IDLE_QUARTERS_TO_LOSE} straight quarters
        forfeits one.
      </p>
      <p className="hint">Failed talks burn the spend — bid credibly or wait a quarter.</p>
    </details>
  )
}

export function TakeoverLegend() {
  return (
    <details className="game-legend" data-testid="takeover-legend">
      <summary className="dim">How do takeovers work?</summary>
      <p className="dim">
        A rival becomes buyable when it is DISTRESSED: insolvent last quarter, or worth a quarter of
        your airline or less. The price is {TAKEOVER_PREMIUM_BP / 100}% of its net worth, and the deal
        transfers everything — fleet, routes, slots, orders, and their debt. Rivals hunt each other
        the same way (an airline {INSOLVENCY_QUARTERS_TO_FAIL} quarters insolvent liquidates instead),
        but nobody can buy you.
      </p>
      <p className="hint">
        Loans amortize at {LOAN_AMORT_BP / 100}% of principal a quarter, so an acquired debt pile
        keeps draining cash long after the deal closes — price that in.
      </p>
    </details>
  )
}
