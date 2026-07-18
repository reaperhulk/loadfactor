// The build fuzzer (PLAN.md §5.5): a seeded evolutionary search over strategy
// genomes, hunting builds that break the economy — anything that prints past
// the runaway cap the balance envelope allows. CI runs a small smoke sweep on
// every push; `npm run fuzz:builds` runs the deep hunt; findings get pinned as
// regression tests.

import { typesOnSale } from '../data/aircraft'
import { CITIES, distanceKm } from '../data/cities'
import { AI_MIN_ROUTE_KM, NEG_MIN_SPEND } from '../data/constants'
import { applyCommand, newGame } from '../engine'
import { getAircraftType } from '../data/aircraft'
import { negotiationDifficulty } from '../engine/negotiation'
import {
  debtCeiling,
  netWorth,
  slotCities,
  slotsAllocated,
  totalDebt,
  yearOf,
} from '../engine/queries'
import { nextInt, rngFromSeed, type Rng } from '../engine/rng'
import type { Command, GameState } from '../engine/types'
import { assignmentCommands, launchCommands, pairScore } from './bots'

// A strategy genome: every dial the greedy bot hard-codes, as a searchable
// parameter. Ranges are inclusive and integer.
export interface Genome {
  expandThreshold: number // min competition-discounted pair score to open [50..1200]
  buyLfBp: number // network-full threshold before buying [5000..9800]
  fareBias: number // fare level for new routes [-2..2]
  serviceLevel: number // service level for new routes [1..3]
  debtAppetite: number // expansion loan size $k [0..20000]
  renewAge: number // sell airframes at this age (quarters) [24..90]
  negotiateBudgetBp: number // spend as bp of city difficulty [3000..15000]
  cashBuffer: number // keep this much cash when buying [1000..12000]
}

export const GENOME_RANGES: Record<keyof Genome, readonly [number, number]> = {
  expandThreshold: [50, 1200],
  buyLfBp: [5000, 9800],
  fareBias: [-2, 2],
  serviceLevel: [1, 3],
  debtAppetite: [0, 20000],
  renewAge: [24, 90],
  negotiateBudgetBp: [3000, 15000],
  cashBuffer: [1000, 12000],
}

const GENOME_KEYS = Object.keys(GENOME_RANGES).sort() as (keyof Genome)[]

// The generalized bot: greedyCommands with every constant swapped for a gene.
export function genomeCommands(state: GameState, g: Genome): Command[] {
  const airline = state.airlines[0]!
  const commands: Command[] = []

  if (airline.cash < 3000) {
    const room = debtCeiling(airline) - totalDebt(airline)
    if (room >= 5000) commands.push({ type: 'take_loan', amount: Math.min(room, 8000) })
  }

  for (const route of airline.routes) {
    if (route.lastCapacity > 0 && route.lastRevenue * 100 < route.lastCost * 85) {
      commands.push({ type: 'close_route', routeId: route.id })
    }
  }

  const geriatric = airline.fleet
    .filter((a) => a.ageQuarters >= g.renewAge)
    .sort((a, b) => b.ageQuarters - a.ageQuarters)
    .slice(0, 2)
  for (const ac of geriatric) commands.push({ type: 'sell_aircraft', aircraftId: ac.id })

  const launch = launchCommands(state, g.expandThreshold, g.fareBias, g.serviceLevel)
  commands.push(...launch.commands)

  let lastPax = 0
  let lastCapacity = 0
  for (const route of airline.routes) {
    lastPax += route.lastPax
    lastCapacity += route.lastCapacity
  }
  const networkFull = lastCapacity > 0 && lastPax * 10000 >= lastCapacity * g.buyLfBp
  const bootstrapping = airline.fleet.length + airline.orders.length < 4
  if ((networkFull || bootstrapping || geriatric.length > 0) && airline.orders.length === 0) {
    const lastProfit = airline.history[airline.history.length - 1]?.profit ?? 0
    let expectedCash = airline.cash
    if (g.debtAppetite > 0 && airline.cash < g.cashBuffer + g.debtAppetite && lastProfit > 0) {
      const room = debtCeiling(airline) - totalDebt(airline)
      const amount = Math.min(room, g.debtAppetite)
      if (amount >= 1000) {
        commands.push({ type: 'take_loan', amount })
        expectedCash += amount
      }
    }
    const affordable = typesOnSale(yearOf(state)).filter((t) => t.price + g.cashBuffer <= expectedCash)
    if (affordable.length > 0) {
      let pick = affordable[0]!
      for (const t of affordable) if (t.seats > pick.seats) pick = t
      commands.push({ type: 'order_aircraft', aircraftType: pick.id })
    }
  }

  if (airline.negotiations.length === 0 && airline.cash >= 4000) {
    let reach = 0
    for (const ac of airline.fleet) reach = Math.max(reach, getAircraftType(ac.type).rangeKm)
    for (const t of typesOnSale(yearOf(state))) reach = Math.max(reach, t.rangeKm)
    const held = slotCities(airline)
    let target: string | null = null
    let bestScore = 0
    for (const c of CITIES) {
      if ((airline.slots[c.id] ?? 0) > 0) continue
      if (slotsAllocated(state, c.id) >= c.slotPool) continue
      let cityScore = 0
      for (const h of held) {
        const km = distanceKm(c.id, h)
        if (km < AI_MIN_ROUTE_KM || km > reach) continue
        cityScore = Math.max(cityScore, pairScore(state, c.id, h))
      }
      if (cityScore > bestScore) {
        bestScore = cityScore
        target = c.id
      }
    }
    if (target !== null) {
      const spend = Math.max(
        NEG_MIN_SPEND,
        Math.min(Math.floor((negotiationDifficulty(target) * g.negotiateBudgetBp) / 10000), airline.cash - 3000),
      )
      if (spend >= NEG_MIN_SPEND && spend <= airline.cash) {
        commands.push({ type: 'negotiate_slots', city: target, spend })
      }
    }
  }

  // Yield management with genome-neutral thresholds (same as greedy).
  for (const route of airline.routes) {
    if (route.lastCapacity === 0) continue
    if (route.lastLoadFactorBp >= 9700 && route.fareLevel < 2) {
      commands.push({ type: 'set_fare', routeId: route.id, fareLevel: route.fareLevel + 1 })
    } else if (route.lastLoadFactorBp < 5500 && route.fareLevel > -1) {
      commands.push({ type: 'set_fare', routeId: route.id, fareLevel: route.fareLevel - 1 })
    }
  }

  const skip = launch.usedAircraft !== null ? new Set([launch.usedAircraft]) : undefined
  return [...commands, ...assignmentCommands(state, skip)]
}

export function runGenomeCareer(scenarioId: string, seed: string, genome: Genome, quarters: number): number {
  let state = newGame(scenarioId, seed)
  for (let q = 0; q < quarters && state.phase === 'planning'; q++) {
    for (const command of genomeCommands(state, genome)) {
      state = applyCommand(state, command).state
    }
    state = applyCommand(state, { type: 'end_quarter' }).state
  }
  return netWorth(state.airlines[0]!)
}

function randomGenome(rng: Rng): { genome: Genome; rng: Rng } {
  const genome = {} as Genome
  let r = rng
  for (const key of GENOME_KEYS) {
    const [min, max] = GENOME_RANGES[key]
    const draw = nextInt(r, min, max)
    r = draw.rng
    genome[key] = draw.value
  }
  return { genome, rng: r }
}

function mutate(genome: Genome, rng: Rng): { genome: Genome; rng: Rng } {
  const out = { ...genome }
  let r = rng
  for (const key of GENOME_KEYS) {
    const flip = nextInt(r, 0, 99)
    r = flip.rng
    if (flip.value < 30) {
      const [min, max] = GENOME_RANGES[key]
      const span = Math.max(1, Math.floor((max - min) / 5))
      const delta = nextInt(r, -span, span)
      r = delta.rng
      out[key] = Math.max(min, Math.min(max, out[key] + delta.value))
    }
  }
  return { genome: out, rng: r }
}

function crossover(a: Genome, b: Genome, rng: Rng): { genome: Genome; rng: Rng } {
  const out = {} as Genome
  let r = rng
  for (const key of GENOME_KEYS) {
    const pick = nextInt(r, 0, 1)
    r = pick.rng
    out[key] = pick.value === 0 ? a[key] : b[key]
  }
  return { genome: out, rng: r }
}

export interface FuzzResult {
  bestGenome: Genome
  bestFitness: number // mean final net worth across seeds, $k
  evaluated: number
}

export interface FuzzOptions {
  scenario: string
  seeds: readonly string[]
  population: number
  generations: number
  quarters: number
  searchSeed: string
}

// Deterministic evolutionary hunt: same options → same result, so any finding
// is instantly reproducible.
export function fuzzBuilds(options: FuzzOptions): FuzzResult {
  let rng = rngFromSeed(`fuzz ${options.searchSeed}`)
  const fitness = (genome: Genome): number => {
    let total = 0
    for (const seed of options.seeds) {
      total += runGenomeCareer(options.scenario, seed, genome, options.quarters)
    }
    return Math.floor(total / options.seeds.length)
  }

  let population: { genome: Genome; fit: number }[] = []
  for (let i = 0; i < options.population; i++) {
    const g = randomGenome(rng)
    rng = g.rng
    population.push({ genome: g.genome, fit: fitness(g.genome) })
  }
  let evaluated = options.population

  for (let gen = 0; gen < options.generations; gen++) {
    population.sort((a, b) => b.fit - a.fit)
    const elite = population.slice(0, Math.max(2, Math.floor(options.population / 3)))
    const next = [...elite]
    while (next.length < options.population) {
      const i = nextInt(rng, 0, elite.length - 1)
      rng = i.rng
      const j = nextInt(rng, 0, elite.length - 1)
      rng = j.rng
      const crossed = crossover(elite[i.value]!.genome, elite[j.value]!.genome, rng)
      rng = crossed.rng
      const mutated = mutate(crossed.genome, rng)
      rng = mutated.rng
      next.push({ genome: mutated.genome, fit: fitness(mutated.genome) })
      evaluated++
    }
    population = next
  }

  population.sort((a, b) => b.fit - a.fit)
  return { bestGenome: population[0]!.genome, bestFitness: population[0]!.fit, evaluated }
}
