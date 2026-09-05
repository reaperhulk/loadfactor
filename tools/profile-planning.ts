// Run with npx vite-node tools/profile-planning.ts. Keep profiling outside the sim.
import { performance } from 'node:perf_hooks'
import { runCareer } from '../src/harness/simulate'
import { forecastQuarter } from '../src/engine/forecast'
import { balancedScheduleCommands } from '../src/ui/assign'
for (const turns of [20, 40, 65]) {
  const start = performance.now()
  const { state } = runCareer('jet_age', 'planning-profile-v2', 'greedy', turns)
  const sim = performance.now() - start
  const samples: number[] = []
  for (let i = 0; i < 12; i++) { const t = performance.now(); forecastQuarter(state, 0); samples.push(performance.now() - t) }
  const t = performance.now(); const proposed = balancedScheduleCommands(state, 0); const schedules = performance.now() - t
  const before = forecastQuarter(state, 0), after = forecastQuarter(state, 0, proposed)
  samples.sort((a,b) => a-b)
  console.log(JSON.stringify({turns:state.turn, routes:state.airlines[0]!.routes.length, fleet:state.airlines[0]!.fleet.length, simulationMs:Math.round(sim), forecastP50Ms:+samples[6]!.toFixed(1), forecastP95Ms:+samples[11]!.toFixed(1), scheduleMs:Math.round(schedules), recommendationProfitDelta:after.profit-before.profit}))
}
