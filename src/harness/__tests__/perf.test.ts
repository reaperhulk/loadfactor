// Perf budget (PLAN.md §5.8): the engine must stay fast enough for instant
// replays and deep fuzzing. A full 80-quarter career runs ~1s locally; the
// budget is a tripwire for order-of-magnitude regressions, sized so CI
// runners (roughly 2x slower) can never flip a result that passed locally.

import { describe, expect, it } from 'vitest'
import { runCareer } from '../simulate'

describe('perf budget', () => {
  it('an 80-quarter greedy career resolves within budget', () => {
    const start = performance.now()
    runCareer('jet_age', 'perf-seed', 'greedy', 80)
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(6000)
  })
})
