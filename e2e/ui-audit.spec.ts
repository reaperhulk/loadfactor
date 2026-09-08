import { expect, test, type Locator, type Page } from '@playwright/test'
import { openPanel } from './workspace'

async function inside(control: Locator, page: Page) {
  const rect = await control.boundingBox(), viewport = page.viewportSize()!
  expect(rect).not.toBeNull()
  expect(rect!.x).toBeGreaterThanOrEqual(-1)
  expect(rect!.y).toBeGreaterThanOrEqual(-1)
  expect(rect!.x + rect!.width).toBeLessThanOrEqual(viewport.width + 1)
  expect(rect!.y + rect!.height).toBeLessThanOrEqual(viewport.height + 1)
  expect(await control.evaluate(el => {
    const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.x+r.width/2, r.y+r.height/2)
    return hit === el || el.contains(hit)
  }), 'control is not covered').toBe(true)
}

for (const [width, height] of [[390,844], [1366,768]]) {
  test(`UI audit first flight ${width}px: starter and a real route launch`, async ({ page }) => {
    await page.setViewportSize({width:width!, height:height!})
    await page.goto('/')
    await inside(page.getByTestId('start-first-career'), page)
    await page.getByTestId('seed-input').fill('audit-first-flight')
    await page.getByTestId('airline-name').fill('Audit Air')
    await page.getByTestId('start-first-career').click()
    await expect(page.getByRole('heading', {name:'Audit Air'})).toBeVisible()
    await page.getByRole('button', {name:'Compare first routes'}).click()
    await expect(page.getByTestId('tab-desk')).toHaveClass(/active/)
    await page.getByRole('button', {name:'Compare this launch'}).first().click()
    await page.getByTestId('route-setup-confirm').click()
    await openPanel(page, 'map')
    await expect(page.getByTestId('first-flight')).toHaveCount(0)
    expect(await page.evaluate(() => window.__harness.getState()!.airlines[0]!.routes.length)).toBe(1)
  })
}
