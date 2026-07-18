// The CI fuzz sweep: a small deterministic evolutionary hunt for builds that
// break the economy. `npm run fuzz:builds` runs the deep version (bigger
// population/generations/seeds via env). A finding here means the curve has a
// hole — investigate, fix, and pin the genome as a regression below.

import { describe, expect, it } from 'vitest'
import { fuzzBuilds, runGenomeCareer, type Genome } from '../fuzz'

const RUNAWAY_CAP = 15_000_000 // $15B — the fuzzer searches harder than the pinned bots

const POP = Number(process.env.FUZZ_POP ?? 6)
const GENS = Number(process.env.FUZZ_GENS ?? 2)
const SEEDS = (process.env.FUZZ_SEEDS ?? 'alpha').split(',')
const SEARCH_SEEDS = (process.env.FUZZ_SEARCH_SEEDS ?? 'hunt-1').split(',')

describe('build fuzzer', () => {
  it('the evolutionary hunt finds no economy-breaking build', () => {
    for (const searchSeed of SEARCH_SEEDS) {
      const result = fuzzBuilds({
        scenario: 'jet_age',
        seeds: SEEDS,
        population: POP,
        generations: GENS,
        quarters: 80,
        searchSeed,
      })
      // Always log the champion — useful telemetry even when green.
      console.log(
        `fuzz[${searchSeed}]: best fitness $${(result.bestFitness / 1000).toFixed(1)}M ` +
          `over ${result.evaluated} genomes — ${JSON.stringify(result.bestGenome)}`,
      )
      expect(result.bestFitness, `search ${searchSeed} found a runaway build`).toBeLessThan(RUNAWAY_CAP)
    }
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
        negotiateBudgetBp: 15000,
        cashBuffer: 1000,
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
        negotiateBudgetBp: 12000,
        cashBuffer: 6000,
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
