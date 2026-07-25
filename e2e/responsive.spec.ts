// Viewport regression suite: the game must work — and never horizontally
// scroll the page — from phone to desktop. Wide tables scroll inside their
// own containers instead.

import { expect, test, type Page } from '@playwright/test'

const VIEWPORTS = [
  { name: 'mobile', width: 360, height: 740 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 800 },
] as const

const TABS = ['routes', 'fleet', 'airports', 'rivals', 'finance', 'report'] as const

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
      window.__harness.dispatch({ type: 'take_loan', amount: 5000 })
      window.__harness.endQuarter()
    })
    for (const tab of TABS) {
      await page.getByTestId(`tab-${tab}`).click()
      expect(await horizontalOverflow(page), `${tab} tab fits`).toBeLessThanOrEqual(0)
    }

    // The city dossier panel must fit too (overlay on desktop, stacked on mobile).
    await page.getByTestId('city-MIA').click()
    await expect(page.getByTestId('city-panel')).toBeVisible()
    expect(await horizontalOverflow(page), 'city panel fits').toBeLessThanOrEqual(0)
    await page.getByTestId('city-panel-close').click()

    // The core interaction still works at this size, report card included.
    await page.getByTestId('end-quarter').click()
    await expect(page.getByTestId('report-card')).toBeVisible()
    expect(await horizontalOverflow(page), 'report card fits').toBeLessThanOrEqual(0)
    await page.getByTestId('report-card-close').click()
    await expect(page.getByTestId('date')).toHaveText('1960 Q3')

    // The populated menu (save rows, import box open) must fit too.
    await page.reload()
    await expect(page.getByTestId('save-slot-0')).toBeVisible()
    await page.locator('summary', { hasText: 'Import a career' }).click()
    expect(await horizontalOverflow(page), 'populated menu fits').toBeLessThanOrEqual(0)
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
  // Space presented the report card; Esc dismisses it.
  await expect(page.getByTestId('report-card')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('report-card')).toHaveCount(0)

  await page.keyboard.press('2')
  await expect(page.getByTestId('tab-fleet')).toHaveClass(/active/)
  await page.keyboard.press('6')
  await expect(page.getByTestId('tab-report')).toHaveClass(/active/)

  await page.getByTestId('city-MIA').click()
  await expect(page.locator('.city-dot.selected')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(page.locator('.city-dot.selected')).toHaveCount(0)
})

// The honest mobile contract: the primary verb (tapping a city) must work
// with a FINGER, not just a synthetic element click; controls must be
// finger-sized; chrome must not stack on itself; and tall overlays must
// scroll their buttons into reach.
test('mobile: fat-finger taps select cities and the chrome stays usable', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 })
  await page.goto('/')
  await page.getByTestId('seed-input').fill('touch-seed')
  await page.getByTestId('start-jet_age').click()
  await expect(page.getByTestId('date')).toHaveText('1960 Q1')

  // A tap 12px NORTH of Chicago's (sub-pixel) dot — open water on the
  // rendered map — must still select Chicago via nearest-city resolution.
  const dot = await page.getByTestId('city-ORD').boundingBox()
  expect(dot).not.toBeNull()
  await page.mouse.click(dot!.x + dot!.width / 2, dot!.y + dot!.height / 2 - 12)
  await expect(page.getByTestId('city-panel')).toContainText('Chicago')
  await page.getByTestId('city-panel-close').click()

  // Map controls are finger-sized on touch layouts.
  for (const id of ['zoom-in', 'zoom-out', 'zoom-reset']) {
    const box = await page.getByTestId(id).boundingBox()
    expect(box!.width, `${id} width`).toBeGreaterThanOrEqual(40)
    expect(box!.height, `${id} height`).toBeGreaterThanOrEqual(40)
  }

  // The phone map opens on the player's home region rather than the whole
  // world, so the minimap — a second map laid over the first — is not shown
  // at this size at all. Zooming must not conjure it back.
  await page.getByTestId('zoom-in').click()
  await page.getByTestId('zoom-in').click()
  await expect(page.getByTestId('minimap')).toBeHidden()

  // And the map itself is a map, not a strip: it must claim real height.
  const mapBox = await page.getByTestId('map').boundingBox()
  expect(mapBox!.height, 'map height on a phone').toBeGreaterThan(190)
})

test('mobile: the map opens on the home region, with the network on screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByTestId('seed-input').fill('home-view')
  await page.getByTestId('start-jet_age').click()
  await expect(page.getByTestId('date')).toHaveText('1960 Q1')
  // Covering a near-square phone box with a 2.7:1 world would crop 60% of its
  // width — measured, that put Chicago at x = -45. Opening on the home region
  // instead means the cities you actually fly from are on screen.
  const box = await page.getByTestId('map').boundingBox()
  for (const id of ['JFK', 'ORD', 'MIA']) {
    const dot = await page.getByTestId(`city-${id}`).boundingBox()
    expect(dot, `${id} rendered`).not.toBeNull()
    expect(dot!.x, `${id} left of the map's right edge`).toBeLessThan(box!.x + box!.width)
    expect(dot!.x + dot!.width, `${id} right of the map's left edge`).toBeGreaterThan(box!.x)
  }
  // Tapping one still opens its dossier — the pointer maths has to follow the
  // same cover-scaling the render uses.
  await page.getByTestId('city-ORD').click()
  await expect(page.getByTestId('city-panel')).toContainText('Chicago')
})

test('mobile: the game-over card scrolls its buttons into reach', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 })
  await page.goto('/')
  await page.getByTestId('seed-input').fill('gameover-touch')
  await page.getByTestId('start-jet_age').click()
  await expect(page.getByTestId('date')).toHaveText('1960 Q1')
  // An idle airline burns out in a few years — ride it to the overlay.
  await page.evaluate(() => {
    for (let i = 0; i < 40 && window.__harness.getState()!.phase === 'planning'; i++) {
      window.__harness.endQuarter()
    }
  })
  await expect(page.getByTestId('gameover-overlay')).toBeVisible()
  // Playwright refuses to click a target it cannot bring into view — this
  // fails if the card clips its buttons instead of scrolling.
  await page.getByTestId('new-game').click()
  await expect(page.getByTestId('start-jet_age')).toBeVisible()
})
