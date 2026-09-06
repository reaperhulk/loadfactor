import { expect, test } from '@playwright/test'
import { openPanel } from './workspace'

for (const [width, height] of [
  [1440, 900],
  [390, 844],
]) {
  test(`operations ${width}px: reserve policy, check scheduling, forecasts and reports`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: width!, height: height! })
    await page.addInitScript(() =>
      localStorage.setItem('loadfactor:display:v1', JSON.stringify({ celebrations: false })),
    )
    await page.goto('/')
    await page.getByTestId('start-jet_age').click()
    await page.evaluate(() =>
      window.__harness.dispatch({ type: 'open_route', from: 'JFK', to: 'ORD', aircraftId: 1, frequency: 16 }),
    )
    const skip = page.getByRole('button', { name: /skip/i })
    if (await skip.isVisible()) await skip.click()
    await openPanel(page, 'fleet')
    await page.getByText('Fleet policy & actions', { exact: true }).click()
    await page.getByRole('combobox', { name: 'Reserve hours', exact: true }).selectOption('1000')
    await page.getByRole('checkbox', { name: 'Paid recovery', exact: true }).check()
    await expect(page.getByTestId('operations-pools')).toContainText('JFK')
    await expect(page.getByTestId('fleet-policy')).not.toContainText('One quarter offline')
    expect(await page.evaluate(() => window.__harness.getState()!.airlines[0]!.operationsPolicy)).toEqual({
      reserveBp: 1000,
      recovery: true,
    })
    await info.attach(`${width}-operations-policy`, {
      body: await page.screenshot({ animations: 'disabled' }),
      contentType: 'image/png',
    })
    await page.getByTestId('inspect-aircraft-1').click()
    const dossier = page.getByTestId('aircraft-dossier')
    await dossier.getByRole('combobox', { name: 'Check start week', exact: true }).selectOption('4')
    await dossier.getByRole('button', { name: /Book check/ }).click()
    await expect(dossier.getByTestId('aircraft-readiness')).toContainText('Check booked · week 5')
    await expect(dossier.getByTestId('aircraft-readiness')).toContainText('7 days')
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(
      1,
    )
    await info.attach(`${width}-aircraft-check`, { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' })
    await dossier.getByRole('button', { name: 'Cancel check booking', exact: true }).click()
    await expect(dossier.getByRole('button', { name: /Book check/ })).toBeVisible()
    await dossier.getByRole('button', { name: /Book check/ }).click()
    await page.keyboard.press('Escape')
    await page.getByTestId('end-quarter').click()
    const review = page.getByTestId('quarter-review')
    await expect(review.getByTestId('operations-summary')).toContainText('Planned operations')
    await expect(review.getByTestId('operations-adverse')).toBeVisible()
    await review.getByTestId('operations-route-detail').locator('summary').click()
    await expect(review.getByTestId('operations-route-detail')).toContainText('JFK–ORD')
    await info.attach(`${width}-operations-review`, {
      body: await page.screenshot({ animations: 'disabled' }),
      contentType: 'image/png',
    })
    await page.getByTestId('confirm-quarter').click()
    // Celebration preferences are independent of mechanics; finish it if the
    // user's default display settings were active in this browser context.
    if (await skip.isVisible()) await skip.click()
    await expect(page.getByTestId('report-card').getByTestId('operations-summary')).toContainText(
      'Operations this quarter',
    )
    const stats = await page.evaluate(
      () => window.__harness.getState()!.airlines[0]!.history.at(-1)!.operations!,
    )
    expect(stats.completedTrips + stats.cancelledTrips).toBe(stats.scheduledTrips)
    expect(stats.checkCost).toBeGreaterThan(0)
    await info.attach(`${width}-operations-report`, {
      body: await page.screenshot({ animations: 'disabled' }),
      contentType: 'image/png',
    })
    await page.reload()
    await page.getByTestId('continue-save').click()
    await expect
      .poll(() => page.evaluate(() => window.__harness.getState()?.airlines[0]?.operationsPolicy?.reserveBp))
      .toBe(1000)
  })
}
