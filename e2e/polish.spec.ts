// The UI polish pass, held in place: words that used to run together, the
// launch dialog's primary action, the celebration's one voice and working
// link, honest Desk/Orders navigation, the race chart at true size, the
// keyboard path (skip link, no stray tab stops) and the narrowest phones.

import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import type { GameState } from '../src/engine'
import { flyQuarter, openPanel } from './workspace'

const mature = JSON.parse(readFileSync(new URL('./fixtures/density-career.json', import.meta.url), 'utf8')) as GameState

async function start(page: Page) {
  await page.goto('/')
  await page.getByTestId('start-jet_age').click()
  await expect(page.getByTestId('date')).toHaveText('1960 Q1')
}
async function startMature(page: Page) {
  await start(page)
  await page.evaluate((snapshot) => {
    Object.assign(window.__harness.getState()!, snapshot)
    window.__harness.dispatch({ type: 'set_fare', routeId: snapshot.airlines[0]!.routes[0]!.id, fareLevel: snapshot.airlines[0]!.routes[0]!.fareLevel })
  }, mature)
}
// Rendered line boxes of an element's text (innerText ignores wrapping).
async function lines(page: Page, testId: string): Promise<number> {
  return page.getByTestId(testId).evaluate((el) => {
    const range = document.createRange()
    range.selectNodeContents(el)
    return new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.bottom))).size
  })
}
async function quiet(page: Page) {
  await page.addInitScript(() => localStorage.setItem('loadfactor:display:v1', JSON.stringify({ motion: 'reduced' })))
}

test('airports and reports never run words together', async ({ page }) => {
  await quiet(page)
  await startMature(page)
  await openPanel(page, 'airports')
  const releases = page.locator('[data-testid^="release-"]')
  expect(await releases.count()).toBeGreaterThan(0)
  for (const cell of await releases.evaluateAll((els) => els.map((el) => (el.closest('td') as HTMLElement).innerText))) {
    // "10 / 3⚠ hand back 7" and "2 / 0hand back 2" were the bug.
    expect(cell).toMatch(/^\d+ \/ \d+\s+(⚠\s)?hand back \d+$/)
  }
  // Plain words for the building programme: "+3 slots in 37 quarters".
  await expect(page.locator('[data-testid^="expansion-"]').first()).toHaveText(/^\+\d+ slots (this quarter|next quarter|in \d+ quarters)$/)
  await flyQuarter(page)
  await page.getByTestId('report-card-close').click()
  await openPanel(page, 'report')
  const text = (await page.getByTestId('page-report').innerText()).toLowerCase()
  expect(text).not.toContain('quarterlyannual')
  const quarterly = (await page.getByTestId('report-view-quarter').boundingBox())!
  const annual = (await page.getByTestId('report-view-years').boundingBox())!
  expect(annual.x).toBeGreaterThanOrEqual(quarterly.x + quarterly.width)
  await expect(page.getByTestId('report-view-quarter')).toHaveAttribute('aria-pressed', 'true')
})

for (const width of [1440, 360]) test(`launch dialog ${width}px: Open route is the primary action and the controls are full width`, async ({ page }) => {
  await quiet(page)
  await page.setViewportSize({ width, height: 800 })
  await start(page)
  await openPanel(page, 'desk')
  await page.getByTestId('management-brief').getByRole('button', { name: 'Plan this launch' }).first().click()
  const dialog = page.getByTestId('route-setup')
  await expect(dialog).toBeVisible()
  const confirm = page.getByTestId('route-setup-confirm'), stage = page.getByTestId('route-setup-stage')
  const fill = (el: Element) => getComputedStyle(el).backgroundColor
  expect(await confirm.evaluate(fill)).not.toBe(await stage.evaluate(fill))
  // Filled with the accent colour as resolved where the button sits.
  expect(await confirm.evaluate((el) => {
    const probe = document.createElement('span'); probe.style.color = 'var(--accent)'; el.parentElement!.append(probe)
    const color = getComputedStyle(probe).color; probe.remove(); return color === getComputedStyle(el).backgroundColor
  })).toBe(true)
  const card = (await dialog.locator('.route-launch-review').boundingBox())!
  const slider = (await dialog.locator('input[type=range]').boundingBox())!
  expect(slider.width).toBeGreaterThan(card.width * 0.7)
  const select = page.getByTestId('route-setup-aircraft')
  expect(await select.evaluate((el: HTMLSelectElement) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
  await expect(page.getByTestId('route-setup-max')).toContainText('round trips a week')
  // No "$0k" for a launch that costs nothing up front.
  await expect(page.getByTestId('route-setup-estimate')).toContainText('launch cash —')
  // One line for the primary action, even on the narrowest phones.
  expect(await lines(page, 'route-setup-confirm')).toBe(1)
})

test('a celebrated route opening is not repeated as a toast, and its hint goes to Routes', async ({ page }) => {
  await page.clock.install()
  await start(page)
  await openPanel(page, 'desk')
  await page.getByRole('button', { name: 'Plan this launch' }).first().click()
  await page.getByTestId('route-setup-confirm').click()
  const scene = page.getByTestId('celebration')
  await expect(scene).toBeVisible()
  // The unlock toast still arrives; the "Route opened" one does not.
  await expect(page.getByTestId('toasts')).toContainText('Achievement unlocked')
  await expect(page.getByTestId('toasts')).not.toContainText('Route opened')
  await page.getByTestId('celebration-next').click()
  await expect(scene).toHaveCount(0)
  await expect(page.getByTestId('tab-routes')).toHaveAttribute('aria-current', 'page')
})

test('the Desk button says what it is and lands on the Desk; empty Orders leads to the market', async ({ page }) => {
  await quiet(page)
  await start(page)
  await openPanel(page, 'orders')
  await expect(page.getByTestId('orders-empty')).toBeVisible()
  await page.getByTestId('orders-open-market').click()
  await expect(page.getByTestId('tab-catalog')).toHaveAttribute('aria-current', 'page')
  await page.evaluate(() => {
    const a = window.__harness.getState()!.airlines[0]!
    window.__harness.dispatch({ type: 'open_route', from: a.hq, to: 'ORD', aircraftId: a.fleet.find((f) => f.routeId === null)!.id, frequency: 5 })
  })
  await flyQuarter(page)
  await page.getByTestId('report-card-close').click()
  const desk = page.getByTestId('open-inbox')
  await expect(desk).toHaveAttribute('aria-label', /^Desk · \d+ new$/)
  await expect(desk.locator('b')).toHaveText(/^\d+ new$/)
  await desk.click()
  await expect(page.locator('#desk-heading')).toBeFocused()
  await expect(desk).toHaveAttribute('aria-label', 'Desk')
  // Plain words on the Desk calendar.
  await expect(page.getByTestId('world-outlook').locator('summary')).not.toContainText(/in 0q/)
})

test('keyboard: skip link first, no stray tab stop in the status strip, rings inside the tab strip', async ({ page }) => {
  await quiet(page)
  await start(page)
  const first = await page.evaluate(() => {
    const focusable = [...document.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, summary, [tabindex]')]
      .filter((el) => el.tabIndex >= 0 && !(el as HTMLButtonElement).disabled && el.getClientRects().length > 0)
    return focusable[0]?.getAttribute('data-testid')
  })
  expect(first).toBe('skip-link')
  const skip = page.getByTestId('skip-link')
  await skip.focus()
  const shown = (await skip.boundingBox())!
  expect(shown.y).toBeGreaterThanOrEqual(0)
  await page.keyboard.press('Enter')
  await expect(page.locator('#workspace-content')).toBeFocused()
  // The status strip reports; it has nothing to press.
  expect(await page.getByTestId('status-bar').locator('a[href], button, input, select, [tabindex]').count()).toBe(0)
  // Focus rings in the scrolling tab strip are drawn inside the button.
  await openPanel(page, 'map')
  await page.getByTestId('tab-map').focus()
  await page.keyboard.press('Tab')
  await expect(page.getByTestId('tab-routes')).toBeFocused()
  const offset = await page.getByTestId('tab-routes').evaluate((el) => parseFloat(getComputedStyle(el).outlineOffset))
  expect(offset).toBeLessThan(0)
})

test('offers and marketing: selected states read as selected, not disabled', async ({ page }) => {
  await quiet(page)
  await start(page)
  await openPanel(page, 'finance')
  const low = page.getByTestId('marketing-1')
  await low.click()
  await expect(low).toHaveAttribute('aria-pressed', 'true')
  await expect(low).toBeEnabled()
  await expect(page.getByTestId('marketing-0')).toHaveAttribute('aria-pressed', 'false')
  // The loan amount is a labelled field with its unit.
  await expect(page.getByRole('spinbutton', { name: /^Amount/ })).toHaveValue('5000')
  await expect(page.getByTestId('loan-amount-readout')).toHaveText('= $5.0M')
})

for (const width of [1440, 390]) test(`race chart ${width}px: app-sized labels, dated axis, legend and no end-label collisions`, async ({ page }) => {
  await quiet(page)
  await page.setViewportSize({ width, height: 900 })
  await startMature(page)
  await openPanel(page, 'rivals')
  const chart = page.locator('.race-chart')
  await expect(chart).toBeVisible()
  const legend = page.getByTestId('race-legend')
  for (const a of mature.airlines) await expect(legend).toContainText(a.name)
  const sizes = await chart.locator('text').evaluateAll((els) => els.map((el) => parseFloat(getComputedStyle(el).fontSize)))
  for (const size of sizes) {
    expect(size).toBeGreaterThanOrEqual(11)
    expect(size).toBeLessThanOrEqual(13)
  }
  const ticks = await chart.locator('.chart-axis-label').allTextContents()
  expect(ticks.length).toBeGreaterThanOrEqual(2)
  for (const t of ticks) expect(t).toMatch(/^\d{4} Q[1-4]$/)
  const boxes = await chart.locator('.chart-end-label').evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((r) => ({ top: r.top, bottom: r.bottom })))
  boxes.sort((a, b) => a.top - b.top)
  for (let k = 1; k < boxes.length; k++) expect(boxes[k]!.top).toBeGreaterThanOrEqual(boxes[k - 1]!.bottom - 2)
  const tickBoxes = await chart.locator('.chart-axis-label').evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((r) => ({ left: r.left, right: r.right })))
  for (let k = 1; k < tickBoxes.length; k++) expect(tickBoxes[k]!.left).toBeGreaterThan(tickBoxes[k - 1]!.right)
})

test('360px: tabs scroll instead of truncating, the quarter bar stays one line', async ({ page }) => {
  await quiet(page)
  await page.setViewportSize({ width: 360, height: 740 })
  await startMature(page)
  await openPanel(page, 'catalog')
  for (const id of ['tab-fleet', 'tab-operations', 'tab-orders', 'tab-catalog']) {
    const tab = page.getByTestId(id)
    expect(await tab.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), `${id} is not truncated`).toBe(true)
  }
  await expect(page.getByRole('button', { name: 'Aircraft market' })).toBeVisible()
  expect(await lines(page, 'end-quarter')).toBe(1)
  const objective = page.getByTestId('networth')
  expect(await objective.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
  expect(overflow).toBe(0)
})

test('city panel names market size in plain words', async ({ page }) => {
  await quiet(page)
  await start(page)
  await openPanel(page, 'map')
  await page.getByTestId('city-ORD').click()
  const panel = page.getByTestId('city-panel')
  await expect(panel).toContainText(/market size \d+/)
  await expect(panel).not.toContainText(/· mass /)
})
