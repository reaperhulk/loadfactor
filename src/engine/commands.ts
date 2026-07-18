// Planning-phase command validation and application, used identically by the
// player (via applyCommand) and rival policies (via turn.ts). Invalid commands
// reject with a command_rejected event — engine entry points never throw on
// user input.

import { getAircraftType, isAircraftType } from '../data/aircraft'
import { distanceKm, getCity, isCity } from '../data/cities'
import {
  BASE_LOAN_RATE_BP,
  LOAN_RATE_ECONOMY_SLOPE,
  MIN_LOAN_RATE_BP,
  MIN_ROUTE_KM,
  NEG_MIN_SPEND,
} from '../data/constants'
import {
  debtCeiling,
  findRoute,
  resaleValue,
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
      if (distanceKm(a, b) < MIN_ROUTE_KM) return reject(airlineIdx, command, 'route too short')
      if (slotsFree(airline, a) < 1) return reject(airlineIdx, command, `no free slots at ${a}`)
      if (slotsFree(airline, b) < 1) return reject(airlineIdx, command, `no free slots at ${b}`)
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
        lastPax: 0,
        lastCapacity: 0,
        lastLoadFactorBp: 0,
        lastRevenue: 0,
        lastCost: 0,
        history: [],
      }
      airline.routes.push(route)
      return { events: [{ type: 'route_opened', airline: airlineIdx, routeId: route.id, from: a, to: b }] }
    }

    case 'close_route': {
      const route = findRoute(airline, command.routeId)
      if (!route) return reject(airlineIdx, command, 'no such route')
      for (const ac of airline.fleet) if (ac.routeId === route.id) ac.routeId = null
      airline.routes = airline.routes.filter((r) => r.id !== route.id)
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
      const order = { id: airline.nextId++, type: type.id, quartersLeft: type.deliveryQuarters }
      airline.orders.push(order)
      return {
        events: [
          { type: 'aircraft_ordered', airline: airlineIdx, orderId: order.id, aircraftType: type.id, price: type.price },
        ],
      }
    }

    case 'sell_aircraft': {
      const aircraft = airline.fleet.find((a) => a.id === command.aircraftId)
      if (!aircraft) return reject(airlineIdx, command, 'no such aircraft')
      const proceeds = resaleValue(aircraft.type, aircraft.ageQuarters)
      airline.fleet = airline.fleet.filter((a) => a.id !== aircraft.id)
      airline.cash += proceeds
      return { events: [{ type: 'aircraft_sold', airline: airlineIdx, aircraftId: aircraft.id, proceeds }] }
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
      const annualRateBp = Math.max(
        MIN_LOAN_RATE_BP,
        BASE_LOAN_RATE_BP + Math.floor((10000 - state.world.economyBp) / LOAN_RATE_ECONOMY_SLOPE),
      )
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
