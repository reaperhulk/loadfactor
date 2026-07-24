// The build fuzzer (PLAN.md §5.5): a seeded evolutionary search over strategy
// genomes, hunting builds that break the economy — anything that prints past
// the runaway cap the balance envelope allows. CI runs a small smoke sweep on
// every push; `npm run fuzz:builds` runs the deep hunt; findings get pinned as
// regression tests.

import { applyCommand, newGame } from '../engine'
import {
  assignmentCommands,
  hedgeCommands,
  launchCommands,
  marketingCommands,
  negotiationCommands,
  orderCommands,
  pruneCommands,
  refitCommands,
  renewalCommands,
  scheduleCommands,
  takeoverCommands,
  treasuryCommands,
  yieldCommands,
  type PolicyDials,
} from '../engine/policy'
import { netWorth } from '../engine/queries'
import { nextInt, rngFromSeed, type Rng } from '../engine/rng'
import type { Command, GameState } from '../engine/types'

// A strategy genome: every dial the greedy bot hard-codes, as a searchable
// parameter. Ranges are inclusive and integer.
export interface Genome {
  expandThreshold: number // min market score (demand net of seats) to open [50..1200]
  buyLfBp: number // network-full threshold before buying [5000..9800]
  fareBias: number // fare level for new routes [-2..2]
  serviceLevel: number // service level for new routes [1..3]
  fareFloor: number // yield management floor [-2..0]
  debtAppetite: number // expansion loan size $k [0..20000]
  renewAge: number // sell airframes at this age (quarters) [24..90]
  negotiateBudgetBp: number // spend as bp of city difficulty [3000..15000]
  cashBuffer: number // keep this much cash when buying [1000..12000]
  cabin: number // fleet cabin doctrine: 1 dense / 2 standard / 3 premium
  contestDiscountBp: number // how heavily fielded seats discount a pair [6000..14000]
  marketing: number // brand level held while liquid [0..3]
  hedges: number // 1 = hedge cheap fuel
  takeovers: number // 1 = reach for the acquisition lever (4x clause included)
}

export const GENOME_RANGES: Record<keyof Genome, readonly [number, number]> = {
  expandThreshold: [50, 1200],
  buyLfBp: [5000, 9800],
  fareBias: [-2, 2],
  serviceLevel: [1, 3],
  fareFloor: [-2, 0],
  debtAppetite: [0, 20000],
  renewAge: [24, 90],
  negotiateBudgetBp: [3000, 15000],
  cashBuffer: [1000, 12000],
  cabin: [1, 3],
  contestDiscountBp: [6000, 14000],
  marketing: [0, 3],
  hedges: [0, 1],
  takeovers: [0, 1],
}

const GENOME_KEYS = Object.keys(GENOME_RANGES).sort() as (keyof Genome)[]

// The generalized bot: the shared policy brain with every dial swapped for a
// gene — including the compounding levers (marketing, hedging, takeovers)
// the old genome couldn't reach, which are exactly the mechanics most likely
// to break the curve.
export function genomeCommands(state: GameState, g: Genome): Command[] {
  const dials: PolicyDials = {
    fareLevel: g.fareBias,
    serviceLevel: g.serviceLevel,
    fareFloor: g.fareFloor,
    expandMinDemand: g.expandThreshold,
    contestDiscountBp: g.contestDiscountBp,
    negotiateBudgetBp: g.negotiateBudgetBp,
    raidBonus: 0,
    homeRegionUntil: 0,
    marketing: g.marketing,
  }
  const commands: Command[] = []
  commands.push(...treasuryCommands(state, 0))
  if (g.hedges === 1) commands.push(...hedgeCommands(state, 0))
  commands.push(...scheduleCommands(state, 0))
  commands.push(...marketingCommands(state, 0, g.marketing))
  commands.push(...pruneCommands(state, 0))
  const renewal = renewalCommands(state, 0, g.renewAge)
  commands.push(...renewal)
  commands.push(...refitCommands(state, 0, g.cabin))
  if (g.takeovers === 1) commands.push(...takeoverCommands(state, 0, false))
  const launch = launchCommands(state, 0, dials)
  commands.push(...launch.commands)
  commands.push(
    ...orderCommands(state, 0, {
      renewedThisQuarter: renewal.length > 0,
      buyLfBp: g.buyLfBp,
      debtAppetite: g.debtAppetite,
      cashFloor: g.cashBuffer,
    }),
  )
  commands.push(...negotiationCommands(state, 0, dials))
  commands.push(...yieldCommands(state, 0, g.fareFloor))
  const skip = launch.usedAircraft !== null ? new Set([launch.usedAircraft]) : undefined
  return [...commands, ...assignmentCommands(state, 0, skip)]
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
