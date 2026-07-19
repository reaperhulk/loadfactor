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
  // The fourth quarter closes the year: its report card carries the digest.
  await page.getByTestId('end-quarter').click()
  await expect(page.getByTestId('year-review')).toContainText('1960 in review')
  await page.getByTestId('report-card-close').click()
  await expect(page.getByTestId('date')).toHaveText('1961 Q1')
  expect(errors).toEqual([])
})

test('routes open via the city panel plan-route flow with a launch schedule', async ({ page }) => {
  await startGame(page)
  // Routes must touch the network — seed ORD into it via the harness so the
  // click-flow pair (MIA–ORD, whose dots sit clear of neighbors on the
  // projection; JFK is huddled under Toronto) is legal.
  await page.evaluate(() => {
    const snap = window.__harness.getState()!
    const idle = snap.airlines[0]!.fleet.find((ac) => ac.routeId === null)!
    window.__harness.dispatch({ type: 'open_route', from: 'JFK', to: 'ORD', aircraftId: idle.id, frequency: 5 })
  })
  await page.getByTestId('city-MIA').click()
  await expect(page.getByTestId('city-panel')).toBeVisible()
  await page.getByTestId('plan-route').click()
  await page.getByTestId('city-ORD').click()
  // The launch dialog: aircraft + frequency (bounded by distance) + fare.
  await expect(page.getByTestId('route-setup')).toBeVisible()
  await expect(page.getByTestId('route-setup')).toContainText('Sud Caravelle')
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
  await expect(panel).toContainText('Top markets from here')
  // Negotiate for slots straight from the dossier.
  await page.getByTestId('negotiate-spend').fill('1500')
  await page.getByTestId('panel-negotiate').click()
  await expect(page.getByTestId('negotiating-note')).toBeVisible()
  // The pending negotiation also marks the city on the map.
  await expect(page.getByTestId('negotiating-LAX')).toBeVisible()
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
  // …and the report tab leads with the structured results table plus the log.
  await page.getByTestId('tab-report').click()
  await expect(page.getByTestId('report-results')).toContainText('JFK–ORD')
  await expect(page.getByTestId('report')).toContainText('Quarter closed')
  // The finance tab attributes every cost dollar, and the HUD shows the race.
  await page.getByTestId('tab-finance').click()
  await expect(page.getByTestId('cost-structure')).toContainText('Fuel')
  await expect(page.getByTestId('rank')).toContainText('/3')
  const loadFactor = await page.evaluate(
    () => window.__harness.getState()!.airlines[0]!.routes[0]!.lastLoadFactorBp,
  )
  expect(loadFactor).toBeGreaterThan(0)
})

test('opening a route triggers the reward animation and toast', async ({ page }) => {
  await startGame(page)
  // Seed ORD into the network first — a route must touch the HQ or a served
  // city, and the MIA/ORD dots are the ones clear of neighbors to click.
  await page.evaluate(() => {
    const snap = window.__harness.getState()!
    const idle = snap.airlines[0]!.fleet.find((ac) => ac.routeId === null)!
    window.__harness.dispatch({ type: 'open_route', from: 'JFK', to: 'ORD', aircraftId: idle.id, frequency: 5 })
  })
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

test('wheel over the map zooms without scrolling the page', async ({ page }) => {
  // A short viewport forces the page to overflow vertically, so a leaked
  // wheel event would visibly scroll it.
  await page.setViewportSize({ width: 900, height: 460 })
  await startGame(page)
  // The coach mark floats over the map — wheel events on it never reach the
  // SVG listener, so clear it before scrolling.
  await page.getByTestId('coach-dismiss').click()
  const map = page.getByTestId('map')
  const box = (await map.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.wheel(0, -600)
  await page.mouse.wheel(0, -600)
  await page.mouse.wheel(0, -600)
  // The map zoomed (a tier-3 field fades in) and the page did not move.
  await expect(page.getByTestId('city-DOH')).toHaveCount(1)
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
})

test('the opportunities list plans a route in one click', async ({ page }) => {
  await startGame(page)
  await page.getByTestId('tab-routes').click()
  await expect(page.getByTestId('opportunities')).toContainText('JFK–ORD')
  await expect(page.getByTestId('negotiation-targets')).toContainText('Worth negotiating')
  await page.getByTestId('plan-JFK-ORD').click()
  await expect(page.getByTestId('route-setup')).toBeVisible()
  await expect(page.getByTestId('route-setup')).toContainText('Open JFK–ORD')
  await page.getByTestId('route-setup-cancel').click()
  await expect(page.getByTestId('route-setup')).toHaveCount(0)
})

test('airline identity: name, livery, and a custom HQ with derived footholds', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('airline-name').fill('Pan Galactic')
  await page.getByTestId('airline-hq').selectOption({ label: 'Los Angeles (LAX)' })
  await page.getByTestId('livery-4fae62').click()
  await page.getByTestId('seed-input').fill('identity-seed')
  await page.getByTestId('start-jet_age').click()
  await expect(page.getByTestId('date')).toHaveText('1960 Q1')
  // The engine took the identity: name, HQ, and derived nearby footholds.
  const me = await page.evaluate(() => {
    const s = window.__harness.getState()!
    return { name: s.airlines[0]!.name, hq: s.airlines[0]!.hq, slots: s.airlines[0]!.slots }
  })
  expect(me.name).toBe('Pan Galactic')
  expect(me.hq).toBe('LAX')
  expect(Object.keys(me.slots).length).toBe(4) // HQ + three footholds
  // The livery recolors the accent, and the standings sheet knows the name.
  await expect(page.locator('main.game')).toHaveAttribute('style', /--accent/)
  await page.getByTestId('tab-rivals').click()
  await expect(page.getByTestId('standings')).toContainText('Pan Galactic (you)')
  await expect(page.getByTestId('standings')).toContainText('Albion Airways')
  // The identity survives a reload through the save — and the replay viewer
  // rebuilds the career WITH the customization (a custom HQ replayed against
  // the authored world would silently diverge).
  await page.reload()
  await page.getByTestId('watch-save-replay').click()
  await expect(page.getByTestId('replay-viewer')).toBeVisible()
  await expect(page.locator('.standings')).toContainText('Pan Galactic')
  await page.getByTestId('replay-exit').click()
  await page.getByTestId('continue-save').click()
  const resumed = await page.evaluate(() => window.__harness.getState()!.airlines[0]!.name)
  expect(resumed).toBe('Pan Galactic')
})

test('the globe projection renders, culls the far side, and spins', async ({ page }) => {
  await startGame(page)
  await expect(page.getByTestId('city-HND')).toHaveCount(1) // flat: whole world at once
  await page.getByTestId('map-projection').click()
  await expect(page.getByTestId('globe-land')).toBeVisible()
  await expect(page.getByTestId('city-JFK')).toHaveCount(1) // the Atlantic side faces us
  await expect(page.getByTestId('city-HND')).toHaveCount(0) // Tokyo is behind the globe
  // Drag westward to spin Asia into view.
  const box = (await page.getByTestId('map').boundingBox())!
  await page.mouse.move(box.x + box.width * 0.65, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2, { steps: 10 })
  await page.mouse.up()
  await expect(page.getByTestId('city-HND')).toHaveCount(1)
  // Back to the flat overview.
  await page.getByTestId('map-projection').click()
  await expect(page.getByTestId('globe-land')).toHaveCount(0)
  await expect(page.getByTestId('city-JFK')).toHaveCount(1)
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
    window.__harness.endQuarter()
    window.__harness.endQuarter()
  })
  // Route dossier from the routes table.
  await page.getByTestId('tab-routes').click()
  await page.getByTestId('inspect-JFK-ORD').click()
  await expect(page.getByTestId('route-dossier')).toBeVisible()
  await expect(page.getByTestId('route-dossier')).toContainText('The pair')
  await expect(page.getByTestId('route-dossier')).toContainText('rt/wk')
  // The fare what-if table replays the share math at every posture.
  await page.getByTestId('fare-whatif').locator('summary').click()
  await expect(page.getByTestId('fare-whatif')).toContainText('est. revenue/wk')
  await expect(page.getByTestId('fare-whatif')).toContainText('(now)')
  // Adding an idle plane from the dossier grows the schedule in one pick:
  // assign + frequency bump together (a bare assign would fly nothing extra).
  await expect(page.getByTestId('dossier-frequency')).toContainText('5/')
  const before = await page.getByTestId('dossier-frequency').innerText()
  await page.getByTestId('dossier-add-aircraft').selectOption({ index: 1 })
  await expect(page.getByTestId('dossier-frequency')).not.toHaveText(before)
  await expect(page.getByTestId('dossier-add-aircraft')).toHaveCount(0) // no idle aircraft left
  await page.getByTestId('route-dossier-close').click()
  await expect(page.getByTestId('route-dossier')).toHaveCount(0)
  // Rivals intel tab.
  await page.getByTestId('tab-rivals').click()
  await expect(page.getByTestId('rivals-panel')).toContainText('Albion Airways')
  await expect(page.getByTestId('rivals-panel')).toContainText('The race')
  // The race chart switches metrics and the standings sheet lines everyone up.
  await page.getByTestId('race-metric-pax').click()
  await expect(page.getByTestId('standings')).toContainText('Meridian Air (you)')
  // Rival networks draw on the map (rivals expanded during the two resolved
  // quarters) and the toggle hides them.
  await expect(page.locator('.route-rival').first()).toBeVisible()
  await page.getByTestId('toggle-rivals').click()
  await expect(page.locator('.route-rival')).toHaveCount(0)
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
  await expect(page.getByTestId('shop-table')).toContainText('Sud Caravelle')
  await page.getByTestId('shop-route').selectOption({ label: 'JFK–ORD' })
  await expect(page.getByTestId('shop-table')).toContainText('Est. cost/q here')
  await expect(page.getByTestId('shop-table')).toContainText('Seats/wk here')
  // Ordering from the shop deducts cash.
  await page.getByTestId('order-caravelle').click()
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
  await page.getByTestId('lease-caravelle').click()
  await expect(page.getByTestId('cash')).toContainText('$18.0M')
  await page.evaluate(() => window.__harness.endQuarter())
  await expect(page.locator('text=(leased)')).toBeVisible()
  // The used market rotated in offers; the fuel hedge is armable in finance.
  await expect(page.getByTestId('used-market')).toBeVisible()
  await page.getByTestId('tab-finance').click()
  await page.getByTestId('hedge-4').click()
  await expect(page.getByTestId('hedge-panel')).toContainText('Fuel hedged')
  // Brand: setting a marketing level sticks in the engine state.
  await page.getByTestId('marketing-2').click()
  await expect(page.getByTestId('marketing-2')).toBeDisabled()
  const marketing = await page.evaluate(() => window.__harness.getState()!.airlines[0]!.marketing)
  expect(marketing).toBe(2)
})

test('an aircraft order cancels for the partial refund', async ({ page }) => {
  await startGame(page)
  await page.getByTestId('tab-fleet').click()
  const cashBefore = await page.evaluate(() => window.__harness.getState()!.airlines[0]!.cash)
  await page.getByTestId('order-cv240').click()
  await expect(page.locator('text=on order')).toBeVisible()
  const cashAfterOrder = await page.evaluate(() => window.__harness.getState()!.airlines[0]!.cash)
  const price = cashBefore - cashAfterOrder
  expect(price).toBeGreaterThan(0)
  // Cancelling is a two-step ConfirmButton: arm, then confirm.
  const cancel = page.locator('[data-testid^="cancel-order-"]')
  await expect(cancel).toContainText('back') // the refund is quoted up front
  await cancel.click()
  await expect(cancel).toHaveText('sure?')
  await cancel.click()
  await expect(page.locator('text=on order')).toHaveCount(0)
  // 80% of the purchase price comes back (ORDER_CANCEL_REFUND_BP).
  const cashFinal = await page.evaluate(() => window.__harness.getState()!.airlines[0]!.cash)
  expect(cashFinal).toBe(cashAfterOrder + Math.floor(price * 0.8))
})
