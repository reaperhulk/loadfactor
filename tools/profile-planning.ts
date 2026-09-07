// Copy this script unchanged to another revision for an apples-to-apples run.
// npx vite-node tools/profile-planning.ts
import { performance } from 'node:perf_hooks'
import { runCareer } from '../src/harness/simulate'
import { hashState } from '../src/harness/hash'
import { forecastQuarter } from '../src/engine/forecast'
import { balancedScheduleCommands } from '../src/ui/assign'
function measure(fn: () => unknown, samples: number) {
  for (let i = 0; i < 3; i++) fn()
  const times = Array.from({ length: samples }, () => { const t = performance.now(); fn(); return performance.now() - t }).sort((a,b)=>a-b)
  return { p50: +times[Math.floor(samples / 2)]!.toFixed(2), p95: +times[Math.ceil(samples * .95) - 1]!.toFixed(2) }
}
for (const turns of [20, 40, 65]) {
  const { state } = runCareer('jet_age', 'planning-profile-v2', 'greedy', turns)
  const forecast = measure(() => forecastQuarter(state, 0), 24)
  const schedules = measure(() => balancedScheduleCommands(state, 0), 12)
  const commands = balancedScheduleCommands(state, 0)
  const before = forecastQuarter(state, 0), after = forecastQuarter(state, 0, commands)
  console.log(JSON.stringify({ turns: state.turn, routes: state.airlines[0]!.routes.length, fleet: state.airlines[0]!.fleet.length,
    hash: hashState(state), forecast, schedules, recommendationProfitDelta: after.profit - before.profit }))
}
