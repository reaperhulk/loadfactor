// The CI fuzz sweep: a small deterministic evolutionary hunt for builds that
// break the economy. `npm run fuzz:builds` runs the deep version (bigger
// population/generations/seeds via env). A finding here means the curve has a
// hole — investigate, fix, and pin the genome as a regression below.

import { setImmediate } from 'node:timers/promises'
import { describe, expect, it } from 'vitest'
import { getScenario } from '../../data/scenarios'
import { fuzzBuilds, fuzzBuildsSteps, runGenomeCareer, type Genome } from '../fuzz'

// The fuzzer searches harder than the pinned bots, so it gets headroom over
// the envelope's 10× cap — but scaled to the scenario's floor, not absolute.
const RUNAWAY_CAP = 15 * getScenario('jet_age').targetNetWorth

const POP = Number(process.env.FUZZ_POP ?? 6)
const GENS = Number(process.env.FUZZ_GENS ?? 2)
const SEEDS = (process.env.FUZZ_SEEDS ?? 'alpha').split(',')
const SEARCH_SEEDS = (process.env.FUZZ_SEARCH_SEEDS ?? 'hunt-1').split(',')

describe('build fuzzer', () => {
  // Each independent search gets its own budget, regardless of seed count.
  // The deep preset took ~15 minutes in aggregate on CI; bundling its three
  // searches into one synchronous test exceeded both test and worker RPC timers.
  it.each(SEARCH_SEEDS)('evolutionary hunt %s finds no economy-breaking build', async (searchSeed) => {
    const search = fuzzBuildsSteps({
      scenario: 'jet_age',
      seeds: SEEDS,
      population: POP,
      generations: GENS,
      quarters: 80,
      searchSeed,
    })
    let step = search.next()
    while (!step.done) {
      // A macrotask (not just Promise.resolve) lets Vitest report results and
      // handle worker messages while the full search continues.
      await setImmediate()
      step = search.next()
    }
    const result = step.value
    // Always log the champion — useful telemetry even when green.
    console.log(
      `fuzz[${searchSeed}]: best fitness $${(result.bestFitness / 1000).toFixed(1)}M ` +
        `over ${result.evaluated} genomes — ${JSON.stringify(result.bestGenome)}`,
    )
    expect(result.bestFitness, `search ${searchSeed} found a runaway build`).toBeLessThan(RUNAWAY_CAP)
  }, 900_000)

  it('the search is deterministic', () => {
    const options = {
      scenario: 'jet_age',
      seeds: ['alpha'],
      population: 4,
      generations: 1,
      quarters: 20,
      searchSeed: 'repro',
    } as const
    const a = fuzzBuilds(options)
    const b = fuzzBuilds(options)
    expect(a).toEqual(b)
  }, 60_000)

  it('pausing between careers preserves the search and evaluates every seed', async () => {
    const options = {
      scenario: 'jet_age',
      seeds: ['alpha', 'beta'],
      population: 4,
      generations: 1,
      quarters: 20,
      searchSeed: 'repro',
    } as const
    const search = fuzzBuildsSteps(options)
    let careers = 0
    let step = search.next()
    while (!step.done) {
      careers++
      await setImmediate()
      step = search.next()
    }
    expect(careers).toBe(step.value.evaluated * options.seeds.length)
    expect(step.value).toEqual(fuzzBuilds(options))
    // Recorded from the synchronous search before introducing checkpoints.
    expect(step.value).toEqual({
      bestFitness: 449273,
      evaluated: 6,
      bestGenome: {
        buyLfBp: 6701, cabin: 1, cashBuffer: 10184, contestDiscountBp: 12608,
        debtAppetite: 18120, expandThreshold: 338, fareBias: 2, fareFloor: -1,
        hedges: 0, marketing: 3, renewAge: 27, serviceLevel: 2,
        slotBudgetBp: 8616, takeovers: 0,
      },
    })
  }, 60_000)

  // Pinned regression genomes: past fuzzer finds (or hand-built abuses) that
  // must stay inside the envelope forever.
  const PINNED: { name: string; genome: Genome }[] = [
    {
      // Maximum leverage, rock-bottom expansion bar, never renew: the
      // debt-fueled sprawl build.
      name: 'debt-sprawl',
      genome: {
        expandThreshold: 50,
        buyLfBp: 5000,
        fareBias: 0,
        serviceLevel: 2,
        debtAppetite: 20000,
        renewAge: 90,
        slotBudgetBp: 15000,
        cashBuffer: 1000,
        cabin: 1, // pack every seat the sprawl can sell
        fareFloor: -2,
        contestDiscountBp: 6000,
        marketing: 3, // every compounding lever pulled at once
        hedges: 1,
        takeovers: 1,
      },
    },
    {
      // Premium gouging on monopoly trunks only.
      name: 'monopoly-gouger',
      genome: {
        expandThreshold: 900,
        buyLfBp: 9000,
        fareBias: 2,
        serviceLevel: 3,
        debtAppetite: 8000,
        renewAge: 48,
        slotBudgetBp: 12000,
        cashBuffer: 6000,
        cabin: 3, // premium fit to stack yield on top of the gouge
        fareFloor: 0,
        contestDiscountBp: 14000,
        marketing: 2,
        hedges: 1,
        takeovers: 0,
      },
    },
  ]

  for (const { name, genome } of PINNED) {
    it(`pinned build "${name}" stays inside the envelope`, () => {
      let worst = 0
      for (const seed of ['alpha', 'beta']) {
        worst = Math.max(worst, runGenomeCareer('jet_age', seed, genome, 80))
      }
      expect(worst, `${name} prints past the cap`).toBeLessThan(RUNAWAY_CAP)
    }, 60_000)
  }
})
