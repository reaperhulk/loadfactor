import { expect, test, type Locator, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import type { GameState } from '../src/engine'
import { openPanel } from './workspace'

async function inside(control: Locator, page: Page) {
  await expect(control).toBeVisible()
  // Opening cards animate: wait for usable geometry instead of depending on
  // the runner sampling one particular frame of the entrance transition.
  await expect.poll(async () => {
    const rect = await control.boundingBox(), viewport = page.viewportSize()!
    return {
      inside: !!rect && rect.x >= -1 && rect.y >= -1 && rect.x + rect.width <= viewport.width + 1 && rect.y + rect.height <= viewport.height + 1,
      unobstructed: await control.evaluate(el => {
        const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.x+r.width/2, r.y+r.height/2)
        return hit === el || el.contains(hit)
      }),
    }
  }, {message:'Control stays inside the viewport and can be reached'}).toEqual({inside:true,unobstructed:true})
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
    for(const id of ['zoom-in','zoom-out','zoom-reset','map-projection','toggle-rivals']) await inside(page.getByTestId(id),page)
    for(const panel of ['desk','routes','fleet','catalog','finance']) {
      await openPanel(page,panel)
      for(const id of ['nav-desk','nav-network','nav-fleet','nav-company','end-quarter','open-settings','cash']) await inside(page.getByTestId(id),page)
      expect(await page.evaluate(()=>({x:document.documentElement.scrollWidth-innerWidth,y:document.documentElement.scrollHeight-innerHeight}))).toEqual({x:0,y:0})
      if(panel==='desk') await info.attach(`${width}x${height}-desk`,{body:await page.screenshot({animations:'disabled'}),contentType:'image/png'})
    }
    await page.getByTestId('open-settings').click()
    await page.getByTestId('display-settings').locator('summary').click()
    await page.getByLabel('text size',{exact:true}).selectOption('125')
    const settings=page.getByTestId('settings-dialog').locator('.settings-scroll')
    await expect.poll(()=>settings.evaluate(el=>el.scrollWidth-el.clientWidth),{message:'Enlarged settings fit without horizontal scrolling'}).toBeLessThanOrEqual(1)
    await settings.evaluate(el=>{el.scrollTop=el.scrollHeight})
    await inside(page.getByRole('button',{name:'Close settings',exact:true}),page)
    await info.attach(`${width}x${height}-settings-125`,{body:await page.screenshot({animations:'disabled'}),contentType:'image/png'})
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
  await page.getByTestId('nav-network').evaluate(el=>(el as HTMLElement).focus())
  expect(await page.evaluate(()=>!!document.activeElement?.closest('[data-testid=settings-dialog]'))).toBe(true)
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
  await page.getByTestId('nav-network').focus()
  await expect(page.getByTestId('nav-network')).toBeFocused()
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


const comparisonCareer = JSON.parse(readFileSync(new URL('./fixtures/density-career.json', import.meta.url), 'utf8')) as GameState
for(const width of [320,390,1366]) {
  test(`UI audit comparisons ${width}px: city search, empty results and pinned metrics`,async({page},info)=>{
    await page.setViewportSize({width,height:width<700 ? 844 : 768})
    await page.goto('/')
    await page.getByTestId('start-jet_age').click()
    await page.evaluate(snapshot=>{
      Object.assign(window.__harness.getState()!,snapshot)
      const route=snapshot.airlines[0]!.routes[0]!
      window.__harness.dispatch({type:'set_fare',routeId:route.id,fareLevel:route.fareLevel})
    },comparisonCareer)
    await openPanel(page,'routes')
    const before=await page.evaluate(()=>structuredClone(window.__harness.getState()))
    await page.getByTestId('route-search').fill('New York')
    const rows=page.getByTestId('routes-panel-table').locator('tbody tr')
    expect(await rows.count()).toBeGreaterThan(0)
    for(const row of await rows.all()) await expect(row).toContainText('JFK')
    await page.getByTestId('route-search').fill('airport-does-not-exist')
    await expect(page.getByTestId('route-search-results')).toContainText('No matching routes')
    await page.getByRole('button',{name:'Clear route filters',exact:true}).click()
    await expect(page.getByTestId('route-search')).toBeFocused()
    await expect(rows).toHaveCount(comparisonCareer.airlines[0]!.routes.length)
    await page.getByTestId('sort-load').click()
    await expect(page.getByTestId('sort-load').locator('..')).toHaveAttribute('aria-sort','descending')
    await info.attach(`${width}-route-comparison`,{body:await page.screenshot({animations:'disabled'}),contentType:'image/png'})
    await page.getByRole('button',{name:'Show all metrics',exact:true}).click()
    const metrics=page.getByRole('region',{name:'All route metrics'})
    await metrics.scrollIntoViewIfNeeded()
    const firstCell=rows.first().locator('td').first()
    const initialX=(await firstCell.boundingBox())!.x
    await metrics.evaluate(el=>{ el.scrollLeft=350 })
    expect(Math.abs((await firstCell.boundingBox())!.x-initialX)).toBeLessThanOrEqual(1)
    await metrics.focus()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByTestId('tab-routes')).toHaveClass(/active/)
    expect(await page.evaluate(()=>window.__harness.getState())).toEqual(before)
    await openPanel(page,'fleet')
    await page.getByLabel('Find aircraft',{exact:true}).fill('no such aircraft')
    await expect(page.getByTestId('page-fleet')).toContainText('No matching aircraft')
    await page.getByRole('button',{name:'Clear aircraft filters',exact:true}).click()
    await expect(page.getByTestId('fleet-table').locator('tbody tr')).toHaveCount(comparisonCareer.airlines[0]!.fleet.length)
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBe(0)
  })
}

for(const [width,height] of [[320,568],[667,375],[1366,768]] as const) {
  test(`UI audit review ${width}x${height}: actions stay visible while forecasts scroll`,async({page},info)=>{
    await page.setViewportSize({width,height})
    await page.goto('/')
    await page.getByTestId('start-jet_age').click()
    await openPanel(page,'desk')
    await page.getByRole('button',{name:'Compare this launch'}).first().click()
    const launch=page.getByTestId('route-setup')
    for(const id of ['route-setup-confirm','route-setup-cancel']) await inside(page.getByTestId(id),page)
    await launch.locator('.dialog-scroll').evaluate(el=>{el.scrollTop=el.scrollHeight})
    await inside(page.getByTestId('route-setup-confirm'),page)
    await page.getByTestId('route-setup-confirm').click()
    await page.getByTestId('end-quarter').click()
    await expect(page.getByTestId('review-cash-bridge')).toBeVisible()
    await inside(page.getByTestId('confirm-quarter'),page)
    await page.getByTestId('quarter-review').locator('.dialog-scroll').evaluate(el=>{el.scrollTop=el.scrollHeight})
    await inside(page.getByTestId('confirm-quarter'),page)
    await inside(page.getByRole('button',{name:'Close quarter review',exact:true}),page)
    await info.attach(`${width}x${height}-quarter-review`,{body:await page.screenshot({animations:'disabled'}),contentType:'image/png'})
    await page.getByTestId('confirm-quarter').click()
    await expect(page.getByTestId('report-hero')).toBeFocused()
    await inside(page.getByTestId('report-card-close'),page)
    await page.getByTestId('report-card').locator('.dialog-scroll').evaluate(el=>{el.scrollTop=el.scrollHeight})
    await inside(page.getByTestId('report-card-close'),page)
    await page.getByTestId('report-card-close').click()
    await expect(page.getByTestId('date')).toHaveText('1960 Q2')
  })
}


test('UI audit career ending: the final screen stays interactive over the report',async({page})=>{
  await page.goto('/')
  await page.getByTestId('seed-input').fill('audit-career-ending')
  await page.getByTestId('start-jet_age').click()
  await page.evaluate(()=>{
    for(let i=0;i<40;i++) {
      const state=window.__harness.getState()!
      if(state.phase !== 'planning' || state.airlines[0]!.insolventQuarters > 0) break
      window.__harness.endQuarter()
    }
  })
  expect(await page.evaluate(()=>window.__harness.getState()!.phase)).toBe('planning')
  await page.getByTestId('end-quarter').click()
  await page.getByTestId('confirm-quarter').click()
  await expect(page.getByTestId('gameover-overlay')).toBeVisible()
  await page.getByTestId('new-game').click()
  await expect(page.getByTestId('start-first-career')).toBeVisible()
})
