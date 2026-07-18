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

// Ending a quarter via the UI presents the report card; dismiss it so the
// next interaction isn't behind the overlay.
async function endQuarterUI(page: Page): Promise<void> {
  await page.getByTestId('end-quarter').click()
  await page.getByTestId('report-card-close').click()
}

test('scenario starts and quarters advance deterministically', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(String(err)))
  await startGame(page)
  await endQuarterUI(page)
  await expect(page.getByTestId('date')).toHaveText('1960 Q2')
  await endQuarterUI(page)
  await endQuarterUI(page)
  await endQuarterUI(page)
  await expect(page.getByTestId('date')).toHaveText('1961 Q1')
  expect(errors).toEqual([])
})

test('routes open via the city panel plan-route flow with a launch schedule', async ({ page }) => {
  await startGame(page)
  // MIA and ORD are slotted at game start and their dots sit clear of
  // neighbors on the projection (JFK is huddled under Toronto).
  await page.getByTestId('city-MIA').click()
  await expect(page.getByTestId('city-panel')).toBeVisible()
  await page.getByTestId('plan-route').click()
  await page.getByTestId('city-ORD').click()
  // The launch dialog: aircraft + frequency (bounded by distance) + fare.
  await expect(page.getByTestId('route-setup')).toBeVisible()
  await expect(page.getByTestId('route-setup')).toContainText('Meridian 80')
  await expect(page.getByTestId('route-setup-freq')).toContainText('rt/wk')
  await page.getByTestId('route-setup-confirm').click()
  await expect(page.getByTestId('route-setup')).toHaveCount(0)
  await page.getByTestId('tab-routes').click()
  await expect(page.getByTestId('route-MIA-ORD')).toBeVisible()
})

test('the city panel shows stats and negotiates in context', async ({ page }) => {
  await startGame(page)
  await page.getByTestId('city-LAX').click()
  const panel = page.getByTestId('city-panel')
  await expect(panel).toBeVisible()
  await expect(panel).toContainText('Los Angeles')
  await expect(page.getByTestId('city-slots')).toContainText('pool 30')
  await expect(panel).toContainText('Top demand from here')
  // Negotiate for slots straight from the dossier.
  await page.getByTestId('negotiate-spend').fill('1500')
  await page.getByTestId('panel-negotiate').click()
  await expect(page.getByTestId('negotiating-note')).toBeVisible()
  // Rejected commands surface as toasts (no free slots at an unheld city).
  await page.getByTestId('city-panel-close').click()
  await expect(page.getByTestId('city-panel')).toHaveCount(0)
})

test('the quarterly report reflects the resolved quarter', async ({ page }) => {
  await startGame(page)
  // Open a route and assign the starter fleet through the harness (the same
  // command surface the UI uses), then resolve a quarter in the UI.
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
  })
  // Serving a route puts an ambient plane on the map.
  await expect(page.locator('[data-testid^="plane-"]')).toHaveCount(1)
  // Ending the quarter presents the report card with the P&L…
  await page.getByTestId('end-quarter').click()
  await expect(page.getByTestId('report-card')).toBeVisible()
  await expect(page.getByTestId('report-card')).toContainText('Profit')
  await expect(page.getByTestId('report-card')).toContainText('Best route')
  await page.getByTestId('report-card-close').click()
  await expect(page.getByTestId('report-card')).toHaveCount(0)
  // …and the report tab keeps the full log.
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
  await page.getByTestId('plan-route').click()
  await page.getByTestId('city-ORD').click()
  await page.getByTestId('route-setup-confirm').click()
  await expect(page.getByTestId('toasts')).toContainText('Route opened: MIA – ORD')
  await expect(page.getByTestId('route-line-new')).toHaveCount(1)
  // The reward is transient: the draw-in class clears on the next action.
  await page.getByTestId('end-quarter').click()
  await expect(page.getByTestId('route-line-new')).toHaveCount(0)
})

test('zoom reveals small cities that are hidden at world view', async ({ page }) => {
  await startGame(page)
  // Doha is a tier-3 field with no player stake: invisible at world zoom.
  await expect(page.getByTestId('city-DOH')).toHaveCount(0)
  await page.getByTestId('zoom-in').click()
  await page.getByTestId('zoom-in').click()
  await page.getByTestId('zoom-in').click()
  await expect(page.getByTestId('city-DOH')).toHaveCount(1)
  await page.getByTestId('zoom-reset').click()
  await expect(page.getByTestId('city-DOH')).toHaveCount(0)
})

test('the route dossier and rivals intel expose the numbers', async ({ page }) => {
  await startGame(page)
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
    window.__harness.endQuarter()
    window.__harness.endQuarter()
  })
  // Route dossier from the routes table.
  await page.getByTestId('tab-routes').click()
  await page.getByTestId('inspect-JFK-ORD').click()
  await expect(page.getByTestId('route-dossier')).toBeVisible()
  await expect(page.getByTestId('route-dossier')).toContainText('The pair')
  await expect(page.getByTestId('route-dossier')).toContainText('rt/wk')
  await page.getByTestId('route-dossier-close').click()
  await expect(page.getByTestId('route-dossier')).toHaveCount(0)
  // Rivals intel tab.
  await page.getByTestId('tab-rivals').click()
  await expect(page.getByTestId('rivals-panel')).toContainText('Albion Airways')
  await expect(page.getByTestId('rivals-panel')).toContainText('net worth by quarter')
})

test('the shop estimates per-route economics, coach marks guide, mute persists', async ({ page }) => {
  await startGame(page)
  // Coach mark points at the first move and is dismissable forever.
  await expect(page.getByTestId('coach')).toContainText('Open route from here')
  await page.getByTestId('coach-dismiss').click()
  await expect(page.getByTestId('coach')).toHaveCount(0)

  await page.evaluate(() => {
    {
      const snap = window.__harness.getState()!
      const idle = snap.airlines[0]!.fleet.find((ac) => ac.routeId === null)!
      window.__harness.dispatch({ type: 'open_route', from: 'JFK', to: 'ORD', aircraftId: idle.id, frequency: 5 })
    }
  })
  await page.getByTestId('tab-fleet').click()
  await expect(page.getByTestId('shop-table')).toContainText('Meridian 80')
  await page.getByTestId('shop-route').selectOption({ label: 'JFK–ORD' })
  await expect(page.getByTestId('shop-table')).toContainText('Est. cost/q here')
  await expect(page.getByTestId('shop-table')).toContainText('Seats/wk here')
  // Ordering from the shop deducts cash.
  await page.getByTestId('order-meridian80').click()
  await expect(page.getByTestId('cash')).toContainText('$11.2M')

  // Mute toggle flips and persists across reload.
  await page.getByTestId('mute-toggle').click()
  await expect(page.getByTestId('mute-toggle')).toHaveAttribute('aria-label', 'unmute sounds')
  await page.reload()
  await page.getByTestId('continue-save').click()
  await expect(page.getByTestId('mute-toggle')).toHaveAttribute('aria-label', 'unmute sounds')
  // The dismissed coach never returns either.
  await expect(page.getByTestId('coach')).toHaveCount(0)
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
    {
      const snap = window.__harness.getState()!
      const idle = snap.airlines[0]!.fleet.find((ac) => ac.routeId === null)!
      window.__harness.dispatch({ type: 'open_route', from: 'JFK', to: 'MIA', aircraftId: idle.id, frequency: 5 })
    }
    window.__harness.endQuarter()
    window.__harness.endQuarter()
    return JSON.stringify(window.__harness.getState())
  })
  const second = await page.evaluate(() => {
    window.__harness.reset()
    window.__harness.newGame('jet_age', 'e2e-seed')
    {
      const snap = window.__harness.getState()!
      const idle = snap.airlines[0]!.fleet.find((ac) => ac.routeId === null)!
      window.__harness.dispatch({ type: 'open_route', from: 'JFK', to: 'MIA', aircraftId: idle.id, frequency: 5 })
    }
    window.__harness.endQuarter()
    window.__harness.endQuarter()
    return JSON.stringify(window.__harness.getState())
  })
  expect(second).toBe(first)
})

test('M2 tools: daily challenge, leasing, used market, fuel hedge', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('start-daily').click()
  await expect(page.getByTestId('date')).toHaveText('1960 Q1')
  // Lease from the shop: no capex, delivers next quarter.
  await page.getByTestId('tab-fleet').click()
  await page.getByTestId('lease-meridian80').click()
  await expect(page.getByTestId('cash')).toContainText('$18.0M')
  await page.evaluate(() => window.__harness.endQuarter())
  await expect(page.locator('text=(leased)')).toBeVisible()
  // The used market rotated in offers; the fuel hedge is armable in finance.
  await expect(page.getByTestId('used-market')).toBeVisible()
  await page.getByTestId('tab-finance').click()
  await page.getByTestId('hedge-4').click()
  await expect(page.getByTestId('hedge-panel')).toContainText('Fuel hedged')
})
