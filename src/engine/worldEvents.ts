// World economy walks and the event deck (PLAN.md §2.3). Events never mutate
// the underlying walks — their modifiers apply at read time via the eff*
// accessors, so expiry restores the base indexes exactly.

import { CITIES, REGIONS, type Region } from '../data/cities'
import {
  ECONOMY_MAX_BP,
  ECONOMY_MIN_BP,
  ECONOMY_REVERSION_DIV,
  ECONOMY_STEP_BP,
  DEBUT_APPEAL_QUARTERS,
  EVENT_DRAW_CHANCE_BP,
  EVENT_DRAW_CHANCE_BP_V5,
  EVENT_WARNING_QUARTERS_V6,
  FUEL_MAX_BP,
  FUEL_MIN_BP,
  FUEL_REVERSION_DIV,
  FUEL_STEP_BP,
} from '../data/constants'
import { getEventDef, WORLD_EVENTS, WORLD_EVENTS_V5 } from '../data/events'
import { AIRCRAFT } from '../data/aircraft'
import { getScenario } from '../data/scenarios'
import { quarterOf, yearOf } from './queries'
import { chanceBp, nextInt } from './rng'
import type { GameEvent, GameState, WorldState } from './types'

export function effEconomyBp(world: WorldState): number {
  let bp = world.economyBp
  for (const e of world.events) {
    const def = getEventDef(e.id)
    if (def.economyModBp !== undefined) bp = Math.floor((bp * def.economyModBp) / 10000)
  }
  return bp
}

export function effFuelBp(world: WorldState): number {
  let bp = world.fuelBp
  for (const e of world.events) {
    const def = getEventDef(e.id)
    if (def.fuelModBp !== undefined) bp = Math.floor((bp * def.fuelModBp) / 10000)
  }
  return bp
}

// Rules 6: the price a new hedge locks. Announced events are public news, so
// the fuel desk prices half of an announced shock into the contract: hedging
// early is worth more than hedging on the headline.
export function hedgeLockBp(world: WorldState): number {
  const now = effFuelBp(world)
  if (!world.announced?.length) return now
  const landed = effFuelBp({ ...world, events: [...world.events, ...world.announced] })
  return Math.floor((now + landed) / 2)
}

// Demand multiplier at one city from active city/region events.
export function cityDemandModBp(world: WorldState, cityId: string, region: Region): number {
  let bp = 10000
  for (const e of world.events) {
    const def = getEventDef(e.id)
    if (def.demandModBp === undefined) continue
    if ((e.city !== null && e.city === cityId) || (e.region !== null && e.region === region)) {
      bp = Math.floor((bp * def.demandModBp) / 10000)
    }
  }
  return bp
}

function walk(
  value: number,
  stepBp: number,
  min: number,
  max: number,
  reversionDiv: number,
  draw: number,
): number {
  const reversion = Math.trunc((10000 - value) / reversionDiv)
  const next = value + draw * stepBp + reversion
  return Math.max(min, Math.min(max, next))
}

// Mutates state.world and state.rng (callers clone at the entry point).
export function updateWorld(state: GameState): GameEvent[] {
  const events: GameEvent[] = []
  const world = state.world

  // Expire active events.
  const kept = []
  for (const e of world.events) {
    e.quartersLeft--
    if (e.quartersLeft > 0) kept.push(e)
    else events.push({ type: 'world_event_ended', eventId: e.id })
  }
  world.events = kept

  // Random walks with mean reversion (economy stream).
  let econRng = state.rng.economy
  const d1 = nextInt(econRng, -1, 1)
  econRng = d1.rng
  world.economyBp = walk(world.economyBp, ECONOMY_STEP_BP, ECONOMY_MIN_BP, ECONOMY_MAX_BP, ECONOMY_REVERSION_DIV, d1.value)
  const d2 = nextInt(econRng, -1, 1)
  econRng = d2.rng
  world.fuelBp = walk(world.fuelBp, FUEL_STEP_BP, FUEL_MIN_BP, FUEL_MAX_BP, FUEL_REVERSION_DIV, d2.value)
  state.rng.economy = econRng

  const rules = state.rulesVersion ?? 1
  // Rules 6: last quarter's news lands now. The warning was the decision
  // window; the event itself runs its full course from here.
  if (rules >= 6) {
    for (const e of world.announced ?? []) {
      world.events.push(e)
      events.push({ type: 'world_event_started', eventId: e.id, city: e.city, region: e.region })
    }
    world.announced = []
  }

  // Maybe draw a new world event (events stream).
  let evRng = state.rng.events
  const year = yearOf(state)
  const active = new Set([...world.events, ...(world.announced ?? [])].map((e) => e.id))
  const eligible = (rules >= 5 ? WORLD_EVENTS_V5 : WORLD_EVENTS).filter(
    (def) => year >= def.fromYear && year <= def.toYear && !active.has(def.id) && (def.fromRules ?? 1) <= rules,
  )
  const roll = chanceBp(evRng, rules >= 5 ? EVENT_DRAW_CHANCE_BP_V5 : EVENT_DRAW_CHANCE_BP)
  evRng = roll.rng
  if (roll.value && eligible.length > 0) {
    // Scenario era flavor: weight multipliers (oil_shock ×4 in Oil Crisis…).
    const mults = getScenario(state.scenario).eventWeightMult
    const weightOf = (id: string, weight: number): number => Math.floor(weight * (mults?.[id] ?? 1))
    let totalWeight = 0
    for (const def of eligible) totalWeight += weightOf(def.id, def.weight)
    const pick = nextInt(evRng, 0, totalWeight - 1)
    evRng = pick.rng
    let acc = 0
    let chosen = eligible[0]!
    for (const def of eligible) {
      acc += weightOf(def.id, def.weight)
      if (pick.value < acc) {
        chosen = def
        break
      }
    }
    let city: string | null = null
    let region: Region | null = null
    if (chosen.target === 'city') {
      const hosts = CITIES.filter((c) => c.pop >= 5)
        .map((c) => c.id)
        .sort()
      const h = nextInt(evRng, 0, hosts.length - 1)
      evRng = h.rng
      city = hosts[h.value]!
    } else if (chosen.target === 'region') {
      if (chosen.region !== undefined) {
        region = chosen.region
      } else {
        const r = nextInt(evRng, 0, REGIONS.length - 1)
        evRng = r.rng
        region = REGIONS[r.value]!
      }
    }
    const drawn = { id: chosen.id, quartersLeft: chosen.durationQuarters, city, region }
    if (rules >= 6) {
      world.announced = [...(world.announced ?? []), drawn]
      events.push({ type: 'world_event_announced', eventId: chosen.id, city, region, startsTurn: state.turn + EVENT_WARNING_QUARTERS_V6 })
    } else {
      world.events.push(drawn)
      events.push({ type: 'world_event_started', eventId: chosen.id, city, region })
    }
  }
  state.rng.events = evRng

  // Rules 5: a new type's first quarter on sale is news. No draw — the
  // catalog is data — and the fanfare is real: its seats carry extra appeal
  // for DEBUT_APPEAL_QUARTERS (market.ts).
  if (rules >= 5 && quarterOf(state) === 1) {
    for (const type of AIRCRAFT) if (type.availableFrom === year) events.push({ type: 'aircraft_introduced', aircraftType: type.id, name: type.name })
  }

  // Record the macro story: the settled indices for this quarter, capped to
  // a rolling window (charts don't need the whole century).
  world.indexHistory.push({ turn: state.turn, economyBp: world.economyBp, fuelBp: effFuelBp(world) })
  if (world.indexHistory.length > 60) world.indexHistory.shift()
  events.push({ type: 'economy_updated', economyBp: world.economyBp, fuelBp: world.fuelBp })
  return events
}

// Appeal bonus (bp) for seats on a type still in its debut window, 0 after.
export function debutAppealBp(state: GameState, typeId: string, bonusBp: number): number {
  if ((state.rulesVersion ?? 1) < 5) return 0
  const type = AIRCRAFT.find((a) => a.id === typeId)
  if (!type) return 0
  const onSaleForQuarters = (yearOf(state) - type.availableFrom) * 4 + (quarterOf(state) - 1)
  return onSaleForQuarters >= 0 && onSaleForQuarters < DEBUT_APPEAL_QUARTERS ? bonusBp : 0
}
