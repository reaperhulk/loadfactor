// Viewport regression suite: the game must work — and never horizontally
// scroll the page — from phone to desktop. Wide tables scroll inside their
// own containers instead.

import { expect, test, type Page } from '@playwright/test'

const VIEWPORTS = [
  { name: 'mobile', width: 360, height: 740 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 800 },
] as const

const TABS = ['routes', 'fleet', 'airports', 'finance', 'report'] as const

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
}

for (const viewport of VIEWPORTS) {
  test(`${viewport.name} (${viewport.width}px): no page overflow, core loop works`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto('/')
    expect(await horizontalOverflow(page), 'menu fits').toBeLessThanOrEqual(0)

    await page.getByTestId('seed-input').fill('viewport-seed')
    await page.getByTestId('start-jet_age').click()
    await expect(page.getByTestId('date')).toHaveText('1960 Q1')
    expect(await horizontalOverflow(page), 'game screen fits').toBeLessThanOrEqual(0)

    // Populate real content (routes table is the widest), then check every tab.
    await page.evaluate(() => {
      window.__harness.dispatch({ type: 'open_route', from: 'JFK', to: 'ORD' })
      const state = window.__harness.getState()!
      const routeId = state.airlines[0]!.routes[0]!.id
      for (const aircraft of state.airlines[0]!.fleet) {
        window.__harness.dispatch({ type: 'assign_aircraft', aircraftId: aircraft.id, routeId })
      }
      window.__harness.dispatch({ type: 'take_loan', amount: 5000 })
      window.__harness.endQuarter()
    })
    for (const tab of TABS) {
      await page.getByTestId(`tab-${tab}`).click()
      expect(await horizontalOverflow(page), `${tab} tab fits`).toBeLessThanOrEqual(0)
    }

    // The core interaction still works at this size.
    await page.getByTestId('end-quarter').click()
    await expect(page.getByTestId('date')).toHaveText('1960 Q3')
  })
}

test('keyboard shortcuts: space ends quarter, digits switch tabs, esc deselects', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('seed-input').fill('shortcut-seed')
  await page.getByTestId('start-jet_age').click()
  await expect(page.getByTestId('date')).toHaveText('1960 Q1')

  await page.locator('body').click() // move focus off the start button
  await page.keyboard.press(' ')
  await expect(page.getByTestId('date')).toHaveText('1960 Q2')

  await page.keyboard.press('2')
  await expect(page.getByTestId('tab-fleet')).toHaveClass(/active/)
  await page.keyboard.press('5')
  await expect(page.getByTestId('tab-report')).toHaveClass(/active/)

  await page.getByTestId('city-MIA').click()
  await expect(page.locator('.city-dot.selected')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(page.locator('.city-dot.selected')).toHaveCount(0)
})
