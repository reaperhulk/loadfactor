import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { openPanel } from './workspace'
import type { Replay } from '../src/engine'
const replay=JSON.parse(readFileSync(new URL('./fixtures/performance-career.json',import.meta.url),'utf8')) as Replay & {version:1}
interface Recording {frames:number[];longTasks:number[];last:number;request:number;observer?:PerformanceObserver}

for(const [width,height,textSize] of [[1440,900,100],[390,844,100],[768,1024,125],[1366,768,125]] as const) test(`recorded workload ${width}px ${textSize}%: mature planning, globe, memory and save reload`,async({page,browserName},info)=>{
  await page.setViewportSize({width,height})
  await page.addInitScript(({save,textSize})=>{
    if(!localStorage.getItem('loadfactor:save:v1'))localStorage.setItem('loadfactor:save:v1',JSON.stringify(save))
    localStorage.setItem('loadfactor:display:v1',JSON.stringify({motion:'full',text:textSize,celebrations:false,diagnostics:true}))
  },{save:replay,textSize})
  await page.goto('/')
  const metrics:Record<string,unknown>={width,height,textSize,browserName}
  let start=await page.evaluate(()=>performance.now())
  await page.getByTestId('continue-save').click()
  await expect(page.getByTestId('map')).toBeVisible()
  metrics.loadMs=await page.evaluate(()=>performance.now())-start
  const snapshot=await page.evaluate(()=>JSON.stringify(window.__harness.getState()))
  expect(JSON.parse(snapshot).turn).toBe(65)
  await page.evaluate(()=>{
    const recording:Recording={frames:[],longTasks:[],last:0,request:0}
    const frame=(now:number)=>{if(recording.last)recording.frames.push(now-recording.last);if(recording.frames.length>3000)recording.frames.shift();recording.last=now;recording.request=requestAnimationFrame(frame)}
    recording.request=requestAnimationFrame(frame)
    if(PerformanceObserver.supportedEntryTypes?.includes('longtask')) {recording.observer=new PerformanceObserver(list=>{recording.longTasks.push(...list.getEntries().map(e=>e.duration))});recording.observer.observe({entryTypes:['longtask']})}
    ;(window as unknown as {recording:Recording}).recording=recording
  })
  await page.getByTestId('map-projection').click()
  await expect(page.getByTestId('globe-land')).toBeVisible()
  const map=await page.getByTestId('map').boundingBox();expect(map).not.toBeNull()
  for(let i=0;i<4;i++) {
    await page.mouse.move(map!.x+map!.width*.45,map!.y+map!.height*.45)
    await page.mouse.down();await page.mouse.move(map!.x+map!.width*(i%2?.65:.25),map!.y+map!.height*.5,{steps:12});await page.mouse.up()
  }
  await expect(page.getByTestId('frame-diagnostics')).toContainText('frame p95')
  await openPanel(page,'routes')
  await page.getByTestId('network-advisor').locator('summary').first().click()
  start=await page.evaluate(()=>performance.now())
  await page.getByRole('button',{name:'Find improvements',exact:true}).click()
  await expect(page.getByLabel('Filter network recommendations')).toBeVisible()
  metrics.adviceMs=await page.evaluate(()=>performance.now())-start
  expect(Number(metrics.adviceMs),'populated advice remains interactive on shared CI runners').toBeLessThan(5000)
  await openPanel(page,'outlook')
  await expect(page.getByTestId('capital-outlook')).toContainText('Lowest cash')
  await page.getByLabel('Outlook horizon').selectOption('8')
  await openPanel(page,'operations')
  await expect(page.getByTestId('operations-board')).toContainText('Aircraft and cover')
  await info.attach(`${width}-${textSize}-operations`,{body:await page.screenshot({animations:'disabled'}),contentType:'image/png'})
  await openPanel(page,'map')
  const before=await page.evaluate(()=>document.querySelectorAll('*').length)
  await page.requestGC()
  const memory=()=>page.evaluate(()=>(performance as Performance & {memory?:{usedJSHeapSize:number}}).memory?.usedJSHeapSize??null)
  const heapBefore=await memory()
  for(let i=0;i<6;i++) {await openPanel(page,'routes');await openPanel(page,'map')}
  await page.requestGC()
  const heapAfter=await memory(), after=await page.evaluate(()=>document.querySelectorAll('*').length)
  metrics.heapBefore=heapBefore;metrics.heapAfter=heapAfter;metrics.nodesBefore=before;metrics.nodesAfter=after
  expect(after-before,'workspace navigation must not accumulate DOM copies').toBeLessThan(100)
  if(heapBefore && heapAfter) expect(heapAfter-heapBefore,'retained navigation heap stays bounded').toBeLessThan(32*1024*1024)
  expect(await page.evaluate(()=>JSON.stringify(window.__harness.getState()))).toBe(snapshot)
  for(const id of ['nav-desk','nav-network','nav-fleet','nav-company','end-quarter']) {
    const control=page.getByTestId(id), b=await control.boundingBox();expect(b).not.toBeNull()
    expect(b!.x).toBeGreaterThanOrEqual(0);expect(b!.x+b!.width).toBeLessThanOrEqual(width+1)
    expect(b!.y+b!.height).toBeLessThanOrEqual(height+1)
    expect(await control.evaluate(el=>{const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return hit===el || el.contains(hit)})).toBe(true)
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBe(0)
  Object.assign(metrics,await page.evaluate(()=>{
    const r=(window as unknown as {recording:Recording}).recording;cancelAnimationFrame(r.request);r.observer?.disconnect()
    const frames=[...r.frames].sort((a,b)=>a-b)
    return {frameCount:frames.length,frameP95:frames[Math.ceil(frames.length*.95)-1]??0,over50ms:frames.filter(n=>n>50).length,longTasks:r.longTasks,saveBytes:new Blob([localStorage.getItem('loadfactor:save:v1')??'']).size}
  }))
  await info.attach(`${width}-${textSize}-globe`,{body:await page.screenshot({animations:'disabled'}),contentType:'image/png'})
  start=await page.evaluate(()=>performance.now())
  await page.evaluate(()=>{const route=window.__harness.getState()!.airlines[0]!.routes[0]!;window.__harness.dispatch({type:'set_fare',routeId:route.id,fareLevel:route.fareLevel})})
  metrics.saveCommandMs=await page.evaluate(()=>performance.now())-start
  const saved=await page.evaluate(()=>JSON.stringify(window.__harness.getState()))
  await page.reload();await page.getByTestId('continue-save').click()
  await expect(page.getByTestId('map')).toBeVisible()
  expect(await page.evaluate(()=>JSON.stringify(window.__harness.getState()))).toBe(saved)
  await info.attach('workload.json',{body:JSON.stringify(metrics,null,2),contentType:'application/json'})
})
