// Reproducible scenario/policy matrix, independent of the pinned golden seeds.
// Run: npx vite-node tools/balance-report.ts [seed-prefix] [seed-count] [output]
import { writeFileSync } from 'node:fs'
import { ALL_SCENARIOS } from '../src/data/scenarios'
import { runCareer } from '../src/harness/simulate'
import { objectiveQualified, objectiveScore } from '../src/engine/queries'
import type { BotName } from '../src/harness/bots'
const prefix = process.argv[2] ?? 'validation-v2'
const count = Number(process.argv[3] ?? 8)
const rows = []
for (const scenario of ALL_SCENARIOS.filter((s) => !process.argv[5] || process.argv[5].split(',').includes(s.id))) {
  for (const bot of ['naive', 'greedy', 'cautious'] as BotName[]) {
    for (let i = 0; i < count; i++) {
      const seed = `${prefix}-${i}`
      const result = runCareer(scenario.id, seed, bot, scenario.quarters)
      const player = result.state.airlines[0]!
      rows.push({ scenario: scenario.id, seed, bot, ...result.summary,
        score: objectiveScore(player, scenario.objective.kind), qualified: objectiveQualified(result.state, player),
        liveRivals: result.state.airlines.filter((a) => a.controller === 'rival' && !a.bankrupt).length })
    }
  }
  const summary = ['naive', 'greedy', 'cautious'].map((bot) => {
    const r = rows.filter((r) => r.scenario === scenario.id && r.bot === bot)
    return { bot, survived: r.filter((x) => x.turn === scenario.quarters).length, won: r.filter((x) => x.phase === 'won').length,
      qualified: r.filter((x) => x.qualified).length, scoreMedian: r.map((x) => x.score).sort((a,b) => a-b)[Math.floor(r.length/2)] }
  })
  console.log(JSON.stringify({ scenario: scenario.id, target: scenario.objective.target, results: summary }))
}
writeFileSync(process.argv[4] ?? '/tmp/loadfactor-balance-v2.json', JSON.stringify(rows, null, 2) + '\n')
