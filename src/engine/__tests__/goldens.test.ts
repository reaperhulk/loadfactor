// Golden careers (PLAN.md §5.3): named bot playthroughs pinned by checkpoint
// hash and headline stats. A diff here means the balance moved — run
// `npm run goldens:update`, commit the fixture, and say so in the commit.

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runCareer } from '../../harness/simulate'
import type { BotName } from '../../harness/bots'

const FIXTURE = join(__dirname, '../../../fixtures/goldens.json')
const UPDATE = process.env.UPDATE_GOLDENS === '1'

interface Golden {
  checkpointHashes: Record<number, string>
  summary: ReturnType<typeof runCareer>['summary']
}

const CAREERS: readonly { name: string; scenario: string; seed: string; bot: BotName; quarters: number }[] = [
  { name: 'greedy-alpha', scenario: 'jet_age', seed: 'alpha', bot: 'greedy', quarters: 40 },
  { name: 'greedy-beta', scenario: 'jet_age', seed: 'beta', bot: 'greedy', quarters: 40 },
  { name: 'naive-alpha', scenario: 'jet_age', seed: 'alpha', bot: 'naive', quarters: 40 },
  { name: 'oil-crisis-greedy', scenario: 'oil_crisis', seed: 'alpha', bot: 'greedy', quarters: 40 },
  { name: 'deregulation-greedy', scenario: 'deregulation', seed: 'alpha', bot: 'greedy', quarters: 40 },
  { name: 'open-skies-greedy', scenario: 'open_skies', seed: 'alpha', bot: 'greedy', quarters: 40 },
]

describe('golden careers', () => {
  const actual: Record<string, Golden> = {}
  for (const career of CAREERS) {
    const result = runCareer(career.scenario, career.seed, career.bot, career.quarters)
    actual[career.name] = { checkpointHashes: result.checkpointHashes, summary: result.summary }
  }

  if (UPDATE) {
    it('updates the fixture', () => {
      writeFileSync(FIXTURE, JSON.stringify(actual, null, 2) + '\n')
      expect(true).toBe(true)
    })
    return
  }

  const goldens = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<string, Golden>

  for (const career of CAREERS) {
    it(`${career.name} matches its pinned outcome`, () => {
      expect(actual[career.name], `golden ${career.name} missing — run npm run goldens:update`).toBeDefined()
      expect(actual[career.name]).toEqual(goldens[career.name])
    })
  }
})
