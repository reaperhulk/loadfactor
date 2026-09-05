// Read-only recurring costs. Forecasts and resolution share every rounding step.
import { aircraftFamily, getAircraftType } from '../data/aircraft'
import {
  AIRCRAFT_ADMIN_PER_QUARTER,
  AIRLINE_OVERHEAD_PER_QUARTER,
  CREW_SALARY_BP_PER_QUARTER,
  LEASE_BP_PER_QUARTER,
  MARKETING_BASE_PER_LEVEL,
  MARKETING_PER_ROUTE_PER_LEVEL,
  MAINT_AGE_BP_PER_QUARTER,
  OWNERSHIP_BP_PER_QUARTER,
  ROUTE_OVERHEAD_QUAD,
  LOAN_AMORT_BP,
  DOMINANCE_PARITY_MULT_BP,
  DOMINANCE_SCRUTINY_BP,
  DOMINANCE_SCRUTINY_MAX_BP,
} from '../data/constants'
import { getScenario } from '../data/scenarios'
import { inflationBp } from './market'
import { routeWeeklyCapacity } from './queries'
import { slotRentTotal } from './slots'
import { dealUpkeep } from './offers'
import type { Airline, GameState } from './types'

function fieldedSeats(airline: Airline): number {
  return airline.routes.reduce((sum, route) => sum + routeWeeklyCapacity(airline, route), 0)
}

export function recurringFinancials(state: GameState, airline: Airline, t: {
  revenue: number; cost: number; fuel: number; fees: number; flightPay: number; service: number
}) {
  // Overhead, maintenance, admin, and salaries inflate with the era
  // (market.ts inflates the per-route operating costs); ownership and
  // lease payments track list price. Sprawl carries a quadratic overhead.
  const inflate = (v: number) => Math.floor((v * inflationBp(state.turn)) / 10000)
  let maintenance = 0
  let admin = 0
  let salaries = 0
  let ownership = 0
  for (const ac of airline.fleet) {
    const type = getAircraftType(ac.type)
    maintenance += inflate(
      Math.floor((type.maintBase * (10000 + MAINT_AGE_BP_PER_QUARTER * ac.ageQuarters)) / 10000),
    )
    admin += inflate(AIRCRAFT_ADMIN_PER_QUARTER)
    // Crews are salaried per airframe whether it flies or not — parking
    // the schedule saves fuel and fees, never the payroll.
    salaries += inflate(Math.floor((type.price * CREW_SALARY_BP_PER_QUARTER) / 10000))
    // Owned airframes carry ownership (depreciation+insurance); leased ones
    // pay the lessor instead.
    ownership += ac.leased
      ? Math.floor((type.price * LEASE_BP_PER_QUARTER) / 10000)
      : Math.floor((type.price * OWNERSHIP_BP_PER_QUARTER) / 10000)
  }
  if ((state.rulesVersion ?? 1) >= 2) {
    const families = new Set(airline.fleet.map((ac) => aircraftFamily(ac.type))).size
    // A single family earns a spares/training saving; extra families add
    // complexity to maintenance and administration, capped at +20%.
    const commonalityBp = families <= 1 ? 9200 : Math.min(12000, 10000 + (families - 2) * 500)
    maintenance = Math.floor(maintenance * commonalityBp / 10000)
    admin = Math.floor(admin * commonalityBp / 10000)
  }
  const routeOverhead = Math.floor(
    (ROUTE_OVERHEAD_QUAD *
      airline.routes.length *
      airline.routes.length *
      (getScenario(state.scenario).rules.routeOverheadBp ?? 10000)) /
      10000,
  )
  let overhead = inflate(AIRLINE_OVERHEAD_PER_QUARTER + routeOverhead)
  // Regulatory scrutiny: past a share of industry seats, dominance costs
  // real money (compliance, political friction, punitive fees, fare caps).
  // Charged against REVENUE so it scales with the airline it restrains —
  // an overhead-based charge is rounding error to a monopolist. Folded into
  // the overhead bucket so the breakdown still sums exactly to costs.
  const mySeats = fieldedSeats(airline)
  if (mySeats > 0) {
    let industrySeats = 0
    let liveAirlines = 0
    for (const a of state.airlines) {
      industrySeats += fieldedSeats(a)
      if (!a.bankrupt) liveAirlines++
    }
    const shareBp = industrySeats > 0 ? Math.floor((mySeats * 10000) / industrySeats) : 0
    const parityBp = Math.floor(10000 / Math.max(1, liveAirlines))
    const thresholdBp = Math.floor((parityBp * DOMINANCE_PARITY_MULT_BP) / 10000)
    if (shareBp > thresholdBp) {
      const excessBp = shareBp - thresholdBp
      const chargeBp = Math.min(
        DOMINANCE_SCRUTINY_MAX_BP,
        Math.floor((excessBp * DOMINANCE_SCRUTINY_BP) / 10000),
      )
      overhead += Math.floor((t.revenue * chargeBp) / 10000)
    }
  }
  // Public-service obligations and other accepted deals bill every quarter
  // until they run out — the price of the gates you took early.
  overhead += dealUpkeep(airline)
  if ((state.rulesVersion ?? 1) >= 2 && airline.hubMode === 'banked') overhead += inflate(200 * airline.routes.length)
  // Brand spend: priced per level against network size (see constants).
  const marketing =
    airline.marketing *
    inflate(MARKETING_BASE_PER_LEVEL + MARKETING_PER_ROUTE_PER_LEVEL * airline.routes.length)
  let interest = 0
  for (const loan of airline.loans) {
    interest += Math.floor((loan.principal * loan.annualRateBp) / 4 / 10000)
  }
  // Principal amortizes AFTER interest accrues on the carried balance: a
  // share of the remaining principal comes due each quarter, with a floor
  // so stubs extinguish. Not a cost — a balance-sheet transfer — but it
  // drains the treasury, so leverage must be productive, not parked.
  let debtPayment = 0
  for (const loan of airline.loans) {
    const due = Math.min(loan.principal, Math.max(100, Math.floor((loan.principal * LOAN_AMORT_BP) / 10000)))
    debtPayment += due
  }
  // Airport rent: every slot held bills every quarter, whether an aircraft
  // uses it or not. Capacity is leased from the authority, and a position
  // you are not flying is a position you are paying to deny to someone else.
  const slotRent = slotRentTotal(airline)
  const breakdown = {
    fuel: t.fuel,
    fees: t.fees,
    flightPay: t.flightPay,
    service: t.service,
    salaries,
    ownership,
    maintenance,
    admin,
    slots: slotRent,
    overhead,
    marketing,
    interest,
  }
  const revenue = t.revenue
  const costs =
    t.cost + salaries + ownership + maintenance + admin + slotRent + overhead + marketing + interest
  const profit = revenue - costs
  return { revenue, costs, profit, debtPayment, breakdown }
}
