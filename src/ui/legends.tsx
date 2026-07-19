// In-context legends for the game's two easily-confused three-tier systems:
// cabin fits (hardware, per airframe) and service tiers (soft product, per
// route). Every number is read from the live tuning constants — the legend
// can never drift from the engine.

import {
  CABIN_REFIT_COST_BP,
  CABIN_SEATS_BP,
  CABIN_WEIGHT,
  CABIN_YIELD_BP,
  SERVICE_COST_PER_PAX,
  SERVICE_LEVEL_WEIGHT,
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
