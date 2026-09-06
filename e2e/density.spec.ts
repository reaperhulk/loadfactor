import { expect, test, type Locator, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import type { GameState } from '../src/engine'
import { openPanel } from './workspace'

// A real, deterministic 6-year career: 21 routes and 32 aircraft. This covers
// populated economics and histories without a synthetic pile of duplicate rows.
// Generated with runCareer('jet_age', 'density-career', 'greedy', 24, 2).
const mature = JSON.parse(readFileSync(new URL('./fixtures/density-career.json', import.meta.url), 'utf8')) as GameState
const viewports = [[1366,768],[1440,900],[1920,1080],[768,1024],[1024,768],[360,740],[390,844],[430,932]] as const

async function inside(locator: Locator, page: Page) {
  const b = await locator.boundingBox(), viewport = page.viewportSize()!
  expect(b, `${await locator.getAttribute('data-testid')} has a box`).not.toBeNull()
  expect(b!.x).toBeGreaterThanOrEqual(-1)
  expect(b!.y).toBeGreaterThanOrEqual(-1)
  expect(b!.x+b!.width).toBeLessThanOrEqual(viewport.width+1)
  expect(b!.y+b!.height).toBeLessThanOrEqual(viewport.height+1)
  expect(await locator.evaluate(el=>{
    if(el.tagName!=='BUTTON') return true
    const r=el.getBoundingClientRect(), hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)
    return hit===el || el.contains(hit)
  }),'visible controls are not covered by notifications or other chrome').toBe(true)
}
async function startMature(page: Page) {
  await page.goto('/')
  await page.getByTestId('start-jet_age').click()
  await page.evaluate((snapshot) => {
    Object.assign(window.__harness.getState()!, snapshot)
    window.__harness.getState()!.airlines[0]!.name = 'Intercontinental Air Transport & Regional Services'
    window.__harness.dispatch({type:'set_fare',routeId:snapshot.airlines[0]!.routes[0]!.id,fareLevel:snapshot.airlines[0]!.routes[0]!.fareLevel})
  }, mature)
  await expect(page.getByTestId('map')).toBeVisible()
}
for(const [width,height] of viewports) {
  test(`workspace density ${width}×${height}: chrome, content and inspector return`,async({page},info)=>{
    await page.setViewportSize({width,height})
    await startMature(page)
    for(const panel of ['desk','routes','fleet','catalog','finance']) {
      await openPanel(page,panel)
      // No scrollIntoView: persistent controls must already be on screen.
      for(const id of ['nav-desk','nav-network','nav-fleet','nav-company','end-quarter','cash']) await inside(page.getByTestId(id),page)
      const overflow=await page.evaluate(()=>({x:document.documentElement.scrollWidth-innerWidth,y:document.documentElement.scrollHeight-innerHeight}))
      expect(overflow).toEqual({x:0,y:0})
      if((width===1440||width===390) && ['desk','routes','fleet','catalog'].includes(panel)) await info.attach(`${width}-${panel}`,{body:await page.screenshot(),contentType:'image/png'})
      if(panel==='routes') {
        const table=page.getByTestId('routes-panel-table')
        expect(await table.evaluate(el=>el.getBoundingClientRect().width)).toBeLessThanOrEqual(width)
        await page.getByTestId('route-search').fill('JFK')
        const button=page.locator('[data-testid^=inspect-]').first()
        await button.scrollIntoViewIfNeeded()
        const scroll=await page.getByTestId('page-routes').locator('.split-list').evaluate(el=>el.scrollTop)
        await button.click()
        await inside(page.getByTestId('route-dossier-close'),page)
        await expect(page.getByLabel('Route fare',{exact:true})).toBeVisible()
        const horizontal=await page.getByTestId('route-dossier').evaluate(el=>el.scrollWidth-el.clientWidth)
        expect(horizontal,'route inspector fits').toBeLessThanOrEqual(1)
        await page.getByTestId('route-dossier-close').click()
        await expect(page.getByTestId('route-search')).toHaveValue('JFK')
        expect(await page.getByTestId('page-routes').locator('.split-list').evaluate(el=>el.scrollTop)).toBe(scroll)
        await expect(button).toBeFocused()
      }
      if(panel==='fleet') {
        await page.locator('[data-testid^=inspect-aircraft-]').first().click()
        await inside(page.getByTestId('aircraft-dossier-close'),page)
        expect(await page.getByTestId('aircraft-dossier').evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1)
        await page.getByTestId('aircraft-dossier-close').click()
      }
    }
    await page.getByTestId('end-quarter').click()
    await expect(page.getByTestId('review-cash-bridge')).toBeVisible()
    await page.getByTestId('confirm-quarter').scrollIntoViewIfNeeded()
    await inside(page.getByTestId('confirm-quarter'),page)
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('end-quarter')).toBeFocused()
  })
}

test('route plan previews without mutation and applies with atomic undo',async({page})=>{
  await startMature(page)
  await openPanel(page,'routes')
  await page.locator('[data-testid^=inspect-]').first().click()
  const before=await page.evaluate(()=>structuredClone(window.__harness.getState()!))
  const fare=page.getByLabel('Route fare',{exact:true}),previous=await fare.inputValue()
  await fare.selectOption(previous==='2' ? '-2' : '2')
  await expect(page.getByTestId('route-plan-forecast')).toContainText('Change in company profit')
  expect(await page.evaluate(()=>window.__harness.getState())).toEqual(before)
  await page.getByTestId('end-quarter').click()
  await expect(page.getByTestId('quarter-review')).toContainText('unapplied changes are excluded')
  await page.keyboard.press('Escape')
  await page.getByTestId('apply-route-plan').click()
  await expect(page.getByLabel('Route fare',{exact:true})).toBeFocused()
  expect(await page.evaluate(()=>window.__harness.getState())).not.toEqual(before)
  await page.getByTestId('undo-action').click()
  expect(await page.evaluate(()=>window.__harness.getState())).toEqual(before)
})

test('360px larger text: inputs fit and focused controls remain reachable',async({page})=>{
  await page.setViewportSize({width:360,height:740})
  await page.addInitScript(()=>localStorage.setItem('loadfactor:display:v1',JSON.stringify({text:125,motion:'reduced',traffic:'low'})))
  await startMature(page)
  await openPanel(page,'fleet')
  await page.locator('[data-testid^=inspect-aircraft-]').first().click()
  for(const label of ['Aircraft primary route','replacement type']) {
    const field=page.getByLabel(label,{exact:true})
    await field.focus()
    await inside(field,page)
  }
  expect(await page.getByTestId('aircraft-dossier').evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1)
  for(const id of ['nav-desk','nav-network','nav-fleet','nav-company','end-quarter']) await inside(page.getByTestId(id),page)
})
