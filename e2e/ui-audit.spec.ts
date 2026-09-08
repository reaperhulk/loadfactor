import { expect, test, type Locator, type Page } from '@playwright/test'
import { openPanel } from './workspace'

async function inside(control: Locator, page: Page) {
  const rect = await control.boundingBox(), viewport = page.viewportSize()!
  expect(rect).not.toBeNull()
  expect(rect!.x).toBeGreaterThanOrEqual(-1)
  expect(rect!.y).toBeGreaterThanOrEqual(-1)
  expect(rect!.x + rect!.width).toBeLessThanOrEqual(viewport.width + 1)
  expect(rect!.y + rect!.height).toBeLessThanOrEqual(viewport.height + 1)
  expect(await control.evaluate(el => {
    const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.x+r.width/2, r.y+r.height/2)
    return hit === el || el.contains(hit)
  }), 'control is not covered').toBe(true)
}

for (const [width, height] of [[390,844], [1366,768]]) {
  test(`UI audit first flight ${width}px: starter and a real route launch`, async ({ page }) => {
    await page.setViewportSize({width:width!, height:height!})
    await page.goto('/')
    await inside(page.getByTestId('start-first-career'), page)
    await page.getByTestId('seed-input').fill('audit-first-flight')
    await page.getByTestId('airline-name').fill('Audit Air')
    await page.getByTestId('start-first-career').click()
    await expect(page.getByRole('heading', {name:'Audit Air'})).toBeVisible()
    await page.getByRole('button', {name:'Compare first routes'}).click()
    await expect(page.getByTestId('tab-desk')).toHaveClass(/active/)
    await page.getByRole('button', {name:'Compare this launch'}).first().click()
    await page.getByTestId('route-setup-confirm').click()
    await openPanel(page, 'map')
    await expect(page.getByTestId('first-flight')).toHaveCount(0)
    expect(await page.evaluate(() => window.__harness.getState()!.airlines[0]!.routes.length)).toBe(1)
  })
}

for (const [width,height] of [[320,568],[667,375],[844,390],[768,1024],[1024,768],[1366,768]] as const) {
  test(`UI audit viewport ${width}x${height}: navigation and content stay reachable`, async ({page}, info) => {
    await page.setViewportSize({width,height})
    await page.goto('/')
    await page.getByTestId('start-jet_age').click()
    await expect(page.getByTestId('map')).toBeVisible()
    expect((await page.getByTestId('map').boundingBox())!.height).toBeGreaterThan(150)
    for(const panel of ['desk','routes','fleet','catalog','finance']) {
      await openPanel(page,panel)
      for(const id of ['nav-desk','nav-network','nav-fleet','nav-company','end-quarter','open-settings','cash']) await inside(page.getByTestId(id),page)
      expect(await page.evaluate(()=>({x:document.documentElement.scrollWidth-innerWidth,y:document.documentElement.scrollHeight-innerHeight}))).toEqual({x:0,y:0})
      if(panel==='desk') await info.attach(`${width}x${height}-desk`,{body:await page.screenshot(),contentType:'image/png'})
    }
    await page.getByTestId('open-settings').click()
    await page.getByTestId('display-settings').locator('summary').click()
    await page.getByLabel('text size',{exact:true}).selectOption('125')
    await page.getByRole('button',{name:'Close settings',exact:true}).click()
    await openPanel(page,'fleet')
    for(const id of ['nav-desk','nav-network','nav-fleet','nav-company','end-quarter']) await inside(page.getByTestId(id),page)
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBe(0)
  })
}

test('UI audit touch controls: setup, header and settings have usable targets',async({page,isMobile})=>{
  test.skip(!isMobile,'Uses the actual mobile WebKit device profile')
  await page.goto('/')
  for(const id of ['livery-4fa3ff','airline-name','airline-hq']) {
    const box=await page.getByTestId(id).boundingBox()
    expect(box!.height).toBeGreaterThanOrEqual(44)
  }
  await page.getByTestId('start-jet_age').click()
  for(const id of ['open-inbox','open-settings']) {
    const box=await page.getByTestId(id).boundingBox()
    expect(box!.width).toBeGreaterThanOrEqual(44)
    expect(box!.height).toBeGreaterThanOrEqual(44)
  }
  await page.getByTestId('open-settings').click()
  await page.getByTestId('display-settings').locator('summary').click()
  expect(await page.getByLabel('text size',{exact:true}).evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16)
})

test('UI audit keyboard: disclosures, dialog focus and inspector return',async({page})=>{
  await page.goto('/')
  await page.getByTestId('start-jet_age').click()
  await openPanel(page,'desk')
  const calendar=page.getByTestId('world-outlook')
  await calendar.locator('summary').focus()
  await page.keyboard.press(' ')
  await expect(calendar).toHaveAttribute('open','')
  await expect(page.getByTestId('quarter-review')).toHaveCount(0)
  await page.getByTestId('open-settings').click()
  const dialog=page.getByTestId('settings-dialog')
  await expect(page.getByTestId('workspace')).toHaveAttribute('inert','')
  const display=page.getByTestId('display-settings').locator('summary')
  await display.focus()
  await page.keyboard.press(' ')
  await expect(page.getByLabel('text size',{exact:true})).toBeVisible()
  await page.getByRole('button',{name:'Open handbook',exact:true}).focus()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button',{name:'Close settings',exact:true})).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(page.getByTestId('open-settings')).toBeFocused()
  await expect(page.getByTestId('workspace')).not.toHaveAttribute('inert','')
  await openPanel(page,'fleet')
  const aircraft=page.locator('[data-testid^=inspect-aircraft-]').first()
  await aircraft.click()
  await page.keyboard.press('Escape')
  await expect(aircraft).toBeFocused()
  await page.getByTestId('end-quarter').click()
  await page.getByTestId('confirm-quarter').click()
  await expect(page.getByTestId('report-hero')).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(page.getByTestId('report-card-close')).toBeFocused()
  await page.keyboard.press('Tab')
  expect(await page.evaluate(()=>!!document.activeElement?.closest('[data-testid=report-card]'))).toBe(true)
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('end-quarter')).toBeFocused()
})
