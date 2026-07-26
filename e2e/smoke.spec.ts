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
  const frames = (selector: string, attr: string) =>
    page.evaluate(
      ([sel, at]) =>
        new Promise<string[]>((res) => {
          const out: string[] = []
          let n = 0
          const tick = () => {
            const el = document.querySelector(sel!)
            out.push(el?.getAttribute(at!) ?? '')
            if (++n < 20) requestAnimationFrame(tick)
            else res(out)
          }
          requestAnimationFrame(tick)
        }),
      [selector, attr] as const,
    )

  const centreOfMap = async () => {
    const b = (await page.getByTestId('map').boundingBox())!
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
  }

  // Flat map: the viewBox width is the zoom.
  let collect = frames('svg.map', 'viewBox')
  await page.getByTestId('zoom-in').click()
  expect(new Set(await collect).size, 'flat zoom button eases').toBeGreaterThan(5)

  await page.getByTestId('zoom-reset').click()
  await page.waitForTimeout(400)
  collect = frames('svg.map', 'viewBox')
  const c = await centreOfMap()
  await page.mouse.dblclick(c.x, c.y)
  expect(new Set(await collect).size, 'flat double-click eases').toBeGreaterThan(5)

  // Globe: the viewBox is fixed, so the disc radius carries the zoom.
  await page.getByTestId('map-projection').click()
  await page.waitForTimeout(400)
  collect = frames('.globe-disc', 'r')
  await page.getByTestId('zoom-in').click()
  expect(new Set(await collect).size, 'globe zoom button eases').toBeGreaterThan(5)

  await page.waitForTimeout(400)
  collect = frames('.globe-disc', 'r')
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

    await page.evaluate(() => {
      const w = window as unknown as { __f: { t: string; vb: string }[] }
      w.__f = []
      const svg = document.querySelector('svg.map')!
      const pan = document.querySelector('[data-testid="map-pan"]')!
      const tick = (): void => {
        w.__f.push({ t: pan.getAttribute('transform') ?? '', vb: svg.getAttribute('viewBox') ?? '' })
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    const sampled = async (): Promise<{ t: string; vb: string }[]> =>
      page.evaluate(() => (window as unknown as { __f: { t: string; vb: string }[] }).__f.slice())
    // translate(tx ty) scale(k) — ty is how far the world has been shifted.
    const shiftOf = (t: string): number => Number(/translate\([-\d.]+ ([-\d.]+)\)/.exec(t)?.[1] ?? 0)

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

    const startVb = (await sampled()).at(-1)!.vb
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
    expect(shiftOf(end.t), 'the drag moved the world').toBeLessThan(-10)
    const progress = shiftOf(halfway.t) / shiftOf(end.t)
    expect(progress, 'the world had moved by mid-gesture').toBeGreaterThan(0.35)

    // Every frame of the gesture, not two: a map that jumps once yields a
    // handful of distinct values across the whole drag.
    const during = frames.filter((f) => shiftOf(f.t) < 0 && shiftOf(f.t) > shiftOf(end.t))
    expect(new Set(during.map((f) => f.t)).size, 'the pan is continuous').toBeGreaterThan(10)

    // The point of the transform: WebKit re-lays-out the whole SVG when the
    // viewBox changes, so a gesture must never touch it. If this starts
    // failing, the map has quietly gone back to being unusable on an iPhone.
    expect(new Set(frames.map((f) => f.vb)).size, 'the viewBox held still').toBe(1)
    expect(frames[0]!.vb).toBe(startVb)

    // When the finger lifts the transform folds back into the viewBox, and
    // React owns the view again — its copy is what tap hit-testing and the
    // zoom LOD read, so a view left behind by a drag silently mis-resolves
    // everything that follows.
    await expect(page.getByTestId('map-pan')).not.toHaveAttribute('transform')
    const view = (await page.getByTestId('map-wrap').getAttribute('data-view'))!
    expect(await page.getByTestId('map').getAttribute('viewBox')).toBe(view)
    expect(Number(view.split(' ')[1]), 'the pan landed in the viewBox').toBeGreaterThan(
      Number(startVb.split(' ')[1]) + 10,
    )
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

    // Flat map: a drag that starts mid-zoom may only pan, so the scale in the
    // pan transform stays 1. Teleporting to the zoom target shows up as the
    // group suddenly carrying the whole zoom step.
    await zoomTwice()
    await grab()
    const k = await page.evaluate(() => {
      const t = document.querySelector('[data-testid="map-pan"]')?.getAttribute('transform') ?? ''
      return Number(/scale\(([-\d.]+)\)/.exec(t)?.[1] ?? 1)
    })
    await touch('touchEnd', x + 18)
    expect(k, 'the grab panned without zooming').toBeCloseTo(1, 2)

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
  const before = await page.getByTestId('minimap-viewport').getAttribute('x')
  // Clicking the far side of the thumbnail recenters the viewport there.
  await page.getByTestId('minimap').click({ position: { x: 130, y: 40 } })
  await expect
    .poll(async () => page.getByTestId('minimap-viewport').getAttribute('x'))
    .not.toBe(before)
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
