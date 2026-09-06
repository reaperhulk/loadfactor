import { expect, test } from '@playwright/test'
import { openPanel } from './workspace'
import { readFileSync } from 'node:fs'
import type { GameState } from '../src/engine'

// Fault injection must reach the page's requests rather than a service-worker fetch.
// Offline/cache behavior has its own tests; these exercise the lazy loader.
test.use({ serviceWorkers: 'block' })

test('globe geometry loads on demand while the flat map remains usable', async ({ page }) => {
  const requests: string[] = []
  page.on('request', (request) => { if (/globemap\.gen-.*\.js/.test(request.url())) requests.push(request.url()) })
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  await page.route('**/globemap.gen-*.js', async (route) => { await held; await route.continue() })
  await page.goto('/')
  await page.getByTestId('start-jet_age').click()
  await expect(page.getByTestId('map')).toBeVisible()
  expect(requests).toHaveLength(0)
  await openPanel(page, 'fleet')
  await page.keyboard.press('g')
  await openPanel(page, 'map')
  expect(requests).toHaveLength(0)
  await page.getByTestId('map-projection').click()
  await expect(page.getByRole('status')).toContainText('Loading globe')
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
  await page.route('**/globemap.gen-*.js', async (route) => {
    if (++attempts === 1) await route.abort()
    else await route.continue()
  })
  await page.goto('/')
  await page.getByTestId('start-jet_age').click()
  await expect(page.getByTestId('map')).toBeVisible()
  await page.getByTestId('map-projection').click()
  await expect(page.getByRole('status')).toContainText('Globe unavailable')
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
