import { expect, test, type Locator, type Page } from '@playwright/test'
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

// ---- Readability: names, colours, framing, globe arcs, pan cost ----------

const loadMature = async (page: Page) => {
  await page.evaluate((snapshot) => {
    Object.assign(window.__harness.getState()!, snapshot)
    const route = snapshot.airlines[0]!.routes[0]!
    window.__harness.dispatch({ type: 'set_fare', routeId: route.id, fareLevel: route.fareLevel })
  }, mature)
}
type Rect = { left: number; top: number; right: number; bottom: number }
const labelRects = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('svg.map text.city-label')].map((t) => {
      const r = t.getBoundingClientRect()
      return { id: t.textContent!, left: r.left, top: r.top, right: r.right, bottom: r.bottom }
    }),
  )
const overlapping = (a: Rect, b: Rect, slack = 0.5) =>
  a.left < b.right - slack && a.right > b.left + slack && a.top < b.bottom - slack && a.bottom > b.top + slack

test('city names never overlap at world zoom', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.addInitScript(quiet)
  await page.goto('/')
  await page.getByTestId('start-jet_age').click()
  await loadMature(page)
  await openPanel(page, 'map')
  await page.getByTestId('zoom-reset').click()
  await expect(page.getByTestId('map-wrap')).toHaveAttribute('data-zoom', 'world')
  await page.waitForTimeout(400)
  const labels = await labelRects(page)
  expect(labels.length, 'the world view still names its airports').toBeGreaterThan(15)
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      expect(overlapping(labels[i]!, labels[j]!), `${labels[i]!.id} overlaps ${labels[j]!.id}`).toBe(false)
    }
  }
  // The HQ is always named.
  expect(labels.map((l) => l.id)).toContain('JFK')
  await info.attach('world-labels', { body: await page.screenshot(), contentType: 'image/png' })
})

test('the ownership key leads with the player; rivals read at world zoom', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.addInitScript(quiet)
  await page.goto('/')
  await page.getByTestId('start-jet_age').click()
  await loadMature(page)
  await openPanel(page, 'map')
  const owners = page.getByTestId('map-ownership-key').locator('.owner')
  await expect(owners.first()).toHaveClass(/\byou\b/)
  await expect(owners.first()).toContainText('(you)')
  expect(await owners.count()).toBeGreaterThan(1)
  await expect(page.getByTestId('map-wrap')).toHaveAttribute('data-zoom', 'world')
  const rival = await page.locator('.route-rival').first().evaluate((el) => {
    const s = getComputedStyle(el)
    return { opacity: Number(s.opacity), width: parseFloat(s.strokeWidth) }
  })
  expect(rival.opacity, 'rival arcs are visible at world zoom').toBeGreaterThanOrEqual(0.7)
  const players = await page.locator('.route-player').evaluateAll((els) => els.map((el) => parseFloat(getComputedStyle(el).strokeWidth)))
  // The player's thinnest route is no lighter than a typical rival's.
  expect(Math.min(...players)).toBeGreaterThanOrEqual(rival.width - 0.4)
})

test('metric lenses use the colour-blind-safe scale, with a steady key', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.addInitScript(quiet)
  await page.goto('/')
  await page.getByTestId('start-jet_age').click()
  await loadMature(page)
  await openPanel(page, 'map')
  const control = page.locator('.map-data-control')
  const select = page.getByLabel('map colors', { exact: true })
  const geometry = async () => {
    const box = (await control.boundingBox())!
    const s = (await select.boundingBox())!
    return { x: Math.round(box.x), width: Math.round(box.width), selectX: Math.round(s.x) }
  }
  const home = await geometry()
  for (const lens of ['load', 'profit', 'season', 'demand', 'none']) {
    await select.selectOption(lens)
    // The key's box keeps its width and the picker does not move.
    expect(await geometry(), `${lens} keeps the key in place`).toEqual(home)
  }
  const palette = { good: 'rgb(124, 185, 255)', mid: 'rgb(227, 221, 207)', bad: 'rgb(255, 154, 60)' }
  for (const lens of ['load', 'profit', 'season']) {
    await select.selectOption(lens)
    const key = page.getByTestId('map-data-legend')
    for (const [bucket, rgb] of Object.entries(palette)) {
      // The swatch is drawn in the bucket's colour...
      const swatch = await key.locator(`.lens-key-${bucket} line`).evaluate((el) => getComputedStyle(el).stroke)
      expect(swatch, `${lens} ${bucket} swatch`).toBe(rgb)
      // ...which is the colour of that bucket's arcs, when the network has any.
      const arcs = page.locator(`.route-player.lens-${bucket}`)
      if ((await arcs.count()) > 0) expect(await arcs.first().evaluate((el) => getComputedStyle(el).stroke)).toBe(rgb)
    }
    // No red/green left in the lens.
    const strokes = await page.locator('.route-player').evaluateAll((els) => els.map((el) => getComputedStyle(el).stroke))
    for (const s of strokes) expect(['rgb(79, 174, 98)', 'rgb(208, 99, 110)']).not.toContain(s)
    await info.attach(`lens-${lens}`, { body: await page.screenshot(), contentType: 'image/png' })
  }
  // A loss is more than a colour: the loss bucket is dotted and wider.
  const bad = await page.evaluate(() => {
    const probe = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    probe.setAttribute('class', 'route-player lens-bad')
    probe.setAttribute('style', '--cap-w: 1.6')
    document.querySelector('svg.map .map-pan')!.appendChild(probe)
    const s = getComputedStyle(probe)
    const out = { dash: s.strokeDasharray, width: parseFloat(s.strokeWidth) }
    probe.remove()
    return out
  })
  expect(bad.dash).not.toBe('none')
  expect(bad.width).toBeGreaterThan(1.6)
})

for (const [width, height] of [[390, 844], [320, 568]] as const) {
  test(`a ${width}px portrait phone opens with the HQ fully on the map`, async ({ page }, info) => {
    await page.setViewportSize({ width, height })
    await page.addInitScript(quiet)
    await page.goto('/')
    await page.getByTestId('start-jet_age').click()
    await loadMature(page)
    await openPanel(page, 'map')
    await page.getByTestId('zoom-reset').click()
    await page.waitForTimeout(500)
    const wrap = (await page.getByTestId('map-wrap').boundingBox())!
    const dot = (await page.getByTestId('city-JFK').boundingBox())!
    const label = (await page.locator('svg.map text.city-label', { hasText: 'JFK' }).boundingBox())!
    for (const [name, b] of [['marker', dot], ['name', label]] as const) {
      expect(b.x, `JFK ${name} inside the left edge`).toBeGreaterThanOrEqual(wrap.x)
      expect(b.x + b.width, `JFK ${name} inside the right edge`).toBeLessThanOrEqual(wrap.x + wrap.width)
      expect(b.y, `JFK ${name} inside the top`).toBeGreaterThanOrEqual(wrap.y)
      expect(b.y + b.height, `JFK ${name} inside the bottom`).toBeLessThanOrEqual(wrap.y + wrap.height)
    }
    // Clear of the map's own chrome: the zoom column and the colours box.
    const centre = { x: dot.x + dot.width / 2, y: dot.y + dot.height / 2 }
    for (const sel of ['.map-controls', '.map-data-control']) {
      const c = (await page.locator(sel).boundingBox())!
      expect(inside(centre, c), `JFK is not under ${sel}`).toBe(false)
    }
    await info.attach(`phone-${width}`, { body: await page.screenshot(), contentType: 'image/png' })
  })
}

test('globe routes are great-circle arcs, not chords', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.addInitScript(quiet)
  await page.goto('/')
  await page.getByTestId('start-jet_age').click()
  await loadMature(page)
  await openPanel(page, 'map')
  await page.getByTestId('map-projection').click()
  await expect(page.getByTestId('globe-land')).toBeVisible()
  const arcs = await page.locator('.route-player').evaluateAll((els) =>
    els.map((el) => {
      const path = el as SVGPathElement
      const d = path.getAttribute('d') ?? ''
      const segments = (d.match(/L/g) ?? []).length
      const len = path.getTotalLength()
      if (len < 40) return { segments, bow: null }
      const a = path.getPointAtLength(0)
      const b = path.getPointAtLength(len)
      let bow = 0
      for (let i = 1; i < 20; i++) {
        const p = path.getPointAtLength((len * i) / 20)
        bow = Math.max(bow, Math.abs((p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x)) / Math.hypot(b.x - a.x, b.y - a.y))
      }
      return { segments, bow }
    }),
  )
  const drawn = arcs.filter((a) => a.segments > 0)
  expect(drawn.length).toBeGreaterThan(5)
  for (const arc of drawn) expect(arc.segments, 'an arc is many points, not a chord').toBeGreaterThan(2)
  // Long routes visibly bow off their chords. (Not every one: a route that
  // runs straight out from the disc's centre is lifted toward the viewer and
  // is seen end-on, as it would be on a real globe.)
  const bows = drawn.filter((a) => a.bow !== null).map((a) => a.bow!).sort((a, b) => a - b)
  expect(bows.length).toBeGreaterThan(2)
  expect(bows[Math.floor(bows.length / 2)]!, 'the typical long route is a curve').toBeGreaterThan(2)
  await info.attach('globe-arcs', { body: await page.screenshot(), contentType: 'image/png' })
})

test('a drag moves the traffic canvas without redrawing it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.addInitScript(() => localStorage.setItem('loadfactor:display:v1', JSON.stringify({ celebrations: false, motion: 'full' })))
  await page.goto('/')
  await page.getByTestId('start-jet_age').click()
  await loadMature(page)
  await openPanel(page, 'map')
  const traffic = page.getByTestId('map-traffic')
  await expect.poll(() => traffic.getAttribute('data-planes').then(Number)).toBeGreaterThan(0)
  await page.evaluate(() => {
    const w = window as unknown as { __clears: number }
    w.__clears = 0
    const clear = CanvasRenderingContext2D.prototype.clearRect
    CanvasRenderingContext2D.prototype.clearRect = function (...args: Parameters<typeof clear>) {
      w.__clears++
      return clear.apply(this, args)
    }
  })
  await page.getByTestId('zoom-in').click()
  await page.waitForTimeout(800)
  const box = (await page.getByTestId('map').boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 20, y, { steps: 2 })
  const frame = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))))
  await frame()
  await page.evaluate(() => { (window as unknown as { __clears: number }).__clears = 0 })
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(x + 20 + i * 8, y + i * 2)
    await frame()
  }
  // The planes ride along on a transform; the bitmap is not redrawn.
  expect(await traffic.evaluate((el) => (el as HTMLElement).style.transform)).toContain('translate3d')
  expect(await page.evaluate(() => (window as unknown as { __clears: number }).__clears)).toBe(0)
  await page.mouse.up()
  // Released: the clock runs again and the canvas draws in place.
  await expect.poll(() => traffic.evaluate((el) => (el as HTMLElement).style.transform)).toBe('')
  await expect.poll(() => page.evaluate(() => (window as unknown as { __clears: number }).__clears)).toBeGreaterThan(0)
})
