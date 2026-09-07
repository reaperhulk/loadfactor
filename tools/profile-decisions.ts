// New decision tools; include a genuinely feasible expansion, not just scans.
import { performance } from 'node:perf_hooks'
import { runCareer } from '../src/harness/simulate'
import { applyCommand } from '../src/engine'
import { networkRecommendations } from '../src/engine/planning'
import { expansionOptions } from '../src/engine/expansion'
for (const turns of [20, 40, 65]) {
  const original = runCareer('jet_age', 'planning-profile-v2', 'greedy', turns).state
  const ac = original.airlines[0]!.fleet.find(a => a.routeId !== null)!
  const state = applyCommand(original, { type: 'assign_aircraft', aircraftId: ac.id, routeId: null }).state
  for (const [name, run] of [['network', () => networkRecommendations(state, 0)], ['expansion', () => expansionOptions(state, 0)]] as const) {
    run()
    const times: number[] = []
    let result: ReturnType<typeof run> | undefined
    for (let i = 0; i < 8; i++) { const start = performance.now(); result = run(); times.push(performance.now() - start) }
    times.sort((a,b)=>a-b)
    console.log(JSON.stringify({ turns, name, p50Ms: +times[4]!.toFixed(2), p95Ms: +times[7]!.toFixed(2),
      options: Array.isArray(result) ? result.length : result?.options.length }))
  }
}
