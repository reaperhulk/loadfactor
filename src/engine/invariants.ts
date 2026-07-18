// Structural invariants that must hold after every engine call. Property tests
// hurl random command sequences at the engine and assert these; they are cheap
// enough to run after every step in the harness too.

import { isAircraftType } from '../data/aircraft'
import { isCity } from '../data/cities'
import { slotsHeld, slotsUsed } from './queries'
import type { GameState } from './types'

function assertInv(cond: boolean, message: string): asserts cond {
  if (!cond) throw new Error(`invariant violated: ${message}`)
}

export function checkInvariants(state: GameState): void {
  assertInv(Number.isSafeInteger(state.turn) && state.turn >= 0, 'turn is a non-negative integer')
  assertInv(['planning', 'won', 'lost'].includes(state.phase), 'phase is valid')
  assertInv(state.world.economyBp > 0 && state.world.fuelBp > 0, 'world indexes positive')

  for (const airline of state.airlines) {
    assertInv(Number.isSafeInteger(airline.cash), `airline ${airline.id} cash is an integer`)
    const routeIds = new Set(airline.routes.map((r) => r.id))
    assertInv(routeIds.size === airline.routes.length, `airline ${airline.id} route ids unique`)

    for (const route of airline.routes) {
      assertInv(isCity(route.from) && isCity(route.to), `route ${route.id} cities exist`)
      assertInv(route.from < route.to, `route ${route.id} pair is canonical`)
      assertInv(route.fareLevel >= -2 && route.fareLevel <= 2, `route ${route.id} fare level in range`)
      assertInv(route.serviceLevel >= 1 && route.serviceLevel <= 3, `route ${route.id} service level in range`)
      assertInv(
        route.lastLoadFactorBp >= 0 && route.lastLoadFactorBp <= 10000,
        `route ${route.id} load factor in [0, 10000]`,
      )
      assertInv(route.lastPax >= 0 && route.lastCapacity >= 0, `route ${route.id} pax/capacity non-negative`)
    }

    for (const ac of airline.fleet) {
      assertInv(isAircraftType(ac.type), `aircraft ${ac.id} type exists`)
      assertInv(ac.ageQuarters >= 0, `aircraft ${ac.id} age non-negative`)
      assertInv(ac.routeId === null || routeIds.has(ac.routeId), `aircraft ${ac.id} assigned to a real route`)
    }

    for (const loan of airline.loans) {
      assertInv(loan.principal > 0, `loan ${loan.id} principal positive`)
    }

    // A route consumes one slot at each endpoint; usage never exceeds holdings.
    const cities = new Set<string>()
    for (const r of airline.routes) {
      cities.add(r.from)
      cities.add(r.to)
    }
    for (const city of [...cities].sort()) {
      assertInv(
        slotsUsed(airline, city) <= slotsHeld(airline, city),
        `airline ${airline.id} slot usage at ${city} within holdings`,
      )
    }
  }
}
