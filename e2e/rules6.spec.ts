import { test, expect } from '@playwright/test'
import { flyQuarter, openPanel } from './workspace'

// Rules 6 in the real UI: routes explain their results, the world's news is
// on the Desk a quarter early, hedges come in halves, the delivery lines
// count orders, and a city can be paid to build.

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.addInitScript(() => localStorage.setItem('loadfactor:display:v1', JSON.stringify({ motion: 'reduced' })))
  await page.goto('/')
  await page.getByTestId('seed-input').fill('rules-six')
  const scenario = page.getByTestId('scenario-hub_defense')
  await scenario.getByRole('button').click()
  await scenario.getByRole('button').click()
})

test('a flown route explains its result', async ({ page }) => {
  expect(await page.evaluate(() => window.__harness.getState()!.rulesVersion)).toBe(6)
  await flyQuarter(page)
  await page.keyboard.press('Escape')
  await openPanel(page, 'routes')
  await page.locator('[data-testid^="inspect-"]').first().click()
  const explain = page.getByTestId('route-explain')
  await explain.scrollIntoViewIfNeeded()
  await expect(explain).toContainText('travellers wanted')
  await expect(explain).toContainText('Flying costs:')
})

test('hedges offer half cover, priced off the fuel bill', async ({ page }) => {
  await flyQuarter(page)
  await page.keyboard.press('Escape')
  await openPanel(page, 'finance')
  const half = page.getByTestId('hedge-4-50')
  await expect(half).toBeVisible()
  await expect(page.getByTestId('hedge-4')).toBeVisible()
  await half.click()
  const hedge = await page.evaluate(() => window.__harness.getState()!.airlines[0]!.fuelHedge)
  expect(hedge).toMatchObject({ quartersLeft: 4, coverBp: 5000 })
  await expect(page.getByTestId('hedge-panel')).toContainText('50% hedged')
})

test('the delivery lines count new-build orders', async ({ page }) => {
  await openPanel(page, 'catalog')
  const line = page.getByTestId('order-line')
  await expect(line).toContainText('0 of 4')
  const type = await page.evaluate(() => {
    const h = window.__harness
    const s = h.getState()!
    return s.airlines[0]!.fleet[0]!.type
  })
  for (let i = 0; i < 4; i++) await page.evaluate((t) => window.__harness.dispatch({ type: 'lease_aircraft', aircraftType: t }), type)
  await expect(line).toContainText('4 of 4')
  await expect(page.getByTestId(`lease-${type}`)).toBeDisabled()
})

test('announced news reaches the Desk before it lands', async ({ page }) => {
  // This seed announces an oil shock in its fourth quarter; fly quarters
  // until the world has news for this airline, then read it on the Desk.
  const announced = await page.evaluate(() => {
    const h = window.__harness
    h.newGame('hub_defense', 'rules-six-8')
    for (let q = 0; q < 12; q++) {
      h.endQuarter()
      const s = h.getState()!
      const flown = new Set(s.airlines[0]!.routes.flatMap((r) => [r.from, r.to]))
      const hit = (s.world.announced ?? []).find((e) => (e.city === null && e.region === null) || (e.city !== null && flown.has(e.city)))
      if (hit) return hit.id
    }
    return null
  })
  expect(announced).toBe('oil_shock')
  await page.keyboard.press('Escape')
  await openPanel(page, 'desk')
  await expect(page.getByTestId('management-brief')).toContainText('Oil shock lands next quarter')
  // The fuel desk says it has priced half of it in.
  await openPanel(page, 'finance')
  await expect(page.getByTestId('hedge-warning')).toContainText('Oil shock announced')
})

test('a city can be paid to build', async ({ page }) => {
  await page.evaluate(() => {
    // A treasury deep enough for a programme at a major airport.
    const h = window.__harness
    h.dispatch({ type: 'take_loan', amount: 20000 })
  })
  await openPanel(page, 'map')
  await page.getByTestId('map-wrap').scrollIntoViewIfNeeded()
  // The map opens framed on this network (Dubai); Istanbul is on it.
  await page.getByTestId('city-IST').click()
  const panel = page.getByTestId('city-panel')
  await expect(panel).toContainText('Istanbul')
  const fund = panel.getByTestId('panel-fund-terminal')
  await expect(fund).toContainText('Fund the next programme')
  const before = await page.evaluate(() => window.__harness.getState()!.world.terminals?.length ?? 0)
  await expect(fund).toBeEnabled()
  // Two clicks: the first arms the confirmation.
  await fund.click()
  await expect(fund).toContainText('Pay')
  await fund.click()
  expect(await page.evaluate(() => window.__harness.getState()!.world.terminals?.length ?? 0)).toBe(before + 1)
  // Concrete takes time: the same airport cannot be funded again at once.
  await expect(fund).toBeDisabled()
})
