import { expect, test } from '@playwright/test'
import { openPanel } from './workspace'

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
