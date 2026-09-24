import { expect, test, type Locator } from '@playwright/test'
import { flyQuarter, openPanel } from './workspace'
import { readFileSync } from 'node:fs'
import type { GameState } from '../src/engine'

// Fault injection must reach the page's requests rather than a service-worker fetch.
// Offline/cache behavior has its own tests; these exercise the lazy loader.
test.use({ serviceWorkers: 'block' })

test('globe geometry loads on demand while the flat map remains usable', async ({ page }) => {
  const requests: string[] = []
  page.on('request', (request) => { if (/globemap\.gen-.*\.json/.test(request.url())) requests.push(request.url()) })
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  await page.route('**/globemap.gen-*.json', async (route) => { await held; await route.continue() })
  await page.goto('/')
  await page.getByTestId('start-jet_age').click()
  await openPanel(page, 'map')
  await expect(page.getByTestId('map')).toBeVisible()
  expect(requests).toHaveLength(0)
  await openPanel(page, 'fleet')
  await page.keyboard.press('g')
  await openPanel(page, 'map')
  expect(requests).toHaveLength(0)
  await page.getByTestId('map-projection').click()
  await expect(page.getByRole('status')).toContainText('Loading globe')
  await openPanel(page, 'map')
  await expect(page.getByTestId('map')).toBeVisible()
  await page.getByTestId('zoom-in').click()
  await expect(page.getByTestId('map-projection')).toHaveAttribute('aria-busy', 'true')
  release()
  await expect(page.getByTestId('globe-land')).toBeVisible()
  expect(requests).toHaveLength(1)
  await page.getByTestId('map-projection').click()
  await page.getByTestId('map-projection').click()
  await expect(page.getByTestId('globe-land')).toBeVisible()
  expect(requests).toHaveLength(1)
})

test('a failed globe download preserves the map and offers a retry', async ({ page }) => {
  let attempts = 0
  await page.route('**/globemap.gen-*.json', async (route) => {
    if (++attempts === 1) await route.abort()
    else await route.continue()
  })
  await page.goto('/')
  await page.getByTestId('start-jet_age').click()
  await openPanel(page, 'map')
  await expect(page.getByTestId('map')).toBeVisible()
  await page.getByTestId('map-projection').click()
  await expect(page.getByRole('status')).toContainText('Globe unavailable')
  await openPanel(page, 'map')
  await expect(page.getByTestId('map')).toBeVisible()
  await page.getByRole('button', { name: 'Try again', exact: true }).click()
  await expect(page.getByTestId('globe-land')).toBeVisible()
  expect(attempts).toBe(2)
})

const mature = JSON.parse(readFileSync(new URL('./fixtures/density-career.json', import.meta.url), 'utf8')) as GameState
for (const [width, height] of [[1440, 900], [390, 844]]) {
  test(`graphics ${width}px: map markers retain readable screen sizes and fleet art fits`, async ({ page }, info) => {
    await page.setViewportSize({ width: width!, height: height! })
    await page.goto('/')
    await page.getByTestId('start-jet_age').click()
    await page.evaluate((snapshot) => {
      Object.assign(window.__harness.getState()!, snapshot)
      const route = snapshot.airlines[0]!.routes[0]!
      window.__harness.dispatch({ type: 'set_fare', routeId: route.id, fareLevel: route.fareLevel })
    }, mature)
    const home = page.getByTestId('city-JFK')
    // The marker radius describes market size, independent of map aspect/zoom.
    await expect.poll(async () => (await home.boundingBox())!.width).toBeLessThan(12)
    expect((await home.boundingBox())!.width).toBeGreaterThan(8)
    for (const id of ['zoom-in', 'zoom-out', 'zoom-reset', 'map-projection', 'toggle-rivals']) {
      expect(await page.getByTestId(id).evaluate((el) => {
        const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.x+r.width/2, r.y+r.height/2)
        return hit === el || el.contains(hit)
      }), 'map controls remain available during achievement notifications').toBe(true)
    }
    await info.attach(`${width}-network`, { body: await page.screenshot(), contentType: 'image/png' })
    await page.getByTestId('zoom-in').click()
    await expect.poll(async () => (await home.boundingBox())!.width).toBeLessThan(12)
    // The globe must use the same screen-size compensation as the flat map.
    await page.getByTestId('map-projection').click()
    await expect(page.getByTestId('globe-land')).toBeVisible()
    await expect.poll(async () => (await home.boundingBox())!.width).toBeLessThan(12)
    expect((await home.boundingBox())!.width).toBeGreaterThan(8)
    await info.attach(`${width}-globe`, { body: await page.screenshot(), contentType: 'image/png' })
    await openPanel(page, 'fleet')
    await page.locator('[data-testid^=inspect-aircraft-]').first().click()
    const art = page.getByTestId('aircraft-dossier').locator('.aircraft-art')
    await expect(art.getByRole('img')).toBeVisible()
    expect(await art.evaluate((el) => el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1)
    await info.attach(`${width}-aircraft`, { body: await page.screenshot(), contentType: 'image/png' })
    await openPanel(page, 'catalog')
    await info.attach(`${width}-aircraft-catalog`, { body: await page.screenshot(), contentType: 'image/png' })
  })
}

test('globe traffic disappears during rotation and returns on release or cancellation', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('start-jet_age').click()
  await page.evaluate((snapshot) => {
    Object.assign(window.__harness.getState()!, snapshot)
    const route = snapshot.airlines[0]!.routes[0]!
    window.__harness.dispatch({ type: 'set_fare', routeId: route.id, fareLevel: route.fareLevel })
  }, mature)
  await page.getByTestId('map-projection').click()
  await expect(page.getByTestId('globe-land')).toBeVisible()
  const map = page.getByTestId('map'), traffic = page.getByTestId('map-traffic')
  const planes = () => traffic.getAttribute('data-planes').then(Number)
  await expect.poll(planes).toBeGreaterThan(0)
  const box = (await map.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2, { steps: 4 })
  await expect(traffic).toHaveAttribute('data-planes', '0')
  await page.mouse.up()
  await expect.poll(planes).toBeGreaterThan(0)
  await map.dispatchEvent('pointerdown', { pointerId: 91, pointerType: 'touch', clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 })
  await map.dispatchEvent('pointermove', { pointerId: 91, pointerType: 'touch', clientX: box.x + box.width / 2 + 20, clientY: box.y + box.height / 2 })
  await expect(traffic).toHaveAttribute('data-planes', '0')
  await map.dispatchEvent('pointercancel', { pointerId: 91, pointerType: 'touch' })
  await expect.poll(planes).toBeGreaterThan(0)
})

for (const width of [1440,390]) test(`route selection ${width}px accepts a click beside the visible line`, async ({page}) => {
  await page.setViewportSize({width,height:844})
  await page.addInitScript(()=>localStorage.setItem('loadfactor:display:v1',JSON.stringify({celebrations:false})))
  await page.goto('/')
  await page.getByTestId('start-jet_age').click()
  await openPanel(page, 'map')
  await page.evaluate(()=>window.__harness.dispatch({type:'open_route',from:'JFK',to:'ORD',aircraftId:1,frequency:5}))
  const hit=page.locator('.route-hit')
  for(const globe of [false,true]) {
    if(globe) { await page.getByTestId('map-projection').click(); await expect(page.getByTestId('globe-land')).toBeVisible() }
    const p=await hit.evaluate((el)=>{
      const path=el as SVGPathElement, matrix=path.getScreenCTM()!,length=path.getTotalLength(),r=path.ownerSVGElement!.getBoundingClientRect()
      for(let i=3;i<17;i++) {
        const a=path.getPointAtLength(length*i/20).matrixTransform(matrix),b=path.getPointAtLength(length*i/20+1).matrixTransform(matrix)
        const dx=b.x-a.x,dy=b.y-a.y,k=Math.hypot(dx,dy)
        const x=a.x-dy/k*9,y=a.y+dx/k*9
        if(x>r.left+20&&x<r.right-20&&y>r.top+20&&y<r.bottom-20)return{x,y}
      }
      throw new Error('No visible route segment')
    })
    await page.mouse.click(p.x,p.y)
    await expect(page.getByTestId('route-dossier')).toBeVisible()
    await page.keyboard.press('Escape')
  }
})

// ---- The map as a board: framing, key, events, result, keyboard ----------

const quiet = () => localStorage.setItem('loadfactor:display:v1', JSON.stringify({ celebrations: false }))
const centreOf = async (el: Locator) => {
  const b = (await el.boundingBox())!
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}
const inside = (p: { x: number; y: number }, b: { x: number; y: number; width: number; height: number }) =>
  p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height

test('desktop home frames the network clear of the map controls', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.addInitScript(quiet)
  await page.goto('/')
  await page.getByTestId('start-jet_age').click()
  // New careers land on the Desk; these tests are about the map.
  await openPanel(page, 'map')
  const wrap = (await page.getByTestId('map-wrap').boundingBox())!
  const controls = (await page.locator('.map-controls').boundingBox())!
  // The west coast used to sit under the zoom column, cropped off the frame.
  for (const id of ['SFO', 'LAX', 'JFK', 'ORD', 'MIA']) {
    const c = await centreOf(page.getByTestId(`city-${id}`))
    expect(inside(c, wrap), `${id} is inside the frame`).toBe(true)
    expect(inside(c, controls), `${id} is not under the controls`).toBe(false)
  }
  await info.attach('jet_age-home', { body: await page.screenshot(), contentType: 'image/png' })
  // A Singapore airline opens centred on Asia, not pinned to the right edge.
  await page.evaluate(() => window.__harness.newGame('open_skies', 'framing'))
  await openPanel(page, 'map')
  await expect.poll(async () => {
    const sin = await centreOf(page.getByTestId('city-SIN'))
    return (sin.x - wrap.x) / wrap.width
  }).toBeGreaterThan(0.3)
  const sin = await centreOf(page.getByTestId('city-SIN'))
  expect((sin.x - wrap.x) / wrap.width).toBeLessThan(0.85)
  expect(inside(await centreOf(page.getByTestId('city-HND')), wrap), 'Tokyo is on screen').toBe(true)
  await info.attach('open_skies-home', { body: await page.screenshot(), contentType: 'image/png' })
  // The map-colors picker shows its longest option in full.
  const select = page.getByLabel('map colors', { exact: true })
  await select.selectOption('demand')
  expect(await select.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
  const text = await select.evaluate((el) => {
    const s = el as HTMLSelectElement
    const ctx = document.createElement('canvas').getContext('2d')!
    ctx.font = getComputedStyle(s).font
    return { need: ctx.measureText(s.options[s.selectedIndex]!.text).width, have: s.clientWidth }
  })
  expect(text.need, 'Unserved demand fits its select').toBeLessThan(text.have - 16)
})

test('the ownership key names every network in its map color', async ({ page }) => {
  await page.addInitScript(quiet)
  await page.goto('/')
  await page.getByTestId('start-jet_age').click()
  // New careers land on the Desk; these tests are about the map.
  await openPanel(page, 'map')
  await page.evaluate(() => { window.__harness.endQuarter(); window.__harness.endQuarter() })
  const key = page.getByTestId('map-ownership-key')
  await expect(key).toContainText('Meridian Air (you)')
  await expect(key).toContainText('Albion Airways')
  // The swatch is the very color of that airline's arcs.
  const swatch = await key.locator('.owner', { hasText: 'Albion Airways' }).locator('.owner-swatch').evaluate((el) => getComputedStyle(el).backgroundColor)
  const arc = await page.locator('.route-rival.rival-c0').first().evaluate((el) => getComputedStyle(el).stroke)
  expect(swatch).toBe(arc)
  await page.getByLabel('map colors', { exact: true }).selectOption('load')
  await expect(key).toHaveCount(0)
})

test('a world event gets a legend line and a bounded number of halos', async ({ page }) => {
  await page.addInitScript(quiet)
  await page.goto('/')
  await page.getByTestId('start-jet_age').click()
  // New careers land on the Desk; these tests are about the map.
  await openPanel(page, 'map')
  await expect(page.getByTestId('map-event-legend')).toHaveCount(0)
  await page.evaluate(() => {
    const s = window.__harness.getState()!
    s.world.events.push({ id: 'tourism_wave', quartersLeft: 2, city: null, region: 'na' })
    const idle = s.airlines[0]!.fleet.find((a) => a.routeId === null)!
    window.__harness.dispatch({ type: 'open_route', from: 'JFK', to: 'ORD', aircraftId: idle.id, frequency: 5 })
  })
  await expect(page.getByTestId('map-event-legend')).toContainText('Tourism wave · North America')
  // World zoom: one labeled region, not a ring on every North American city.
  await expect(page.getByTestId('event-region-na')).toHaveCount(1)
  await expect(page.getByTestId('event-region-na')).toContainText('Tourism wave')
  expect(await page.locator('[data-testid^="event-halo-"]').count()).toBe(0)
  // Close up, individual rings — only for the region's biggest markets.
  for (let i = 0; i < 3; i++) await page.getByTestId('zoom-in').click()
  await expect(page.getByTestId('event-region-na')).toHaveCount(0)
  await expect.poll(() => page.locator('[data-testid^="event-halo-"]').count()).toBeGreaterThan(0)
  expect(await page.locator('[data-testid^="event-halo-"]').count()).toBeLessThanOrEqual(6)
})

test('the map shows the quarter result once the report closes', async ({ page }) => {
  await page.addInitScript(quiet)
  await page.goto('/')
  await page.getByTestId('start-jet_age').click()
  // New careers land on the Desk; these tests are about the map.
  await openPanel(page, 'map')
  await page.evaluate(() => {
    const s = window.__harness.getState()!
    const [a, b] = s.airlines[0]!.fleet.filter((ac) => ac.routeId === null)
    window.__harness.dispatch({ type: 'open_route', from: 'JFK', to: 'ORD', aircraftId: a!.id, frequency: 5 })
    window.__harness.dispatch({ type: 'open_route', from: 'JFK', to: 'MIA', aircraftId: b!.id, frequency: 5 })
  })
  await flyQuarter(page)
  await expect(page.getByTestId('report-card')).toBeVisible()
  // Nothing flashes behind the report...
  await page.waitForTimeout(600)
  await expect(page.getByTestId('map-quarter-result')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('report-card')).toHaveCount(0)
  // ...then every flown route shows which way its profit went.
  await expect(page.getByTestId('map-quarter-result')).toBeVisible()
  await expect(page.getByTestId('map-quarter-result')).toContainText('Last quarter')
  await expect.poll(() => page.locator('.route-result-up, .route-result-down').count()).toBeGreaterThan(0)
  // And it is transient.
  await expect(page.getByTestId('map-quarter-result')).toHaveCount(0, { timeout: 8000 })
  await expect(page.locator('.route-result-up, .route-result-down')).toHaveCount(0)
})

test('keyboard: one tab stop, arrows walk the airports, Enter opens one', async ({ page }) => {
  await page.addInitScript(quiet)
  await page.goto('/')
  await page.getByTestId('start-jet_age').click()
  // New careers land on the Desk; these tests are about the map.
  await openPanel(page, 'map')
  await expect(page.getByTestId('map')).toHaveAttribute('role', 'application')
  // A roving tabindex: one airport is in the tab order, the rest are not.
  await expect(page.locator('svg.map [data-city][tabindex="0"]')).toHaveCount(1)
  expect(await page.locator('svg.map [data-city][tabindex="-1"]').count()).toBeGreaterThan(20)
  // Shift+Tab back from the first map control lands on it: the HQ.
  await page.getByTestId('zoom-in').focus()
  await page.keyboard.press('Shift+Tab')
  const focused = page.locator('svg.map [data-city]:focus')
  await expect(focused).toHaveAttribute('data-city', 'JFK')
  await expect(focused).toHaveAttribute('role', 'button')
  await expect(focused).toHaveAttribute('aria-label', /New York.*\(JFK\).*your headquarters/)
  // Arrow west: the next airport along, and it takes the tab stop with it.
  await page.keyboard.press('ArrowLeft')
  await expect(focused).not.toHaveAttribute('data-city', 'JFK')
  const next = (await focused.getAttribute('data-city'))!
  await expect(page.locator(`svg.map [data-city="${next}"]`)).toHaveAttribute('tabindex', '0')
  await expect(page.locator('svg.map [data-city="JFK"]')).toHaveAttribute('tabindex', '-1')
  // + zooms with the map focused; the airport keeps focus.
  const before = await page.getByTestId('map-wrap').getAttribute('data-view')
  await page.keyboard.press('+')
  await expect.poll(() => page.getByTestId('map-wrap').getAttribute('data-view')).not.toBe(before)
  await expect(focused).toHaveAttribute('data-city', next)
  // Enter opens the airport's panel.
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('city-panel')).toBeVisible()
  const name = (await page.locator(`svg.map [data-city="${next}"]`).getAttribute('aria-label'))!.split(' (')[0]!
  await expect(page.getByTestId('city-panel').locator('h2')).toContainText(name)
})
