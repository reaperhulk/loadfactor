// Browser smoke suite: the real UI drives the real engine, plus the
// window.__harness hooks the docs promise (CLAUDE.md “Browser playtesting”).

import { expect, test, type Page } from '@playwright/test'
import type { Harness } from '../src/ui/harness'

declare global {
  interface Window {
    __harness: Harness
  }
}

async function startGame(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByTestId('seed-input').fill('e2e-seed')
  await page.getByTestId('start-jet_age').click()
  await expect(page.getByTestId('date')).toHaveText('1960 Q1')
}

test('scenario starts and quarters advance deterministically', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(String(err)))
  await startGame(page)
  await page.getByTestId('end-quarter').click()
  await expect(page.getByTestId('date')).toHaveText('1960 Q2')
  await page.getByTestId('end-quarter').click()
  await page.getByTestId('end-quarter').click()
  await page.getByTestId('end-quarter').click()
  await expect(page.getByTestId('date')).toHaveText('1961 Q1')
  expect(errors).toEqual([])
})

test('routes open by clicking cities and show up in the panel', async ({ page }) => {
  await startGame(page)
  // MIA and ORD are slotted at game start and their dots sit clear of
  // neighbors on the projection (JFK is huddled under Toronto).
  await page.getByTestId('city-MIA').click()
  await page.getByTestId('city-ORD').click()
  await page.getByTestId('tab-routes').click()
  await expect(page.getByTestId('route-MIA-ORD')).toBeVisible()
})

test('the quarterly report reflects the resolved quarter', async ({ page }) => {
  await startGame(page)
  // Open a route and assign the starter fleet through the harness (the same
  // command surface the UI uses), then resolve a quarter in the UI.
  await page.evaluate(() => {
    window.__harness.dispatch({ type: 'open_route', from: 'JFK', to: 'ORD' })
    const state = window.__harness.getState()!
    const routeId = state.airlines[0]!.routes[0]!.id
    for (const aircraft of state.airlines[0]!.fleet) {
      window.__harness.dispatch({ type: 'assign_aircraft', aircraftId: aircraft.id, routeId })
    }
  })
  // Serving a route puts an ambient plane on the map.
  await expect(page.locator('[data-testid^="plane-"]')).toHaveCount(1)
  await page.getByTestId('end-quarter').click()
  await page.getByTestId('tab-report').click()
  await expect(page.getByTestId('report')).toContainText('Quarter closed')
  const loadFactor = await page.evaluate(
    () => window.__harness.getState()!.airlines[0]!.routes[0]!.lastLoadFactorBp,
  )
  expect(loadFactor).toBeGreaterThan(0)
})

test('opening a route triggers the reward animation and toast', async ({ page }) => {
  await startGame(page)
  await page.getByTestId('city-MIA').click()
  await page.getByTestId('city-ORD').click()
  await expect(page.getByTestId('toasts')).toContainText('Route opened: MIA – ORD')
  await expect(page.getByTestId('route-line-new')).toHaveCount(1)
  // The reward is transient: the draw-in class clears on the next action.
  await page.getByTestId('end-quarter').click()
  await expect(page.getByTestId('route-line-new')).toHaveCount(0)
})

test('game over shows the ranked overlay and resets to the menu', async ({ page }) => {
  await startGame(page)
  // Idle airline: fixed costs bleed it into bankruptcy within the window.
  await page.evaluate(() => {
    for (let q = 0; q < 80 && window.__harness.getState()!.phase === 'planning'; q++) {
      window.__harness.endQuarter()
    }
  })
  await expect(page.getByTestId('gameover-overlay')).toBeVisible()
  await expect(page.getByTestId('gameover-overlay')).toContainText('DEFEAT')
  await expect(page.getByTestId('gameover-overlay')).toContainText('Meridian Air')
  await page.getByTestId('new-game').click()
  await expect(page.getByTestId('start-jet_age')).toBeVisible()
})

test('the harness replays deterministically', async ({ page }) => {
  await startGame(page)
  const first = await page.evaluate(() => {
    window.__harness.dispatch({ type: 'open_route', from: 'JFK', to: 'MIA' })
    window.__harness.endQuarter()
    window.__harness.endQuarter()
    return JSON.stringify(window.__harness.getState())
  })
  const second = await page.evaluate(() => {
    window.__harness.reset()
    window.__harness.newGame('jet_age', 'e2e-seed')
    window.__harness.dispatch({ type: 'open_route', from: 'JFK', to: 'MIA' })
    window.__harness.endQuarter()
    window.__harness.endQuarter()
    return JSON.stringify(window.__harness.getState())
  })
  expect(second).toBe(first)
})
