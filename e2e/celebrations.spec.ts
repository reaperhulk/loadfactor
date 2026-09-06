import { expect, test, type Page } from '@playwright/test'
import { flyQuarter, openPanel } from './workspace'

async function start(page: Page) {
  await page.goto('/')
  await page.getByTestId('start-jet_age').click()
  await expect(page.getByTestId('map')).toBeVisible()
}
async function route(page: Page, to = 'ORD') {
  await page.evaluate((to) => {
    const a = window.__harness.getState()!.airlines[0]!
    window.__harness.dispatch({ type: 'open_route', from: a.hq, to, aircraftId: a.fleet.find((f) => f.routeId === null)!.id, frequency: 5 })
  }, to)
}
for (const width of [1440, 390]) test(`celebrations ${width}px: route skip and delivery completion`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 844 })
  await start(page)
  await route(page)
  const scene = page.getByTestId('celebration')
  await expect(scene).toBeVisible()
  await expect(scene).toContainText('New route opened')
  await expect(page.getByTestId('skip-celebration')).toBeFocused()
  expect(await scene.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  await info.attach(`${width}-route-opening`, { body: await page.screenshot(), contentType: 'image/png' })
  await page.keyboard.press('Escape')
  await expect(scene).toHaveCount(0)
  await page.evaluate(() => {
    // Real order/delivery commands, shortened wait to isolate presentation.
    window.__harness.dispatch({ type: 'order_aircraft', aircraftType: 'caravelle' })
    window.__harness.dispatch({ type: 'order_aircraft', aircraftType: 'caravelle' })
    window.__harness.getState()!.airlines[0]!.orders.forEach((o) => { o.quartersLeft = 1 })
  })
  await flyQuarter(page)
  await expect(scene).toContainText('2 aircraft delivered')
  await expect(page.getByTestId('report-card')).toHaveCount(0)
  await info.attach(`${width}-delivery`, { body: await page.screenshot(), contentType: 'image/png' })
  await expect(scene).toHaveCount(0, { timeout: 6000 })
  await expect(page.getByTestId('report-card')).toBeVisible()
  await page.getByTestId('report-card-close').click()
  await openPanel(page, 'fleet')
  await expect(scene).toHaveCount(0)
})

test('celebrations can be permanently disabled and obey reduced motion', async ({ page }) => {
  await start(page)
  await route(page)
  await page.getByRole('button', { name: 'Don’t show these again' }).click()
  await expect(page.getByTestId('celebration')).toHaveCount(0)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('loadfactor:display:v1')!).celebrations)).toBe(false)
  await route(page, 'MIA')
  await expect(page.getByTestId('celebration')).toHaveCount(0)
  await page.reload()
  await page.getByTestId('continue-save').click()
  await expect(page.getByTestId('celebration')).toHaveCount(0)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.evaluate(() => localStorage.setItem('loadfactor:display:v1', JSON.stringify({ celebrations: true, motion: 'system' })))
  await page.reload()
  await page.getByTestId('continue-save').click()
  await page.evaluate(() => {
    window.__harness.dispatch({ type: 'order_aircraft', aircraftType: 'caravelle' })
    window.__harness.getState()!.airlines[0]!.orders.forEach((o) => { o.quartersLeft = 1 })
  })
  await flyQuarter(page)
  await expect(page.getByTestId('report-card')).toBeVisible()
  await expect(page.getByTestId('celebration')).toHaveCount(0)
})

test('inbox acknowledges viewed issues and stays clear across navigation and reload', async ({ page }) => {
  await start(page)
  const badge = page.getByTestId('open-inbox').locator('b')
  await expect(badge).toBeVisible()
  await page.getByTestId('open-inbox').click()
  await expect(badge).toHaveCount(0)
  await expect(page.getByTestId('management-brief')).toBeVisible()
  await openPanel(page, 'fleet')
  await expect(badge).toHaveCount(0)
  await page.reload()
  await page.getByTestId('continue-save').click()
  await expect(badge).toHaveCount(0)
  await flyQuarter(page)
  await page.getByTestId('report-card-close').click()
  await expect(badge).toBeVisible()
  await page.getByTestId('open-inbox').click()
  await expect(badge).toHaveCount(0)
})
