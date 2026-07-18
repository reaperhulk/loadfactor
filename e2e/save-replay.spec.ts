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
    window.__harness.dispatch({ type: 'open_route', from: 'JFK', to: 'ORD' })
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

test('the replay viewer scrubs a saved career quarter by quarter', async ({ page }) => {
  await startGame(page, 'replay-seed')
  await page.evaluate(() => {
    window.__harness.dispatch({ type: 'open_route', from: 'JFK', to: 'MIA' })
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
