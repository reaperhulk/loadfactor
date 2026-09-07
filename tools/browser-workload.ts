// Rebuild the replay fixture after intentional rules changes.
import { writeFileSync } from 'node:fs'
import { runCareer } from '../src/harness/simulate'
import { identityOf } from '../src/engine/version'
const career=runCareer('jet_age','browser-workload-v4','greedy',65)
writeFileSync('e2e/fixtures/performance-career.json',JSON.stringify({version:1,...identityOf(career.state),scenario:career.state.scenario,seed:career.state.seed,commands:career.commandLog})+'\n')
console.log(JSON.stringify(career.summary))
