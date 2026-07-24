// Planning-phase command validation and application, used identically by the
// player (via applyCommand) and rival policies (via turn.ts). Invalid commands
// reject with a command_rejected event — engine entry points never throw on
// user input.

import { getAircraftType, isAircraftType } from '../data/aircraft'
import { distanceKm, getCity, isCity, pairKey } from '../data/cities'
import {
  CABIN_REFIT_COST_BP,
  ORDER_CANCEL_REFUND_BP,
  HEDGE_MAX_QUARTERS,
  HEDGE_MIN_QUARTERS,
  HEDGE_PREMIUM_PER_AIRCRAFT,
  LEASE_BP_PER_QUARTER,
  MARKETING_MAX_LEVEL,
  MIN_ROUTE_KM,
  TAKEOVER_BASE_K,
  TAKEOVER_PREMIUM_BP,
  NEG_MIN_SPEND,
} from '../data/constants'
import { effFuelBp } from './worldEvents'
import {
  currentLoanRateBp,
  debtCeiling,
  netWorth,
  findRoute,
  maxRouteFrequency,
  networkCities,
  resaleValue,
  roundTripsPerWeek,
  slotsAllocated,
  slotsFree,
  totalDebt,
  yearOf,
} from './queries'
import type { Airline, Command, GameEvent, GameState } from './types'

interface Applied {
  events: GameEvent[]
}

function reject(airlineIdx: number, command: Command, reason: string): Applied {
  return { events: [{ type: 'command_rejected', airline: airlineIdx, command, reason }] }
}

// Mutates `state` in place (callers clone at the entry point).
export function applyPlanningCommand(state: GameState, airlineIdx: number, command: Command): Applied {
  const airline = state.airlines[airlineIdx]
  if (!airline) return reject(airlineIdx, command, 'no such airline')
  if (state.phase !== 'planning') return reject(airlineIdx, command, 'game is over')
  if (airline.bankrupt) return reject(airlineIdx, command, 'airline is bankrupt')

  switch (command.type) {
    case 'open_route': {
      const { from, to } = command
      if (!isCity(from) || !isCity(to) || from === to) return reject(airlineIdx, command, 'invalid city pair')
      const [a, b] = from < to ? [from, to] : [to, from]
      if (airline.routes.some((r) => r.from === a && r.to === b))
        return reject(airlineIdx, command, 'route already open')
      const km = distanceKm(a, b)
      if (km < MIN_ROUTE_KM) return reject(airlineIdx, command, 'route too short')
      // Airlines build networks: a new route must touch the HQ or a city
      // already served, never float disconnected.
      const network = networkCities(airline)
      if (!network.has(a) && !network.has(b))
        return reject(airlineIdx, command, 'route must connect to your network (touch your HQ or a served city)')
      if (slotsFree(airline, a) < 1) return reject(airlineIdx, command, `no free slots at ${a}`)
      if (slotsFree(airline, b) < 1) return reject(airlineIdx, command, `no free slots at ${b}`)
      // A route launches with a real schedule: one idle aircraft and a weekly
      // frequency that aircraft can actually fly at this distance.
      const aircraft = airline.fleet.find((ac) => ac.id === command.aircraftId)
      if (!aircraft) return reject(airlineIdx, command, 'no such aircraft')
      if (aircraft.routeId !== null) return reject(airlineIdx, command, 'aircraft is already assigned')
      if (getAircraftType(aircraft.type).rangeKm < km)
        return reject(airlineIdx, command, 'aircraft lacks the range for this route')
      const maxFreq = roundTripsPerWeek(aircraft.type, km)
      if (!Number.isInteger(command.frequency) || command.frequency < 1 || command.frequency > maxFreq)
        return reject(airlineIdx, command, `frequency must be 1..${maxFreq} for this aircraft`)
      const fareLevel = command.fareLevel ?? 0
      const serviceLevel = command.serviceLevel ?? 2
      if (!Number.isInteger(fareLevel) || fareLevel < -2 || fareLevel > 2)
        return reject(airlineIdx, command, 'fare level must be -2..2')
      if (!Number.isInteger(serviceLevel) || serviceLevel < 1 || serviceLevel > 3)
        return reject(airlineIdx, command, 'service level must be 1..3')
      const route = {
        id: airline.nextId++,
        from: a,
        to: b,
        fareLevel,
        serviceLevel,
        frequency: command.frequency,
        lastPax: 0,
        lastCapacity: 0,
        lastLoadFactorBp: 0,
        lastRevenue: 0,
        lastCost: 0,
        lastTransferPax: 0,
        history: [],
      }
      airline.routes.push(route)
      aircraft.routeId = route.id
      return {
        events: [
          { type: 'route_opened', airline: airlineIdx, routeId: route.id, from: a, to: b },
          { type: 'aircraft_assigned', airline: airlineIdx, aircraftId: aircraft.id, routeId: route.id },
        ],
      }
    }

    case 'set_frequency': {
      const route = findRoute(airline, command.routeId)
      if (!route) return reject(airlineIdx, command, 'no such route')
      const max = maxRouteFrequency(airline, route)
      if (!Number.isInteger(command.frequency) || command.frequency < 1 || command.frequency > max)
        return reject(airlineIdx, command, `frequency must be 1..${max} with the assigned fleet`)
      route.frequency = command.frequency
      return {
        events: [{ type: 'frequency_set', airline: airlineIdx, routeId: route.id, frequency: route.frequency }],
      }
    }

    case 'close_route': {
      const route = findRoute(airline, command.routeId)
      if (!route) return reject(airlineIdx, command, 'no such route')
      for (const ac of airline.fleet) if (ac.routeId === route.id) ac.routeId = null
      airline.routes = airline.routes.filter((r) => r.id !== route.id)
      // Market memory: a flown pair stays known for a while — re-entry
      // within the window skips the spool-up.
      if (route.history.length > 0) {
        airline.servedUntil[pairKey(route.from, route.to)] = state.turn
      }
      return { events: [{ type: 'route_closed', airline: airlineIdx, routeId: route.id }] }
    }

    case 'set_fare': {
      const route = findRoute(airline, command.routeId)
      if (!route) return reject(airlineIdx, command, 'no such route')
      if (!Number.isInteger(command.fareLevel) || command.fareLevel < -2 || command.fareLevel > 2)
        return reject(airlineIdx, command, 'fare level must be -2..2')
      route.fareLevel = command.fareLevel
      return { events: [{ type: 'fare_set', airline: airlineIdx, routeId: route.id, fareLevel: route.fareLevel }] }
    }

    case 'set_service': {
      const route = findRoute(airline, command.routeId)
      if (!route) return reject(airlineIdx, command, 'no such route')
      if (!Number.isInteger(command.serviceLevel) || command.serviceLevel < 1 || command.serviceLevel > 3)
        return reject(airlineIdx, command, 'service level must be 1..3')
      route.serviceLevel = command.serviceLevel
      return {
        events: [{ type: 'service_set', airline: airlineIdx, routeId: route.id, serviceLevel: route.serviceLevel }],
      }
    }

    case 'set_marketing': {
      if (!Number.isInteger(command.level) || command.level < 0 || command.level > MARKETING_MAX_LEVEL)
        return reject(airlineIdx, command, `marketing level must be 0..${MARKETING_MAX_LEVEL}`)
      airline.marketing = command.level
      return { events: [{ type: 'marketing_set', airline: airlineIdx, level: command.level }] }
    }

    case 'assign_aircraft': {
      const aircraft = airline.fleet.find((a) => a.id === command.aircraftId)
      if (!aircraft) return reject(airlineIdx, command, 'no such aircraft')
      if (command.routeId === null) {
        aircraft.routeId = null
        return { events: [{ type: 'aircraft_assigned', airline: airlineIdx, aircraftId: aircraft.id, routeId: null }] }
      }
      const route = findRoute(airline, command.routeId)
      if (!route) return reject(airlineIdx, command, 'no such route')
      const km = distanceKm(route.from, route.to)
      if (getAircraftType(aircraft.type).rangeKm < km)
        return reject(airlineIdx, command, 'aircraft lacks the range for this route')
      aircraft.routeId = route.id
      return {
        events: [{ type: 'aircraft_assigned', airline: airlineIdx, aircraftId: aircraft.id, routeId: route.id }],
      }
    }

    case 'order_aircraft': {
      if (!isAircraftType(command.aircraftType)) return reject(airlineIdx, command, 'unknown aircraft type')
      const type = getAircraftType(command.aircraftType)
      const year = yearOf(state)
      if (year < type.availableFrom || year > type.availableTo)
        return reject(airlineIdx, command, `${type.name} is not on sale in ${year}`)
      if (airline.cash < type.price) return reject(airlineIdx, command, 'insufficient cash')
      airline.cash -= type.price
      const order = { id: airline.nextId++, type: type.id, quartersLeft: type.deliveryQuarters, leased: false }
      airline.orders.push(order)
      return {
        events: [
          { type: 'aircraft_ordered', airline: airlineIdx, orderId: order.id, aircraftType: type.id, price: type.price },
        ],
      }
    }

    case 'cancel_order': {
      const order = airline.orders.find((o) => o.id === command.orderId)
      if (!order) return reject(airlineIdx, command, 'no such order')
      // Purchases refund most of the price (the maker keeps a deposit);
      // leases cancel free — nothing was paid up front.
      const refund = order.leased
        ? 0
        : Math.floor((getAircraftType(order.type).price * ORDER_CANCEL_REFUND_BP) / 10000)
      airline.orders = airline.orders.filter((o) => o.id !== order.id)
      airline.cash += refund
      return {
        events: [{ type: 'order_cancelled', airline: airlineIdx, orderId: order.id, refund }],
      }
    }

    case 'lease_aircraft': {
      if (!isAircraftType(command.aircraftType)) return reject(airlineIdx, command, 'unknown aircraft type')
      const type = getAircraftType(command.aircraftType)
      const year = yearOf(state)
      if (year < type.availableFrom || year > type.availableTo)
        return reject(airlineIdx, command, `${type.name} is not on sale in ${year}`)
      const payment = Math.floor((type.price * LEASE_BP_PER_QUARTER) / 10000)
      if (airline.cash < payment) return reject(airlineIdx, command, 'insufficient cash for the first payment')
      // Leases deliver fast — the lessor has airframes on the ramp.
      const order = { id: airline.nextId++, type: type.id, quartersLeft: 1, leased: true }
      airline.orders.push(order)
      return {
        events: [
          {
            type: 'aircraft_leased',
            airline: airlineIdx,
            orderId: order.id,
            aircraftType: type.id,
            paymentPerQuarter: payment,
          },
        ],
      }
    }

    case 'buy_used': {
      const offer = state.world.usedMarket.find((o) => o.id === command.offerId)
      if (!offer) return reject(airlineIdx, command, 'that airframe is gone')
      if (airline.cash < offer.price) return reject(airlineIdx, command, 'insufficient cash')
      airline.cash -= offer.price
      state.world.usedMarket = state.world.usedMarket.filter((o) => o.id !== offer.id)
      const aircraft = {
        id: airline.nextId++,
        type: offer.type,
        ageQuarters: offer.ageQuarters,
        routeId: null,
        leased: false,
        cabin: 2,
      }
      airline.fleet.push(aircraft)
      return {
        events: [
          {
            type: 'used_bought',
            airline: airlineIdx,
            aircraftId: aircraft.id,
            aircraftType: aircraft.type,
            price: offer.price,
            ageQuarters: offer.ageQuarters,
          },
        ],
      }
    }

    case 'hedge_fuel': {
      if (
        !Number.isInteger(command.quarters) ||
        command.quarters < HEDGE_MIN_QUARTERS ||
        command.quarters > HEDGE_MAX_QUARTERS
      )
        return reject(airlineIdx, command, `hedge must run ${HEDGE_MIN_QUARTERS}..${HEDGE_MAX_QUARTERS} quarters`)
      if (airline.fuelHedge !== null) return reject(airlineIdx, command, 'a hedge is already running')
      if (airline.fleet.length === 0) return reject(airlineIdx, command, 'no fleet to hedge')
      const premium = HEDGE_PREMIUM_PER_AIRCRAFT * airline.fleet.length * command.quarters
      if (airline.cash < premium) return reject(airlineIdx, command, 'insufficient cash')
      airline.cash -= premium
      const bp = effFuelBp(state.world)
      airline.fuelHedge = { bp, quartersLeft: command.quarters }
      return {
        events: [{ type: 'fuel_hedged', airline: airlineIdx, bp, quarters: command.quarters, premium }],
      }
    }

    case 'refit_cabin': {
      const aircraft = airline.fleet.find((a) => a.id === command.aircraftId)
      if (!aircraft) return reject(airlineIdx, command, 'no such aircraft')
      if (!Number.isInteger(command.cabin) || command.cabin < 1 || command.cabin > 3)
        return reject(airlineIdx, command, 'cabin must be 1..3')
      if (aircraft.cabin === command.cabin) return reject(airlineIdx, command, 'already in that cabin fit')
      const cost = Math.floor((getAircraftType(aircraft.type).price * CABIN_REFIT_COST_BP) / 10000)
      if (airline.cash < cost) return reject(airlineIdx, command, 'insufficient cash')
      airline.cash -= cost
      aircraft.cabin = command.cabin
      return {
        events: [
          { type: 'cabin_refit', airline: airlineIdx, aircraftId: aircraft.id, cabin: aircraft.cabin, cost },
        ],
      }
    }

    case 'sell_aircraft': {
      const aircraft = airline.fleet.find((a) => a.id === command.aircraftId)
      if (!aircraft) return reject(airlineIdx, command, 'no such aircraft')
      // Leased airframes go back to the lessor: no proceeds, no more payments.
      const proceeds = aircraft.leased ? 0 : resaleValue(aircraft.type, aircraft.ageQuarters)
      airline.fleet = airline.fleet.filter((a) => a.id !== aircraft.id)
      airline.cash += proceeds
      return { events: [{ type: 'aircraft_sold', airline: airlineIdx, aircraftId: aircraft.id, proceeds }] }
    }

    case 'acquire_rival': {
      const target = state.airlines[command.target]
      if (!target || command.target === airlineIdx) return reject(airlineIdx, command, 'no such rival')
      if (target.bankrupt) return reject(airlineIdx, command, 'nothing left to buy — they liquidated')
      // Only DISTRESSED rivals sell: insolvent last quarter, or worth a
      // quarter of the acquirer or less. Healthy equals fight on.
      const targetWorth = netWorth(target)
      const distressed = target.insolventQuarters >= 1 || targetWorth * 4 <= netWorth(airline)
      if (!distressed) return reject(airlineIdx, command, 'they are not for sale — too healthy to fold')
      const price = Math.max(
        TAKEOVER_BASE_K,
        Math.floor((Math.max(0, targetWorth) * TAKEOVER_PREMIUM_BP) / 10000),
      )
      if (airline.cash < price) return reject(airlineIdx, command, `insufficient cash — the deal costs ${price}`)
      airline.cash -= price

      // Transfer the whole operation with fresh ids on the acquirer's
      // counter. Routes first (building the id map), then fleet with
      // routeId remapped; duplicate pairs fold into the acquirer's route
      // (their planes arrive unassigned).
      const routeIdMap = new Map<number, number | null>()
      let routesMoved = 0
      for (const r of target.routes) {
        if (airline.routes.some((mine) => mine.from === r.from && mine.to === r.to)) {
          routeIdMap.set(r.id, null)
          continue
        }
        const moved = { ...r, id: airline.nextId++, history: r.history.map((h) => ({ ...h })) }
        airline.routes.push(moved)
        routeIdMap.set(r.id, moved.id)
        routesMoved++
      }
      for (const ac of target.fleet) {
        airline.fleet.push({
          ...ac,
          id: airline.nextId++,
          routeId: ac.routeId === null ? null : (routeIdMap.get(ac.routeId) ?? null),
        })
      }
      for (const o of target.orders) {
        airline.orders.push({ ...o, id: airline.nextId++ })
      }
      for (const l of target.loans) {
        airline.loans.push({ ...l, id: airline.nextId++ })
      }
      for (const c of Object.keys(target.slots).sort()) {
        const n = target.slots[c] ?? 0
        if (n > 0) airline.slots[c] = (airline.slots[c] ?? 0) + n
      }
      for (const p of Object.keys(target.servedUntil).sort()) {
        airline.servedUntil[p] = Math.max(airline.servedUntil[p] ?? 0, target.servedUntil[p] ?? 0)
      }
      const boughtAircraft = target.fleet.length
      // The target folds into the acquirer: an empty shell, marked bankrupt
      // so standings, the race, and resolution all skip it. History stays
      // for the charts.
      target.bankrupt = true
      target.routes = []
      target.fleet = []
      target.orders = []
      target.loans = []
      target.slots = {}
      target.negotiations = []
      target.slotIdle = {}
      target.fuelHedge = null
      target.cash = 0
      return {
        events: [
          {
            type: 'rival_acquired',
            airline: airlineIdx,
            target: command.target,
            price,
            aircraft: boughtAircraft,
            routes: routesMoved,
          },
        ],
      }
    }

    case 'negotiate_slots': {
      if (!isCity(command.city)) return reject(airlineIdx, command, 'unknown city')
      if (!Number.isInteger(command.spend) || command.spend < NEG_MIN_SPEND)
        return reject(airlineIdx, command, `spend must be at least ${NEG_MIN_SPEND}`)
      if (airline.cash < command.spend) return reject(airlineIdx, command, 'insufficient cash')
      if (airline.negotiations.some((n) => n.city === command.city))
        return reject(airlineIdx, command, 'already negotiating at this city')
      const city = getCity(command.city)
      if (slotsAllocated(state, city.id) >= city.slotPool)
        return reject(airlineIdx, command, 'no slots left in the pool')
      airline.cash -= command.spend
      airline.negotiations.push({ city: city.id, spend: command.spend })
      return { events: [{ type: 'negotiation_started', airline: airlineIdx, city: city.id, spend: command.spend }] }
    }

    case 'take_loan': {
      if (!Number.isInteger(command.amount) || command.amount <= 0)
        return reject(airlineIdx, command, 'invalid amount')
      if (totalDebt(airline) + command.amount > debtCeiling(airline))
        return reject(airlineIdx, command, 'over the debt ceiling')
      const annualRateBp = currentLoanRateBp(state)
      const loan = { id: airline.nextId++, principal: command.amount, annualRateBp }
      airline.loans.push(loan)
      airline.cash += command.amount
      return {
        events: [{ type: 'loan_taken', airline: airlineIdx, loanId: loan.id, amount: command.amount, annualRateBp }],
      }
    }

    case 'repay_loan': {
      const loan = airline.loans.find((l) => l.id === command.loanId)
      if (!loan) return reject(airlineIdx, command, 'no such loan')
      if (!Number.isInteger(command.amount) || command.amount <= 0)
        return reject(airlineIdx, command, 'invalid amount')
      const amount = Math.min(command.amount, loan.principal)
      if (airline.cash < amount) return reject(airlineIdx, command, 'insufficient cash')
      airline.cash -= amount
      loan.principal -= amount
      if (loan.principal === 0) airline.loans = airline.loans.filter((l) => l.id !== loan.id)
      return {
        events: [
          { type: 'loan_repaid', airline: airlineIdx, loanId: loan.id, amount, remaining: loan.principal },
        ],
      }
    }

    case 'end_quarter':
      // Resolved by endQuarter (see index.ts); reaching here is a caller bug.
      return reject(airlineIdx, command, 'end_quarter is not a planning command')
  }
}

export function airlineOf(state: GameState, idx: number): Airline {
  const a = state.airlines[idx]
  if (!a) throw new Error(`no airline ${idx}`)
  return a
}
