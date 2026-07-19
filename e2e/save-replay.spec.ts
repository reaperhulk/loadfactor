// Save/resume and the replay viewer: a save is (scenario, seed, commands),
// so resuming and replaying are both just deterministic refolds.

import { expect, test, type Page } from '@playwright/test'
import type { Harness } from '../src/ui/harness'

declare global {
  interface Window {
    __harness: Harness
  }
}

async function startGame(page: Page, seed: string): Promise<void> {
  await page.goto('/')
  await page.getByTestId('seed-input').fill(seed)
  await page.getByTestId('start-jet_age').click()
  await expect(page.getByTestId('date')).toHaveText('1960 Q1')
}

test('a game auto-saves and resumes across a page reload', async ({ page }) => {
  await startGame(page, 'save-seed')
  const before = await page.evaluate(() => {
    {
      const snap = window.__harness.getState()!
      const idle = snap.airlines[0]!.fleet.find((ac) => ac.routeId === null)!
      window.__harness.dispatch({ type: 'open_route', from: 'JFK', to: 'ORD', aircraftId: idle.id, frequency: 5 })
    }
    const state = window.__harness.getState()!
    const routeId = state.airlines[0]!.routes[0]!.id
    for (const aircraft of state.airlines[0]!.fleet) {
      window.__harness.dispatch({ type: 'assign_aircraft', aircraftId: aircraft.id, routeId })
    }
    window.__harness.endQuarter()
    window.__harness.endQuarter()
    return JSON.stringify(window.__harness.getState())
  })
  await expect(page.getByTestId('date')).toHaveText('1960 Q3')

  await page.reload()
  await expect(page.getByTestId('continue-save')).toBeVisible()
  await page.getByTestId('continue-save').click()
  await expect(page.getByTestId('date')).toHaveText('1960 Q3')
  const after = await page.evaluate(() => JSON.stringify(window.__harness.getState()))
  expect(after).toBe(before)
  // …and the resumed game keeps playing.
  await page.getByTestId('end-quarter').click()
  await expect(page.getByTestId('date')).toHaveText('1960 Q4')
})

test('two careers live in separate slots; delete frees one', async ({ page }) => {
  await startGame(page, 'slot-seed-a')
  await page.evaluate(() => window.__harness.endQuarter())
  await expect(page.getByTestId('date')).toHaveText('1960 Q2')
  await page.reload()
  await expect(page.getByTestId('save-slot-0')).toContainText('slot-seed-a')
  // A free slot exists, so starting again is a plain click (no overwrite arm).
  await page.getByTestId('seed-input').fill('slot-seed-b')
  await page.getByTestId('start-jet_age').click()
  await expect(page.getByTestId('date')).toHaveText('1960 Q1')
  await page.evaluate(() => window.__harness.endQuarter())
  await page.reload()
  await expect(page.getByTestId('save-slot-0')).toContainText('slot-seed-a')
  await expect(page.getByTestId('save-slot-1')).toContainText('slot-seed-b')
  // The first row resumes the first career untouched.
  await page.getByTestId('continue-save').click()
  await expect(page.getByTestId('date')).toHaveText('1960 Q2')
  const seed = await page.evaluate(() => window.__harness.getState()!.seed)
  expect(seed).toBe('slot-seed-a')
  // Deleting the second save is a two-step confirm and frees the slot.
  await page.reload()
  await page.getByTestId('delete-save-1').click()
  await page.getByTestId('delete-save-1').click()
  await expect(page.getByTestId('save-slot-1')).toHaveCount(0)
  await expect(page.getByTestId('save-slot-0')).toBeVisible()
})

test('a career exports as JSON and imports back into a slot', async ({ page }) => {
  await startGame(page, 'export-seed')
  await page.evaluate(() => window.__harness.endQuarter())
  await page.reload()
  await expect(page.getByTestId('save-slot-0')).toContainText('export-seed')
  // Lift the save JSON (what the export button copies), delete the career,
  // then import the JSON back — it must replay cleanly and reclaim a slot.
  const json = await page.evaluate(() => localStorage.getItem('loadfactor:save:v1'))
  expect(json).not.toBeNull()
  await page.getByTestId('delete-save-0').click()
  await page.getByTestId('delete-save-0').click()
  await expect(page.getByTestId('save-slot-0')).toHaveCount(0)
  // The saved-games card only renders when a save exists — recreate one so
  // the import box is on screen, then import into the next free slot.
  await page.getByTestId('seed-input').fill('other-seed')
  await page.getByTestId('start-jet_age').click()
  await page.evaluate(() => window.__harness.endQuarter())
  await page.reload()
  await page.locator('summary', { hasText: 'Import a career' }).click()
  await page.getByTestId('import-save-text').fill(json!)
  await page.getByTestId('import-save').click()
  await expect(page.getByTestId('save-slot-1')).toContainText('export-seed')
})

test('the replay viewer scrubs a saved career quarter by quarter', async ({ page }) => {
  await startGame(page, 'replay-seed')
  await page.evaluate(() => {
    {
      const snap = window.__harness.getState()!
      const idle = snap.airlines[0]!.fleet.find((ac) => ac.routeId === null)!
      window.__harness.dispatch({ type: 'open_route', from: 'JFK', to: 'MIA', aircraftId: idle.id, frequency: 5 })
    }
    for (let q = 0; q < 6; q++) window.__harness.endQuarter()
  })
  await page.reload()
  await page.getByTestId('watch-save-replay').click()
  await expect(page.getByTestId('replay-viewer')).toBeVisible()

  // Pause autoplay, jump to the start, and step manually.
  await page.getByTestId('replay-playpause').click()
  await page.locator('.replay-controls input[type="range"]').fill('0')
  await expect(page.getByTestId('replay-date')).toHaveText('1960 Q1')
  await page.getByTestId('replay-step').click()
  await expect(page.getByTestId('replay-date')).toHaveText('1960 Q2')
  await page.getByTestId('replay-step').click()
  await expect(page.getByTestId('replay-date')).toHaveText('1960 Q3')

  await page.getByTestId('replay-exit').click()
  await expect(page.getByTestId('continue-save')).toBeVisible()
})

test('game over offers a replay of the whole career', async ({ page }) => {
  await startGame(page, 'gameover-replay-seed')
  await page.evaluate(() => {
    for (let q = 0; q < 80 && window.__harness.getState()!.phase === 'planning'; q++) {
      window.__harness.endQuarter()
    }
  })
  await expect(page.getByTestId('gameover-overlay')).toBeVisible()
  await page.getByTestId('watch-replay').click()
  await expect(page.getByTestId('replay-viewer')).toBeVisible()
  await expect(page.getByTestId('replay-date')).toBeVisible()
})
