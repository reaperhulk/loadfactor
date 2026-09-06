import type { Page } from '@playwright/test'

export async function openPanel(page: Page, panel: string) {
  const area = panel === 'desk' ? 'desk' : ['map', 'routes', 'airports'].includes(panel) ? 'network' : ['fleet', 'orders', 'catalog'].includes(panel) ? 'fleet' : 'company'
  await page.getByTestId(`nav-${area}`).click()
  await page.getByTestId(`tab-${panel}`).click()
}

export async function flyQuarter(page: Page) {
  await page.getByTestId('end-quarter').click()
  await page.getByTestId('confirm-quarter').click()
}
