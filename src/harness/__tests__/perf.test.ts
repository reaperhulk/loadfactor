// Perf budget (PLAN.md §5.8): the engine must stay fast enough for instant
// replays and deep fuzzing. Batched planning commands avoid cloning the whole
// state for every bot action. The generous ceiling remains a CI tripwire,
// while the second assertion guards replay throughput directly.

import { identityOf } from '../../engine/version'
import { describe, expect, it } from 'vitest'
import { runReplay } from '../../engine'
import { runCareer } from '../simulate'

describe('perf budget', () => {
  it('an 80-quarter greedy career resolves within budget', () => {
    const start = performance.now()
    runCareer('jet_age', 'perf-seed', 'greedy', 80)
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(6000)
  })

  it('replays an 80-quarter command log within budget', () => {
    const career = runCareer('jet_age', 'perf-replay-seed', 'greedy', 80)
    const start = performance.now()
    runReplay({ ...identityOf(career.state), scenario: 'jet_age', seed: 'perf-replay-seed', commands: career.commandLog })
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(3000)
  })
})
