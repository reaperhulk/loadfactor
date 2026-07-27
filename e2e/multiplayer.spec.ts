import { expect, test, type Page } from '@playwright/test'

// MP0 + MP1 (PLAN.md §10): hot-seat at one device, and the async duel where
// the link IS the game. No server anywhere in these tests — that is the point.

async function startHotseat(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByTestId('seed-input').fill('hotseat-e2e')
  await page.getByTestId('players-select').selectOption('2')
  await page.getByTestId('start-jet_age').click()
  await expect(page.getByTestId('date')).toHaveText('1960 Q1')
}

test('hot-seat: two players share a device, planning in rotation', async ({ page }) => {
  await startHotseat(page)

  // Quarter 1: seat 0 plans first. End Quarter is NOT available — the last
  // planner owns it — only the pass-device button is.
  await expect(page.getByTestId('active-seat')).toBeVisible()
  const firstAirline = await page.getByTestId('active-seat').textContent()
  await expect(page.getByTestId('end-quarter')).toHaveCount(0)
  await page.getByTestId('pass-seat').click()

  // Seat 1's sitting: their airline in the chip, and their commands land on
  // THEIR airline.
  const secondAirline = await page.getByTestId('active-seat').textContent()
  expect(secondAirline).not.toBe(firstAirline)
  await page.evaluate(() => {
    const s = window.__harness.getState()!
    const me = s.airlines[1]!
    const idle = me.fleet.find((a) => a.routeId === null)!
    // A destination the airline can actually use: one of its own slot
    // holdings, so the open is valid rather than rejected.
    const to = Object.keys(me.slots)
      .sort()
      .find((c) => c !== me.hq && me.slots[c]! > 0)!
    window.__harness.dispatch({ type: 'open_route', from: me.hq, to, aircraftId: idle.id, frequency: 4 })
  })
  const routes = await page.evaluate(() => ({
    p0: window.__harness.getState()!.airlines[0]!.routes.length,
    p1: window.__harness.getState()!.airlines[1]!.routes.length,
  }))
  expect(routes.p1, "seat 1's command moved seat 1's airline").toBe(1)
  expect(routes.p0).toBe(0)

  // The last planner resolves. Next quarter the rotation flips: seat 1 first.
  await page.getByTestId('end-quarter').click()
  await page.getByTestId('report-card-close').click()
  await expect(page.getByTestId('date')).toHaveText('1960 Q2')
  await expect(page.getByTestId('active-seat')).toHaveText(secondAirline!)

  // Space must not resolve the quarter from the first planner's seat.
  await page.keyboard.press(' ')
  await expect(page.getByTestId('date')).toHaveText('1960 Q2')
})

test('hot-seat: the game survives a reload as a v2 save', async ({ page }) => {
  await startHotseat(page)
  await page.getByTestId('pass-seat').click()
  await page.getByTestId('end-quarter').click()
  await page.getByTestId('report-card-close').click()
  await expect(page.getByTestId('date')).toHaveText('1960 Q2')

  await page.reload()
  await expect(page.getByText('· hot-seat')).toBeVisible()
  await page.getByTestId('continue-save').click()
  await expect(page.getByTestId('date')).toHaveText('1960 Q2')
  await expect(page.getByTestId('active-seat')).toBeVisible()
})

test('link duel: two browsers exchange turn links and stay in lockstep', async ({ browser }) => {
  test.slow()
  const ctxA = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })
  const ctxB = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })
  const a = await ctxA.newPage()
  const b = await ctxB.newPage()

  // Alice creates the duel and opens quarter 1: plans, then sends.
  await a.goto('/')
  await a.getByTestId('seed-input').fill('duel-e2e')
  await a.getByTestId('duel-jet_age').click()
  await expect(a.getByTestId('date')).toHaveText('1960 Q1')
  await a.evaluate(() => {
    const s = window.__harness.getState()!
    const me = s.airlines[0]!
    const idle = me.fleet.find((x) => x.routeId === null)!
    window.__harness.dispatch({ type: 'open_route', from: me.hq, to: 'ORD', aircraftId: idle.id, frequency: 4 })
  })
  await a.getByTestId('mp-send').click()
  await expect(a.getByTestId('mp-waiting')).toBeVisible()
  const invite = await a.evaluate(() => navigator.clipboard.readText())
  expect(invite).toContain('#mpturn=')

  // Bob opens the invite: he joins as seat 1 with Alice's opening applied,
  // and it is his sitting — he closes quarter 1.
  await b.goto(invite)
  await expect(b.getByTestId('date')).toHaveText('1960 Q1')
  await b.evaluate(() => {
    const s = window.__harness.getState()!
    const me = s.airlines[1]!
    const idle = me.fleet.find((x) => x.routeId === null)
    const to = Object.keys(me.slots)
      .sort()
      .find((c) => c !== me.hq && me.slots[c]! > 0)
    if (idle && to) {
      window.__harness.dispatch({ type: 'open_route', from: me.hq, to, aircraftId: idle.id, frequency: 4 })
    }
  })
  await b.getByTestId('end-quarter').click()
  await b.getByTestId('report-card-close').click()
  await expect(b.getByTestId('date')).toHaveText('1960 Q2')
  // Alice's opening really reached Bob's world.
  expect(await b.evaluate(() => window.__harness.getState()!.airlines[0]!.routes.length)).toBe(1)
  await b.getByTestId('mp-send').click()
  const reply = await b.evaluate(() => navigator.clipboard.readText())

  // Alice opens the reply: quarter 1 resolves identically on her side.
  await a.goto(reply)
  await expect(a.getByTestId('date')).toHaveText('1960 Q2')
  const [worldA, worldB] = await Promise.all([
    a.evaluate(() => JSON.stringify(window.__harness.getState())),
    b.evaluate(() => JSON.stringify(window.__harness.getState())),
  ])
  expect(worldA, 'both clients hold the identical world').toBe(worldB)

  // A stale link is refused with a reason, not applied twice.
  await a.goto(reply)
  await expect(a.getByTestId('mp-notice')).toContainText('stale')

  await ctxA.close()
  await ctxB.close()
})
