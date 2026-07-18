// Perf budget (PLAN.md §5.8): the engine must stay fast enough for instant
// replays and deep fuzzing. A full 80-quarter career, with per-quarter
// invariant checks, should be far under a second — budget 3s for slow CI.

import { describe, expect, it } from 'vitest'
import { runCareer } from '../simulate'

describe('perf budget', () => {
  it('an 80-quarter greedy career resolves within budget', () => {
    const start = performance.now()
    runCareer('jet_age', 'perf-seed', 'greedy', 80)
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(3000)
  })
})
