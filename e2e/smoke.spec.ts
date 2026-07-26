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
  // Planning mode draws the idle-fleet reach ring around the origin.
  await expect(page.getByTestId('range-ring')).toBeVisible()
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

// Which build is this? The deployed page and the repo are otherwise
// impossible to line up by eye, so the commit is stamped into the bundle and
// shown in the footer of both the menu and the game.
test('the running build says which commit it is', async ({ page }) => {
  await page.goto('/')
  const stamp = page.getByTestId('build-stamp')
  await expect(stamp, 'the menu carries it too — that is where you land').toBeVisible()
  // A short SHA, or "dev" when built without git. A trailing + means the
  // build came from a dirty tree, which is exactly what you want to know.
  const menuText = (await stamp.textContent())!.trim()
  expect(menuText).toMatch(/^([0-9a-f]{7}\+?|dev)$/)
  await expect(stamp).toHaveAttribute('title', new RegExp(`build ${menuText.replace('+', '\\+')} · `))

  await startGame(page)
  const inGame = page.getByTestId('build-stamp')
  await expect(inGame).toBeVisible()
  expect((await inGame.textContent())!.trim()).toBe(menuText)
})

test('every scenario starts from its menu card', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('seed-input').fill('menu-seed')
  // Later eras sit behind the unlock chain — an invitation, not a wall:
  // the locked Start arms a confirm, and a second click goes anyway.
  await expect(page.getByTestId('locked-open_skies')).toBeVisible()
  await page.getByTestId('start-open_skies').click()
  await expect(page.getByTestId('start-open_skies')).toContainText('start anyway')
  await page.getByTestId('start-open_skies').click()
  await expect(page.getByTestId('date')).toHaveText('1995 Q1')
  // The attention strip nudges toward the parked starter fleet.
  await expect(page.getByTestId('attention-strip')).toContainText('idle plane')
  // The fifth era sits at the end of the same chain and starts the same way.
  await page.goto('/')
  await expect(page.getByTestId('locked-lcc_wars')).toBeVisible()
  await page.getByTestId('start-lcc_wars').click()
  await page.getByTestId('start-lcc_wars').click()
  await expect(page.getByTestId('date')).toHaveText('2005 Q1')
})

test('a challenge link opens the same world for whoever follows it', async ({ page }) => {
  // With target/by the link is a duel: the card names the number to beat.
  await page.goto('/?scenario=open_skies&seed=challenge-seed&target=250000&by=Ghost%20Air')
  await expect(page.getByTestId('challenge-card')).toContainText('Open Skies')
  await expect(page.getByTestId('duel-target')).toContainText('Ghost Air')
  await expect(page.getByTestId('duel-target')).toContainText('$250.0M')
  await page.getByTestId('start-challenge').click()
  await expect(page.getByTestId('date')).toHaveText('1995 Q1')
  const seed = await page.evaluate(() => window.__harness.getState()!.seed)
  expect(seed).toBe('challenge-seed')
  // The challenger's ghost haunts the race chart once there is a race to draw.
  await page.evaluate(() => {
    window.__harness.endQuarter()
    window.__harness.endQuarter()
  })
  await page.getByTestId('tab-rivals').click()
  await expect(page.getByTestId('race-target')).toBeVisible()
  await expect(page.getByTestId('rivals-panel')).toContainText('Ghost Air')
  // The in-game share button hands out a link that carries YOUR net worth.
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.getByTestId('share-challenge').click()
  const link = await page.evaluate(() => navigator.clipboard.readText())
  expect(link).toContain('scenario=open_skies')
  expect(link).toContain('seed=challenge-seed')
  expect(link).toMatch(/target=\d+/)
  expect(link).toContain('by=')
})

test('the city panel shows stats and joins the slot queue in context', async ({ page }) => {
  await startGame(page)
  await page.getByTestId('city-LAX').click()
  const panel = page.getByTestId('city-panel')
  await expect(panel).toBeVisible()
  await expect(panel).toContainText('Los Angeles')
  await expect(page.getByTestId('city-slots')).toContainText('pool 10')
  await expect(panel).toContainText('Top markets from here')
  // The authority's building programme is published years ahead — a full
  // airport is a date, not a wall.
  await expect(page.getByTestId('city-expansion')).toContainText(/opens in \d+q \(\+\d+ slots\)/)
  // Take a place in the line straight from the dossier.
  await page.getByTestId('panel-request-slots').click()
  await expect(page.getByTestId('queued-note')).toContainText('#1 in line')
  await expect(page.getByTestId('city-slot-queue')).toContainText('You')
  // A pending request also marks the city on the map.
  await expect(page.getByTestId('negotiating-LAX')).toBeVisible()
  // Leaving the list refunds in full: the cost of a queue is the quarters.
  const before = await page.evaluate(() => window.__harness.getState()!.airlines[0]!.cash)
  await page.getByTestId('panel-cancel-request').click()
  const after = await page.evaluate(() => window.__harness.getState()!.airlines[0]!.cash)
  expect(after).toBeGreaterThan(before)
  await expect(page.getByTestId('panel-request-slots')).toBeVisible()
  await page.getByTestId('city-panel-close').click()
  await expect(page.getByTestId('city-panel')).toHaveCount(0)
})

test('slots are rented: unused capacity bills, and handing it back stops the bill', async ({ page }) => {
  await startGame(page)
  // The airports board prices every position and publishes every programme.
  await page.getByTestId('tab-airports').click()
  const board = page.getByTestId('airports-panel')
  await expect(board).toContainText('Rent/q')
  await expect(board).toContainText('Next build')
  // A foothold city with no routes is pure rent — hand it back and the
  // quarterly slot bill falls.
  const idleCity = await page.evaluate(() => {
    const s = window.__harness.getState()!
    const me = s.airlines[0]!
    const touched = new Set(me.routes.flatMap((r) => [r.from, r.to]))
    return Object.keys(me.slots).sort().find((c) => c !== me.hq && !touched.has(c))!
  })
  // Handing capacity back is a two-step confirm: the slots go to the pool and
  // buying them again costs the fee and the wait, so one stray click must not
  // do it.
  const release = page.getByTestId(`release-${idleCity}`)
  await release.click()
  await expect(release).toContainText('give them up?')
  expect(
    await page.evaluate((c) => window.__harness.getState()!.airlines[0]!.slots[c] ?? 0, idleCity),
    'still held after the first click',
  ).toBeGreaterThan(0)
  await release.click()
  expect(
    await page.evaluate((c) => window.__harness.getState()!.airlines[0]!.slots[c] ?? 0, idleCity),
  ).toBe(0)
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
  // Unassign one plane, then the bulk button puts the idle fleet back to work.
  await page.evaluate(() => {
    const s = window.__harness.getState()!
    window.__harness.dispatch({ type: 'assign_aircraft', aircraftId: s.airlines[0]!.fleet[0]!.id, routeId: null })
  })
  await page.getByTestId('tab-fleet').click()
  await page.getByTestId('assign-all-idle').click()
  const idleLeft = await page.evaluate(
    () => window.__harness.getState()!.airlines[0]!.fleet.filter((a) => a.routeId === null).length,
  )
  expect(idleLeft).toBe(0)
  await page.getByTestId('tab-routes').click()
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
  await expect(page.getByTestId('rank')).toContainText(/#\d+\/\d+/)
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
  // A fresh browser has no achievements — the very first route is a career
  // milestone and earns the gold unlock toast alongside the route reward.
  await expect(page.getByTestId('toasts')).toContainText('Achievement unlocked — First flight')
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
  await expect(page.getByTestId('negotiation-targets')).toContainText('Worth queueing for')
  await page.getByTestId('plan-JFK-ORD').click()
  await expect(page.getByTestId('route-setup')).toBeVisible()
  await expect(page.getByTestId('route-setup')).toContainText('Open JFK–ORD')
  await page.getByTestId('route-setup-cancel').click()
  await expect(page.getByTestId('route-setup')).toHaveCount(0)
})

test('previews report bands, opportunities carry risks, rival intent is visible', async ({ page }) => {
  await startGame(page)
  await page.evaluate(() => {
    const snap = window.__harness.getState()!
    const idle = snap.airlines[0]!.fleet.find((ac) => ac.routeId === null)!
    window.__harness.dispatch({ type: 'open_route', from: 'JFK', to: 'ORD', aircraftId: idle.id, frequency: 5 })
    window.__harness.endQuarter()
  })

  // The what-if table quotes ranges, and says out loud whether the spread is
  // wide enough to hide the answer — it never silently crowns a winner that
  // demand noise could overturn.
  await page.getByTestId('tab-routes').click()
  await page.getByTestId('inspect-JFK-ORD').click()
  await page.getByTestId('fare-whatif').locator('summary').click()
  await expect(page.getByTestId('fare-whatif').locator('tbody')).toContainText(/[\d,]+–[\d,]+/)
  await expect(page.getByTestId('fare-whatif-verdict')).toContainText(/Clear call|Too close to call/)
  await page.getByTestId('route-dossier-close').click()

  // Every opportunity row states what the headline market number omits.
  await expect(page.getByTestId('opportunities').locator('[data-testid^="risk-"]').first()).not.toBeEmpty()

  // Rival slot campaigns are announced a quarter ahead, so during planning
  // there is always someone's declared target to find. The seed is fixed, so
  // this either always finds one or always doesn't — the assertion is a real
  // claim about rival behavior, not a coin flip.
  const target = await page.evaluate(() => {
    for (let q = 0; q < 8; q++) {
      const s = window.__harness.getState()!
      for (const a of s.airlines) {
        if (a.id === 0 || a.bankrupt || a.slotInterest === undefined) continue
        return { city: a.slotInterest, name: a.name }
      }
      window.__harness.endQuarter()
    }
    return null
  })
  expect(target).not.toBeNull()
  // The map rings the courted airport wherever that airport is drawn — small
  // fields only appear once zoomed in, so check the ring on a city that is on
  // screen at world view, then open its panel for the named warning.
  const ring = page.locator('[data-testid^="rival-negotiating-"]').first()
  await expect(ring).toHaveCount(1)
  const ringed = (await ring.getAttribute('data-testid'))!.replace('rival-negotiating-', '')
  await page.getByTestId(`city-${ringed}`).click()
  await expect(page.getByTestId('rival-negotiating-note')).toContainText('announced a campaign')
})

test('the books open: per-route economics, network totals, filters, head-to-head', async ({ page }) => {
  await startGame(page)
  await page.evaluate(() => {
    for (const to of ['ORD', 'MIA', 'YYZ']) {
      const me = window.__harness.getState()!.airlines[0]!
      const idle = me.fleet.find((ac) => ac.routeId === null)
      if (!idle) break
      window.__harness.dispatch({ type: 'open_route', from: me.hq, to, aircraftId: idle.id, frequency: 6 })
    }
    for (let q = 0; q < 4; q++) window.__harness.endQuarter()
  })
  await page.getByTestId('tab-routes').click()

  // Every route carries its own unit economics, not just a P&L.
  const routes = page.getByTestId('routes-panel-table').or(page.locator('table').first())
  await expect(routes).toContainText('Pax/q')
  await expect(routes).toContainText('Yield')
  await expect(routes).toContainText('Cost/seat')

  // The totals row aggregates what is on screen, and its load factor is a
  // real percentage — quarterly pax over quarterly seats, not a unit mix-up.
  const totals = page.getByTestId('routes-totals')
  await expect(totals).toContainText('Network')
  const loadText = (await totals.innerText()).match(/(\d+)%/)
  expect(Number(loadText?.[1])).toBeGreaterThan(0)
  expect(Number(loadText?.[1])).toBeLessThanOrEqual(100)

  // Filters narrow the table AND the totals with it.
  const before = await page.locator('[data-testid^="route-JFK-"], [data-testid^="route-MIA-"]').count()
  await page.getByTestId('route-filter-contested').click()
  await expect(page.getByTestId('routes-totals')).toContainText('shown')
  await page.getByTestId('route-filter-all').click()
  await page.getByTestId('route-search').fill('ORD')
  const filtered = await page.locator('tbody tr[data-testid^="route-"]').count()
  expect(filtered).toBeLessThan(before + 1)
  await page.getByTestId('route-search').fill('')

  // Unit economics on the finance tab: what a seat costs against what a
  // passenger pays.
  await page.getByTestId('tab-finance').click()
  await expect(page.getByTestId('unit-economics')).toContainText('Revenue / pax')
  await expect(page.getByTestId('unit-economics')).toContainText('Cost / seat')
  await page.getByTestId('quarter-ledger').locator('summary').click()
  await expect(page.getByTestId('quarter-ledger')).toContainText('net worth')

  // Competitor intelligence: the standings say who is bigger, head-to-head
  // says who is taking your passengers.
  await page.getByTestId('tab-rivals').click()
  const h2h = page.getByTestId('head-to-head').or(page.getByTestId('head-to-head-empty'))
  await expect(h2h).toBeVisible()
})

test('the quarter lands as a headline, and the era colours the whole shell', async ({ page }) => {
  await startGame(page)
  // 1960s: the shell wears the era, not just the map.
  await expect(page.locator('main.game')).toHaveClass(/era-1960/)
  // Fly something first — a quarter with no routes has no margin to report.
  await page.evaluate(() => {
    const me = window.__harness.getState()!.airlines[0]!
    const idle = me.fleet.find((ac) => ac.routeId === null)!
    window.__harness.dispatch({ type: 'open_route', from: me.hq, to: 'ORD', aircraftId: idle.id, frequency: 6 })
    window.__harness.endQuarter()
  })
  await page.getByTestId('end-quarter').click()
  // The report leads with the quarter's result at poster size, with its
  // margin and direction — the ledger is the detail underneath it.
  const hero = page.getByTestId('report-hero')
  await expect(hero).toBeVisible()
  await expect(hero).toContainText(/profit|loss/)
  await expect(hero).toContainText('margin')
  await expect(page.getByTestId('report-card')).toContainText('Revenue')
  await page.getByTestId('report-card-close').click()

  // A later era is a different palette on the same screen.
  await page.goto('/')
  await page.getByTestId('seed-input').fill('era-seed')
  await page.getByTestId('start-lcc_wars').click()
  await page.getByTestId('start-lcc_wars').click()
  await expect(page.locator('main.game')).toHaveClass(/era-2000/)
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

test('every zoom eases — buttons and double-click, flat map and globe', async ({ page }) => {
  await startGame(page)
  // Sample a geometry attribute once per frame while the zoom runs. A step
  // that lands in one frame yields two distinct values; an eased one yields
  // a dozen. Continuous inputs (wheel, pinch) always looked smooth because
  // they arrive as many small deltas — the discrete steps did not.
  // Sample everything the zoom can live in: the viewBox, the pan group's
  // transform (where an eased step now runs, to keep React out of the frame
  // loop) and the globe's radius. The test is about the zoom taking many
  // frames, not about which attribute carries it.
  const frames = () =>
    page.evaluate(
      () =>
        new Promise<string[]>((res) => {
          const out: string[] = []
          let n = 0
          const tick = () => {
            const vb = document.querySelector('svg.map')?.getAttribute('viewBox') ?? ''
            const tf = (document.querySelector('.map-layer') as HTMLElement | null)?.style.transform ?? ''
            const r = document.querySelector('.globe-disc')?.getAttribute('r') ?? ''
            out.push(`${vb}|${tf}|${r}`)
            if (++n < 20) requestAnimationFrame(tick)
            else res(out)
          }
          requestAnimationFrame(tick)
        }),
    )

  const centreOfMap = async () => {
    const b = (await page.getByTestId('map').boundingBox())!
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
  }

  let collect = frames()
  await page.getByTestId('zoom-in').click()
  expect(new Set(await collect).size, 'flat zoom button eases').toBeGreaterThan(5)

  await page.getByTestId('zoom-reset').click()
  await page.waitForTimeout(400)
  collect = frames()
  const c = await centreOfMap()
  await page.mouse.dblclick(c.x, c.y)
  expect(new Set(await collect).size, 'flat double-click eases').toBeGreaterThan(5)

  await page.getByTestId('map-projection').click()
  await page.waitForTimeout(400)
  collect = frames()
  await page.getByTestId('zoom-in').click()
  expect(new Set(await collect).size, 'globe zoom button eases').toBeGreaterThan(5)

  await page.waitForTimeout(400)
  collect = frames()
  const g = await centreOfMap()
  await page.mouse.dblclick(g.x, g.y)
  expect(new Set(await collect).size, 'globe double-click eases').toBeGreaterThan(5)
})

// A touch drag has to move the map WHILE the finger moves — and it has to do
// it without touching the viewBox, which is what made this unusable on
// WebKit. So this samples per frame through the gesture rather than checking
// where the map ended up: a map that catches up on release passes an
// end-state assertion and fails a player.
test.describe('touch', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } })

  test('the map pans with the finger, without rewriting the viewBox', async ({ page, context }) => {
    await startGame(page)
    const box = (await page.getByTestId('map').boundingBox())!

    // Sample where the world actually IS on screen, not how it got there: a
    // city's own client rect, which folds the layer transform and the viewBox
    // together. Alongside it, count every mutation of the SVG — the whole
    // point of the layer is that a drag does not touch the document.
    await page.evaluate(() => {
      const w = window as unknown as { __f: number[]; __mut: number }
      w.__f = []
      w.__mut = 0
      // Callbacks, not records: one React commit is one callback however many
      // nodes it touches, so this counts RENDERS. Counting records instead
      // would punish a re-centre for swapping in the cities it just revealed.
      new MutationObserver(() => {
        w.__mut += 1
      }).observe(document.querySelector('svg.map')!, { attributes: true, childList: true, subtree: true })
      const tick = (): void => {
        const c = document.querySelector('[data-testid="city-JFK"]')
        if (c !== null) w.__f.push(Math.round(c.getBoundingClientRect().top * 10) / 10)
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    const sampled = async (): Promise<number[]> =>
      page.evaluate(() => (window as unknown as { __f: number[] }).__f.slice())

    // Playwright's touchscreen only taps, so the drag goes through CDP — the
    // same input path a real finger takes.
    const cdp = await context.newCDPSession(page)
    const x = box.x + box.width / 2
    const y0 = box.y + box.height * 0.7
    const touch = async (
      type: 'touchStart' | 'touchMove' | 'touchEnd',
      y: number,
    ): Promise<void> => {
      await cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }],
      })
    }

    const startVb = (await page.getByTestId('map').getAttribute('viewBox'))!
    const start = (await sampled()).at(-1)!
    await touch('touchStart', y0)
    for (let i = 1; i <= 20; i++) await touch('touchMove', y0 - i * 4)
    const halfway = (await sampled()).at(-1)!
    for (let i = 21; i <= 40; i++) await touch('touchMove', y0 - i * 4)
    const frames = await sampled()
    const end = frames.at(-1)!
    await touch('touchEnd', y0 - 160)
    await page.waitForTimeout(300)

    // Dragging up walks the world up under the finger, and it has to be most
    // of the way there before the finger lifts.
    expect(end, 'the drag moved the world').toBeLessThan(start - 10)
    expect((halfway - start) / (end - start), 'the world had moved by mid-gesture').toBeGreaterThan(
      0.35,
    )

    // Every frame of the gesture, not two: a map that jumps once yields a
    // handful of distinct positions across the whole drag.
    const during = frames.filter((f) => f < start && f > end)
    expect(new Set(during).size, 'the pan is continuous').toBeGreaterThan(10)

    // And it costs the document nothing. WebKit re-lays-out the whole SVG when
    // the viewBox changes, so a drag rides a CSS transform on a composited
    // layer instead — the SVG is touched only when the layer runs out of the
    // world it holds and has to be re-centred, a few times across a drag this
    // long rather than once a frame. If this starts climbing toward the frame
    // count, the map has quietly gone back to being unusable on an iPhone.
    const renders = await page.evaluate(() => (window as unknown as { __mut: number }).__mut)
    expect(
      renders,
      `the SVG was re-rendered ${renders} times across ${frames.length} frames of drag`,
    ).toBeLessThan(8)

    // When the finger lifts, React's copy of the view — what tap hit-testing
    // and the minimap read — must carry the pan. The viewBox deliberately
    // does NOT: the world at a shifted offset is pixels the layer already
    // holds, so a pan commit leaves the raster alone and parks the transform.
    // What has to hold is consistency: viewBox composed with the parked
    // transform equals the committed view, exactly.
    await page.waitForTimeout(200)
    const view = (await page.getByTestId('map-wrap').getAttribute('data-view'))!
      .split(' ')
      .map(Number)
    expect(view[1]!, 'the pan landed in the committed view').toBeGreaterThan(
      Number(startVb.split(' ')[1]) + 10,
    )
    const shown = await page.evaluate(() => {
      const svg = document.querySelector('svg.map')!
      const [bx, by, bw, bh] = svg.getAttribute('viewBox')!.split(' ').map(Number)
      const t = (document.querySelector('[data-testid="map-pan"]') as HTMLElement).style.transform
      const m = /translate3d\((-?[\d.]+)px,\s*(-?[\d.]+)px/.exec(t)
      const rect = document.querySelector('[data-testid="map-wrap"]')!.getBoundingClientRect()
      const k = Math.max(rect.width / bw!, rect.height / bh!)
      // paintLayer with s=1: tx = k*(base.x - v.x)  =>  v = base - t/k
      return [bx! - Number(m?.[1] ?? 0) / k, by! - Number(m?.[2] ?? 0) / k]
    })
    expect(shown[0], 'displayed x agrees with the committed view').toBeCloseTo(view[0]!, 0)
    expect(shown[1], 'displayed y agrees with the committed view').toBeCloseTo(view[1]!, 0)
  })

  // Gestures compute from where the view is HEADING, so consecutive inputs
  // compound instead of stacking jumps. The cost of that is a finger landing
  // during an eased zoom: without stopping the animation first, the first
  // move teleports the map to the zoom's destination. On the globe that reads
  // as it instantly zooming and re-centring the moment you touch it.
  test('grabbing the map during an eased zoom stops the zoom where it is', async ({
    page,
    context,
  }) => {
    await startGame(page)
    const box = (await page.getByTestId('map').boundingBox())!
    const cdp = await context.newCDPSession(page)
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2
    const touch = async (
      type: 'touchStart' | 'touchMove' | 'touchEnd',
      px: number,
    ): Promise<void> => {
      await cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: type === 'touchEnd' ? [] : [{ x: px, y, id: 1 }],
      })
    }
    // Two steps in one round trip, so the drag starts well inside the ~130ms
    // the ease takes rather than racing it.
    const zoomTwice = async (): Promise<void> =>
      page.evaluate(() => {
        const b = document.querySelector<HTMLElement>('[data-testid="zoom-in"]')!
        b.click()
        b.click()
      })
    const grab = async (): Promise<void> => {
      await touch('touchStart', x)
      await touch('touchMove', x + 8)
      await touch('touchMove', x + 18)
    }

    // Flat map: how wide a slice of the world is on screen, however the zoom
    // is currently expressed — the viewBox, the ease's transform, or both.
    // Calibrated against the same two clicks left to settle, so the assertion
    // cannot drift with the zoom step.
    const shownWidth = async (): Promise<number> =>
      page.evaluate(() => {
        const vb = document.querySelector('svg.map')!.getAttribute('viewBox')!.split(/\s+/)
        const t = document.querySelector('[data-testid="map-pan"]')?.getAttribute('transform') ?? ''
        return Number(vb[2]) / Number(/scale\(([-\d.]+)\)/.exec(t)?.[1] ?? 1)
      })
    await zoomTwice()
    await page.waitForTimeout(700)
    const settledFlat = await shownWidth()
    await page.getByTestId('zoom-reset').click()
    await page.waitForTimeout(700)
    expect(settledFlat, 'two zoom steps narrow the view').toBeLessThan((await shownWidth()) * 0.8)

    await zoomTwice()
    await grab()
    const grabbedFlat = await shownWidth()
    await touch('touchEnd', x + 18)
    expect(grabbedFlat, 'the touch did not teleport the map to the zoom target').toBeGreaterThan(
      settledFlat * 1.05,
    )

    // Globe: the disc radius is the zoom, so the jump is directly readable.
    // Calibrated against the same zoom left to settle, rather than a hard
    // number, so the assertion cannot drift with the zoom step.
    await page.getByTestId('map-projection').click()
    await page.waitForTimeout(400)
    const discR = async (): Promise<number> =>
      Number(await page.locator('.globe-disc').getAttribute('r'))
    await zoomTwice()
    await page.waitForTimeout(600)
    const settled = await discR()
    await page.getByTestId('zoom-reset').click()
    await page.waitForTimeout(600)
    const home = await discR()
    expect(settled, 'two zoom steps grow the globe').toBeGreaterThan(home * 1.5)

    await zoomTwice()
    await grab()
    const grabbed = await discR()
    await touch('touchEnd', x + 18)
    expect(grabbed, 'the touch did not teleport the globe to the zoom target').toBeLessThan(
      settled * 0.95,
    )
  })
})

// At 6x, one thirty-sixth of the world is on screen — but every city used to
// render anyway, and the label placer tests each label against every label
// already placed. That is ~54k rectangle intersections to position a dozen
// labels, paid again on every re-centre mid-drag. Off-screen cities cannot be
// seen, so they are not drawn.
// A drag that starts on the map and runs off its edge must never turn into a
// text selection of the page around it. Safari arms the selection at
// mousedown and extends it into the neighbours once the pointer leaves the
// map, so the map cancels the mousedown AND makes the whole page unselectable
// for exactly the duration of a gesture.
test('dragging off the map edge selects no text, and selection returns after', async ({
  page,
}) => {
  await startGame(page)
  const box = (await page.getByTestId('map-wrap').boundingBox())!
  const x = box.x + box.width / 2

  // Drag from mid-map to well below its bottom edge, across the tab bar and
  // panel text, and release there.
  await page.mouse.move(x, box.y + box.height * 0.6)
  await page.mouse.down()
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(x, box.y + box.height * 0.6 + i * 25)
  }
  // Mid-drag the page-wide lock is on.
  await expect(page.locator('html.map-gesture')).toHaveCount(1)
  const selected = await page.evaluate(() => window.getSelection()?.toString() ?? '')
  await page.mouse.up()

  expect(selected, 'the drag painted a selection across the page').toBe('')
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('')
  // And the lock comes off, so text is copyable again the rest of the time.
  await expect(page.locator('html.map-gesture')).toHaveCount(0)
  const copyable = await page.evaluate(() => {
    const el = document.querySelector('.key-hints')!
    const r = document.createRange()
    r.selectNodeContents(el)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(r)
    const got = sel.toString()
    sel.removeAllRanges()
    return got
  })
  expect(copyable, 'page text is still selectable after the gesture').toContain('end quarter')
})

// The stutter you feel while dragging is a re-centre: the layer runs out of
// painted world, the viewBox is rewritten, and the whole cached texture is
// thrown away mid-gesture. Zoomed out, the world is only a couple of frames
// across — so the layer holds ALL of it and a drag of any length re-centres
// zero times, however far it goes.
test('a drag at low zoom never rewrites the viewBox, however long', async ({ page }) => {
  await startGame(page)
  for (let i = 0; i < 2; i++) {
    await page.getByTestId('zoom-in').click()
    await page.waitForTimeout(350)
  }
  await page.waitForTimeout(700)

  await page.evaluate(() => {
    const w = window as unknown as { __vb: number }
    w.__vb = 0
    new MutationObserver((recs) => {
      w.__vb += recs.length
    }).observe(document.querySelector('svg.map')!, {
      attributes: true,
      attributeFilter: ['viewBox'],
    })
  })

  // Far enough to have crossed the old quarter-frame overhang several times.
  const b = (await page.getByTestId('map-wrap').boundingBox())!
  const y = b.y + b.height / 2
  let x = b.x + b.width * 0.9
  await page.mouse.move(x, y)
  await page.mouse.down()
  for (let i = 0; i < 40; i++) {
    x -= b.width * 0.02
    await page.mouse.move(x, y)
  }
  const during = await page.evaluate(() => (window as unknown as { __vb: number }).__vb)
  await page.mouse.up()
  await page.waitForTimeout(500)

  expect(during, `the viewBox was rewritten ${during} times mid-drag`).toBe(0)
  // And not on release either: a pan's pixels are already painted, so the
  // commit moves React's view and leaves the raster untouched. The whole
  // drag, start to settle, costs the viewBox nothing.
  await page.waitForTimeout(400)
  const after = await page.evaluate(() => (window as unknown as { __vb: number }).__vb)
  expect(after, 'a pan never rewrites the viewBox at all').toBe(0)
  // The commit still happened — the logical view carries the pan.
  const dv = (await page.getByTestId('map-wrap').getAttribute('data-view'))!.split(' ').map(Number)
  const vb = (await page.getByTestId('map').getAttribute('viewBox'))!.split(' ').map(Number)
  expect(dv[0]!, 'the committed view moved off the anchor').not.toBeCloseTo(vb[0]!, 1)
})

// Two animation systems live inside the composited layer, and content that
// changes inside one invalidates it — which puts a full re-raster back into
// every frame of a drag. The planes are SMIL, which ignores
// `animation-play-state` entirely, so this has to be checked rather than
// assumed: it silently regressed once already.
test('a drag stops everything that animates inside the map', async ({ page }) => {
  await startGame(page)
  // A career with planes in the air.
  await page.evaluate(() => {
    const h = window.__harness
    for (let q = 0; q < 4; q++) {
      const s = h.getState()!
      const idle = s.airlines[0]!.fleet.filter((a) => a.routeId === null)
      const to = ['ORD', 'LAX', 'MIA', 'YYZ']
      if (idle[0]) {
        h.dispatch({ type: 'open_route', from: 'JFK', to: to[q]!, aircraftId: idle[0].id, frequency: 4 })
      }
      h.endQuarter()
    }
  })
  await page.getByTestId('zoom-in').click()
  await page.waitForTimeout(800)
  await expect(page.locator('svg.map .plane').first()).toBeAttached()

  const smilPaused = async (): Promise<boolean> =>
    page.evaluate(() => (document.querySelector('svg.map') as SVGSVGElement).animationsPaused())

  expect(await smilPaused(), 'animations run when the map is still').toBe(false)

  const b = (await page.getByTestId('map-wrap').boundingBox())!
  const y = b.y + b.height / 2
  await page.mouse.move(b.x + b.width / 2, y)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width / 2 - 30, y)
  await page.mouse.move(b.x + b.width / 2 - 60, y)
  expect(await smilPaused(), 'the planes hold still while the map moves').toBe(true)
  await page.mouse.up()
  await expect.poll(smilPaused, { timeout: 3000 }).toBe(false)
})

test('max zoom draws the cities on screen, not all of them', async ({ page }) => {
  await startGame(page)
  for (let i = 0; i < 7; i++) {
    await page.getByTestId('zoom-in').click()
    await page.waitForTimeout(260)
  }
  await page.waitForTimeout(900)

  // Zoomed all the way in the LOD allows every tier, so without a positional
  // cull this is the whole 165-city catalogue.
  const drawn = await page.locator('svg.map [data-testid^="city-"]').count()
  expect(drawn, `${drawn} city markers drawn at max zoom`).toBeLessThan(40)
  expect(drawn, 'the cities in frame are still drawn').toBeGreaterThan(0)

  // The invariant, stated directly: nothing is drawn far outside the frame.
  // The margin is the layer's overhang plus slack — a gesture may reveal a
  // little more world than the frame before the layer re-centres.
  const strays = await page.evaluate(() => {
    const frame = document.querySelector('[data-testid="map-wrap"]')!.getBoundingClientRect()
    const mx = frame.width * 0.6
    const my = frame.height * 0.6
    return [...document.querySelectorAll('svg.map [data-testid^="city-"]')]
      .map((el) => ({ id: el.getAttribute('data-testid')!, r: el.getBoundingClientRect() }))
      .filter(
        ({ r }) =>
          r.right < frame.left - mx ||
          r.left > frame.right + mx ||
          r.bottom < frame.top - my ||
          r.top > frame.bottom + my,
      )
      .map(({ id }) => id)
  })
  expect(strays, 'cities were drawn nowhere near the frame').toEqual([])

  // And the cull tracks the view: panning somewhere else brings its cities.
  const before = await page.locator('svg.map text.city-label').allTextContents()
  const b = (await page.getByTestId('map-wrap').boundingBox())!
  const y = b.y + b.height / 2
  let x = b.x + b.width * 0.85
  await page.mouse.move(x, y)
  await page.mouse.down()
  for (let i = 0; i < 25; i++) {
    x -= b.width * 0.03
    await page.mouse.move(x, y)
  }
  await page.mouse.up()
  await page.waitForTimeout(700)
  const after = await page.locator('svg.map text.city-label').allTextContents()
  expect(after.join(), 'panning brought a different part of the world').not.toBe(before.join())
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
  // Copy-as-spreadsheet writes formula-ready TSV to the clipboard.
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.getByTestId('copy-standings').click()
  const tsv = await page.evaluate(() => navigator.clipboard.readText())
  expect(tsv).toContain('airline\tnetWorthK')
  expect(tsv).toContain('Meridian Air (you)')
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
  // The shop teases airframes entering the market in the next few years.
  await page.getByTestId('tab-fleet').click()
  await expect(page.getByTestId('shop-horizon')).toContainText('On the horizon')
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

// A zoom step eases over ~130ms. It used to push every one of those frames
// through React, reconciling the whole map thirty-odd times for one click —
// invisible on a fast engine, seconds of lag on a slow one. The ease belongs
// in the DOM, like the drag, with a single render to commit the result.
test('an eased zoom does not re-render the map on every frame', async ({ page }) => {
  await startGame(page)
  await page.waitForTimeout(400)
  await page.evaluate(() => {
    const w = window as unknown as { __mut: number }
    w.__mut = 0
    new MutationObserver((recs) => {
      w.__mut += recs.length
    }).observe(document.querySelector('svg.map')!, { attributes: true, childList: true, subtree: true })
  })
  await page.getByTestId('zoom-in').click()
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __mut: number }).__mut), { timeout: 4000 })
    .toBeGreaterThan(0)
  await page.waitForTimeout(1200)
  const mutations = await page.evaluate(() => (window as unknown as { __mut: number }).__mut)
  // The whole-map reconcile is ~450 mutations; per-frame easing ran ~1900 for
  // one step. A transform-driven ease plus one commit lands an order of
  // magnitude below that, with room for the frame count to vary by machine.
  expect(mutations, `one zoom step mutated the DOM ${mutations} times`).toBeLessThan(700)
})

// Same defect on the globe, and worse: each of those renders re-projected
// every coastline point in JS. A globe zoom is a pure scale about the centre
// (the visible hemisphere depends on the rotation, never on the radius), so
// it rides a transform and commits once — and must still land exactly on the
// 1.5x step, with no transform left over.
test('a globe zoom scales without re-projecting the world every frame', async ({ page }) => {
  await startGame(page)
  await page.getByTestId('map-projection').click()
  await expect(page.getByTestId('globe-land')).toBeVisible()
  await page.waitForTimeout(700)
  const width = async (): Promise<number> =>
    page.getByTestId('globe-land').evaluate((el) => (el as SVGGraphicsElement).getBBox().width)

  const before = await width()
  await page.evaluate(() => {
    const w = window as unknown as { __gmut: number }
    w.__gmut = 0
    new MutationObserver((recs) => {
      w.__gmut += recs.length
    }).observe(document.querySelector('svg.map')!, { attributes: true, childList: true, subtree: true })
  })
  await page.getByTestId('zoom-in').click()
  await page.waitForTimeout(1500)

  const mutations = await page.evaluate(() => (window as unknown as { __gmut: number }).__gmut)
  expect(mutations, `one globe zoom mutated the DOM ${mutations} times`).toBeLessThan(700)
  // The ease has to commit to state, not leave the map parked on a transform.
  await expect
    .poll(() => page.getByTestId('map-pan').evaluate((el) => (el as HTMLElement).style.transform))
    .toBe('')
  expect((await width()) / before).toBeCloseTo(1.5, 1)
})

// The globe is the same world at the same quality, not a lo-fi preview: coast
// glow, fine coastline past the same zoom threshold, and country borders.
// The one concession is mid-rotation, when every frame is a full
// re-projection — coarse rings until it rests, full detail back at rest.
test('the globe matches the flat map: glow, borders, and fine detail at rest', async ({
  page,
}) => {
  await startGame(page)
  await page.getByTestId('map-projection').click()
  await expect(page.getByTestId('globe-land')).toBeVisible()
  await page.waitForTimeout(600)
  const landChars = async (): Promise<number> =>
    (await page.getByTestId('globe-land').getAttribute('d'))!.length
  await expect(page.locator('svg.map .map-coast-glow')).toHaveCount(1)
  const coarse = await landChars()

  // Past the flat map's fine threshold (1.5^2 = 2.25 >= 1.8): the coastline
  // sharpens and borders appear, exactly as they would flat.
  for (let i = 0; i < 2; i++) {
    await page.getByTestId('zoom-in').click()
    await page.waitForTimeout(600)
  }
  await page.waitForTimeout(600)
  const fine = await landChars()
  expect(fine, 'the zoomed globe carries the fine coastline').toBeGreaterThan(coarse * 1.5)
  await expect(page.locator('svg.map .map-border')).toHaveCount(1)
  expect((await page.locator('svg.map .map-border').getAttribute('d'))!.length).toBeGreaterThan(100)

  // Mid-rotation it re-projects every frame, so it drops to the coarse rings
  // — and takes the detail back the moment the finger lifts.
  const b = (await page.getByTestId('map-wrap').boundingBox())!
  const y = b.y + b.height / 2
  await page.mouse.move(b.x + b.width / 2, y)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width / 2 - 40, y)
  await page.mouse.move(b.x + b.width / 2 - 80, y)
  expect(await landChars(), 'rotation projects the coarse rings').toBeLessThan(fine / 1.5)
  await expect(page.locator('svg.map .map-border'), 'borders sit out the rotation').toHaveCount(0)
  await page.mouse.up()
  await expect.poll(landChars, { timeout: 3000 }).toBeGreaterThan(coarse * 1.5)
  await expect(page.locator('svg.map .map-border')).toHaveCount(1)
})

// `preserveAspectRatio="slice"` scales the viewBox to COVER the element, so
// any container that is not exactly the viewBox's shape has visible area
// outside it. The globe's viewBox is a fixed 960x352 — nothing like a window —
// so a sea rect of exactly that size left the globe in a black letterbox.
test('the globe sits on sea all the way to the edge of the frame', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  await startGame(page)
  await page.getByTestId('map-projection').click()
  await expect(page.getByTestId('globe-land')).toBeVisible()
  await page.waitForTimeout(700)

  const painted = await page.evaluate(() => {
    const svg = document.querySelector('svg.map')!
    const r = svg.getBoundingClientRect()
    // Just inside each edge, away from the map's own control cluster.
    const probes: Array<[number, number]> = [
      [0.5, 0.02],
      [0.5, 0.98],
      [0.97, 0.05],
      [0.97, 0.95],
    ]
    return probes.map(([fx, fy]) => {
      const el = document.elementFromPoint(r.left + r.width * fx, r.top + r.height * fy)
      return el instanceof SVGElement ? el.getAttribute('class') : `non-svg:${el?.tagName}`
    })
  })
  for (const hit of painted) expect(hit, `frame edge showed "${hit}" instead of ocean`).toContain('map-sea')
})

// Nothing about the map changes while it moves, and nothing on it needs an
// SVG filter. Both used to be false, and each was a stutter: dropping detail
// for a zoom forced two extra re-rasters (a habit left over from when zooms
// re-rastered per frame), and the coast's glow was an feDropShadow whose
// filter region is the whole world — WebKit re-ran that blur on every raster
// of the layer, a consistent ~150ms frame on every zoom step.
test('detail survives pan and zoom alike, with no filter in the layer', async ({ page }) => {
  await startGame(page)
  for (let i = 0; i < 3; i++) await page.getByTestId('zoom-in').click()
  await page.waitForTimeout(900)
  const landChars = async (): Promise<number> =>
    (await page.locator('path.map-land').first().getAttribute('d'))!.length

  const settled = await landChars()
  await expect(page.locator('.map-border')).toHaveCount(1)
  // The glow is a stroked path, not a filter, and nothing inside the moving
  // layer carries an SVG filter attribute at all.
  await expect(page.locator('.map-coast-glow')).toHaveCount(1)
  expect(await page.locator('.map-layer [filter]').count()).toBe(0)

  // A drag keeps everything.
  const box = (await page.getByTestId('map-wrap').boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x - 15, y - 6)
  await page.mouse.move(x - 30, y - 12)
  expect(await landChars(), 'a pan keeps the fine coastline').toBe(settled)
  await expect(page.locator('.map-border'), 'a pan keeps the borders').toHaveCount(1)
  await page.mouse.up()
  await page.waitForTimeout(400)

  // A zoom keeps everything too: the ease rides the layer transform, and the
  // only content change is the LOD threshold, which this step does not cross.
  await page.getByTestId('zoom-in').click()
  await page.waitForTimeout(120)
  expect(await landChars(), 'mid-zoom the coastline holds').toBe(settled)
  await expect(page.locator('.map-border')).toHaveCount(1)
  await page.waitForTimeout(900)
  expect(await landChars()).toBe(settled)
})

test('the late-game map stays within its structural render budget', async ({ page }) => {
  await startGame(page)
  // A working network keeps the player solvent while rivals expand for four
  // years — a busy mid/late-game map without the game-over overlay. Three
  // routes out of the hub, the fleet spread across them: piling every
  // airframe onto one pair just flies empty seats at full rent.
  await page.evaluate(() => {
    for (const to of ['ORD', 'MIA', 'YYZ']) {
      const idle = window.__harness.getState()!.airlines[0]!.fleet.find((ac) => ac.routeId === null)
      if (!idle) break
      window.__harness.dispatch({ type: 'open_route', from: 'JFK', to, aircraftId: idle.id, frequency: 6 })
    }
    const s = window.__harness.getState()!
    const routes = s.airlines[0]!.routes
    let i = 0
    for (const aircraft of s.airlines[0]!.fleet) {
      if (aircraft.routeId !== null) continue
      window.__harness.dispatch({
        type: 'assign_aircraft',
        aircraftId: aircraft.id,
        routeId: routes[i++ % routes.length]!.id,
      })
    }
    for (let q = 0; q < 16; q++) window.__harness.endQuarter()
  })
  expect(await page.evaluate(() => window.__harness.getState()!.phase)).toBe('planning')
  // Decorative traffic is hard-capped by design: at most 12 rival planes.
  expect(await page.locator('.plane-rival').count()).toBeLessThanOrEqual(12)
  const total = await page.evaluate(() => document.querySelectorAll('svg.map *').length)
  expect(total, 'world-view element count').toBeLessThan(1600)
  // Zooming in reveals the small airfields, still bounded.
  await page.getByTestId('zoom-in').click()
  await page.getByTestId('zoom-in').click()
  await page.getByTestId('zoom-in').click()
  const zoomed = await page.evaluate(() => document.querySelectorAll('svg.map *').length)
  expect(zoomed, 'zoomed element count').toBeLessThan(2600)
})

test('the report archive pages back through quarters and files an annual review', async ({ page }) => {
  await startGame(page)
  await page.evaluate(() => {
    const snap = window.__harness.getState()!
    const idle = snap.airlines[0]!.fleet.find((ac) => ac.routeId === null)!
    window.__harness.dispatch({ type: 'open_route', from: 'JFK', to: 'ORD', aircraftId: idle.id, frequency: 5 })
    for (let i = 0; i < 5; i++) window.__harness.endQuarter()
  })
  await page.getByTestId('tab-report').click()
  // Latest edition first; the arrows browse the morgue and 'latest' returns.
  await expect(page.getByTestId('report-date')).toHaveText('1961 Q1')
  await page.getByTestId('report-prev').click()
  await expect(page.getByTestId('report-date')).toHaveText('1960 Q4')
  await page.getByTestId('report-latest').click()
  await expect(page.getByTestId('report-date')).toHaveText('1961 Q1')
  // Filtering the wire narrows the log to one section.
  await page.getByTestId('report-filter-money').click()
  await expect(page.getByTestId('report')).toContainText('Quarter closed')
  // The annual review sums 1960's four quarters.
  await page.getByTestId('report-view-years').click()
  await expect(page.getByTestId('annual-review')).toContainText('1960')
})

test('the minimap appears when zoomed and jumps the view on click', async ({ page }) => {
  await startGame(page)
  await expect(page.getByTestId('minimap')).toHaveCount(0) // world view needs no minimap
  await page.getByTestId('zoom-in').click()
  await page.getByTestId('zoom-in').click()
  await expect(page.getByTestId('minimap')).toBeVisible()
  // The marker is a unit rect placed by transform, so that is where its
  // position lives — reading x would report the constant 0 forever.
  const markerAt = async (): Promise<string> =>
    page.getByTestId('minimap-viewport').evaluate((el) => (el as SVGElement).style.transform)
  const before = await markerAt()
  expect(before, 'the marker is placed by a transform').toContain('translate')
  // Clicking the far side of the thumbnail recenters the viewport there.
  await page.getByTestId('minimap').click({ position: { x: 130, y: 40 } })
  await expect.poll(markerAt).not.toBe(before)
  // Zooming back out dismisses it.
  await page.getByTestId('zoom-reset').click()
  await expect(page.getByTestId('minimap')).toHaveCount(0)
  // No two city labels share an anchor: the collision pass keeps them apart.
  const positions = await page.evaluate(() =>
    [...document.querySelectorAll('svg.map text.city-label')].map(
      (t) => `${t.getAttribute('x')},${t.getAttribute('y')},${t.getAttribute('text-anchor')}`,
    ),
  )
  expect(new Set(positions).size).toBe(positions.length)
})

test('keyboard reaches the network and every control has an accessible name', async ({ page }) => {
  await startGame(page)
  await page.evaluate(() => {
    const snap = window.__harness.getState()!
    const idle = snap.airlines[0]!.fleet.find((ac) => ac.routeId === null)!
    window.__harness.dispatch({ type: 'open_route', from: 'JFK', to: 'ORD', aircraftId: idle.id, frequency: 5 })
  })
  // Arrow keys cycle the dossier through network cities without a mouse.
  await page.keyboard.press('ArrowRight')
  await expect(page.getByTestId('city-panel')).toBeVisible()
  const first = await page.getByTestId('city-panel').locator('h2').textContent()
  await page.keyboard.press('ArrowRight')
  const second = await page.getByTestId('city-panel').locator('h2').textContent()
  expect(second).not.toBe(first)
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByTestId('city-panel').locator('h2')).toHaveText(first!)
  await page.keyboard.press('Escape')
  // Every button carries an accessible name (text or aria-label), and the
  // live regions the game narrates through are present.
  const unnamed = await page.evaluate(() =>
    [...document.querySelectorAll('button')]
      .filter((el) => !((el.getAttribute('aria-label') ?? el.textContent ?? '').trim()))
      .map((el) => el.outerHTML.slice(0, 80)),
  )
  expect(unnamed).toEqual([])
  const unlabeledImages = await page.evaluate(() =>
    [...document.querySelectorAll('svg[role="img"]')]
      .filter((el) => !el.getAttribute('aria-label'))
      .map((el) => (el.getAttribute('class') ?? 'svg').slice(0, 40)),
  )
  expect(unlabeledImages).toEqual([])
})

test('the handbook teaches every system, and legends live where they are used', async ({ page }) => {
  await startGame(page)
  // '?' opens the handbook: intro + all nine system legends + shortcuts.
  await page.keyboard.press('?')
  await expect(page.getByTestId('handbook-intro')).toContainText('race')
  for (const legend of [
    'hub-legend',
    'spool-legend',
    'season-legend',
    'slot-legend',
    'marketing-legend',
    'hedge-legend',
    'takeover-legend',
    'cabin-legend',
    'service-legend',
  ]) {
    await expect(page.getByTestId('handbook-systems').getByTestId(legend)).toBeAttached()
  }
  // A legend expands to real, live-constant prose.
  await page.getByTestId('handbook-systems').getByTestId('hub-legend').locator('summary').click()
  await expect(page.getByTestId('handbook-systems').getByTestId('hub-legend')).toContainText('one-stop')
  await page.keyboard.press('Escape')
  // In context: the finance tab explains marketing and hedging where the
  // buttons are; rivals intel explains takeovers next to the buy buttons.
  await page.getByTestId('tab-finance').click()
  await expect(page.getByTestId('marketing-legend')).toBeAttached()
  await expect(page.getByTestId('hedge-legend')).toBeAttached()
  await page.getByTestId('tab-rivals').click()
  await expect(page.getByTestId('takeover-legend')).toBeAttached()
})

test('the share loop closes: copy feedback, duel HUD, and preserved careers', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  // A duel career shows the number to beat in the HUD from turn one.
  await page.goto('/?scenario=jet_age&seed=loop-seed&target=99999999&by=Ghost')
  await page.getByTestId('start-challenge').click()
  await expect(page.getByTestId('duel-chip')).toContainText('behind Ghost')
  // Copying the challenge link confirms via toast instead of silence.
  await page.getByTestId('share-challenge').click()
  await expect(page.getByTestId('toasts')).toContainText('Challenge link copied')
  // Ride the idle airline to game over: the finished career must SURVIVE
  // "New game" — it is the only replayable record of those decades.
  await page.evaluate(() => {
    for (let i = 0; i < 40 && window.__harness.getState()!.phase === 'planning'; i++) {
      window.__harness.endQuarter()
    }
  })
  await expect(page.getByTestId('gameover-overlay')).toBeVisible()
  await page.getByTestId('new-game').click()
  const row = page.getByTestId('save-slot-0')
  await expect(row).toBeVisible()
  await expect(row).toContainText('🏁')
  // The preserved record replays with identity and narration.
  await page.getByTestId('watch-save-replay').click()
  await expect(page.getByTestId('replay-viewer')).toBeVisible()
  await expect(page.getByTestId('replay-identity')).toContainText('The Jet Age')
  // Scrub to the end: the final quarter carries the game-over headline.
  await page.getByTestId('replay-speed').click()
  await expect(page.getByTestId('replay-headlines')).toContainText('🕯️', { timeout: 30000 })
  await page.getByTestId('replay-exit').click()
})

test('the race stays a race: bounded field, scrutiny surfaced, rules explained', async ({ page }) => {
  await startGame(page)
  // Keep the airline flying so the career survives to the assertions.
  const field = await page.evaluate(() => {
    const snap = window.__harness.getState()!
    const before = snap.airlines.length
    const idle = snap.airlines[0]!.fleet.find((ac) => ac.routeId === null)!
    window.__harness.dispatch({ type: 'open_route', from: 'JFK', to: 'ORD', aircraftId: idle.id, frequency: 5 })
    const s2 = window.__harness.getState()!
    const routeId = s2.airlines[0]!.routes[0]!.id
    for (const ac of s2.airlines[0]!.fleet) {
      window.__harness.dispatch({ type: 'assign_aircraft', aircraftId: ac.id, routeId })
    }
    // A single route is a thin business in the post-F1 world — run far enough
    // to exercise the field mechanics, not far enough to go under.
    for (let i = 0; i < 8 && window.__harness.getState()!.phase === 'planning'; i++) {
      window.__harness.endQuarter()
    }
    const after = window.__harness.getState()!
    return { before, after: after.airlines.length, phase: after.phase }
  })
  expect(field.phase).toBe('planning')
  // Seats are recycled, never appended: the field stays the intended size no
  // matter how many carriers fail and how many startups arrive.
  expect(field.after).toBe(field.before)
  // Dominance has a visible price, and the rivalry rules are explained where
  // the player meets them.
  await page.getByTestId('tab-finance').click()
  await expect(page.getByTestId('scrutiny-note')).toContainText('scrutiny starts at')
  await expect(page.getByTestId('rivalry-legend')).toBeAttached()
})

test('each era scores its own objective, not always net worth', async ({ page }) => {
  // Open Skies is won on CONNECTING passengers — the HUD, the handbook and
  // the pace note must all talk about that, not about net worth.
  await page.goto('/')
  await page.getByTestId('seed-input').fill('objective-seed')
  await page.getByTestId('start-open_skies').click()
  await page.getByTestId('start-open_skies').click()
  await expect(page.getByTestId('date')).toHaveText('1995 Q1')
  await expect(page.getByTestId('objective-progress')).toContainText('connecting passengers')
  await page.keyboard.press('?')
  await expect(page.getByTestId('handbook-objective')).toContainText('Megahub')
  await page.keyboard.press('Escape')
  // The menu states each era's goal, so the campaign reads as five games.
  await page.goto('/')
  await expect(page.getByTestId('scenario-lcc_wars')).toContainText('lifetime load factor')
  await expect(page.getByTestId('scenario-deregulation')).toContainText('passengers flown')
})

test('the world asks questions: an offer can be taken or passed', async ({ page }) => {
  await startGame(page)
  // Put a concrete offer on the table through the engine, then answer it in
  // the UI the way a player would.
  await page.evaluate(() => {
    const s = window.__harness.getState()!
    s.world.offers.push({
      id: 99,
      kind: 'regulator_slots',
      city: 'LHR',
      expiresTurn: s.turn + 3,
      costK: 1200,
      upkeepK: 300,
      benefitFromTurn: s.turn,
      untilTurn: s.turn + 16,
      slots: 3,
      demandBonusBp: 0,
      headline: 'Authority deal: 3 slots at London',
      detail: 'Gates now, an upkeep charge later.',
    })
    // Nudge the session to re-render with the mutated world.
    window.__harness.dispatch({ type: 'set_marketing', level: 0 })
  })
  const card = page.getByTestId('offer-card')
  await expect(card).toContainText('London')
  await expect(page.getByTestId('offer-deadline')).toContainText('quarters to decide')
  await page.getByTestId('offer-accept').click()
  // Taking it grants the gates immediately and starts a running commitment.
  const slots = await page.evaluate(() => window.__harness.getState()!.airlines[0]!.slots['LHR'] ?? 0)
  expect(slots).toBeGreaterThanOrEqual(3)
  await expect(page.getByTestId('offer-card')).toHaveCount(0)
  await expect(page.getByTestId('active-deals')).toContainText('LHR')
})

test('stakes scale with the airline: groundings, reputation, milestones', async ({ page }) => {
  await startGame(page)
  await page.evaluate(() => {
    const snap = window.__harness.getState()!
    const idle = snap.airlines[0]!.fleet.find((ac) => ac.routeId === null)!
    window.__harness.dispatch({ type: 'open_route', from: 'JFK', to: 'ORD', aircraftId: idle.id, frequency: 5 })
    // A geriatric fleet: the reliability warning must appear where the metal is.
    const s = window.__harness.getState()!
    for (const ac of s.airlines[0]!.fleet) ac.ageQuarters = 60
    window.__harness.dispatch({ type: 'set_marketing', level: 0 })
  })
  await page.getByTestId('tab-fleet').click()
  await expect(page.getByTestId('reliability-note')).toContainText('old metal breaks')
  await expect(page.getByTestId('reliability-legend')).toBeAttached()
})
