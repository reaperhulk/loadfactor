// Authoring-time codegen: the 1200x630 card that link previews show.
//
// iMessage, Slack and Twitter all want a RASTER at an absolute URL — an SVG
// og:image is ignored by every one of them — so this renders the card in the
// same Chromium the e2e suite uses and writes a PNG into public/. Run
// `npm run gen:social` after changing the card, and commit the result: it is
// a build input, not a build output.
import { chromium } from '@playwright/test'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// Reuse the real map geometry rather than drawing a decorative squiggle: the
// card shows the same world the game does.
const gen = readFileSync(join(root, 'src/data/worldmap.gen.ts'), 'utf8')
const landPath = /export const WORLD_PATH = '([^']*)'/.exec(gen)[1]
const mapW = Number(/export const MAP_W = (\d+)/.exec(gen)[1])
const mapH = Number(/export const MAP_H = (\d+)/.exec(gen)[1])

// A handful of real trunk routes, drawn with the same lifted arc the map uses.
const cities = JSON.parse(readFileSync(join(root, 'src/data/cities.json'), 'utf8'))
const at = (id) => {
  const c = cities.find((x) => x.id === id)
  return { x: ((c.lon + 180) / 360) * mapW, y: ((76 - c.lat) / 132) * mapH }
}
const arc = (a, b) => {
  const p = at(a)
  const q = at(b)
  const dx = q.x - p.x
  const dy = q.y - p.y
  const len = Math.hypot(dx, dy) || 1
  const lift = Math.min(40, len * 0.18)
  const mx = (p.x + q.x) / 2 + (dy / len) * lift
  const my = (p.y + q.y) / 2 - (dx / len) * lift
  return `M${p.x},${p.y} Q${mx},${my} ${q.x},${q.y}`
}
const ROUTES = [
  ['JFK', 'LHR'],
  ['LHR', 'DXB'],
  ['DXB', 'SIN'],
  ['SIN', 'HND'],
  ['JFK', 'LAX'],
  ['LAX', 'HND'],
  ['LHR', 'GRU'],
  ['JNB', 'LHR'],
]
const DOTS = ['JFK', 'LHR', 'DXB', 'SIN', 'HND', 'LAX', 'GRU', 'JNB']

const html = `<!doctype html>
<meta charset="utf-8" />
<style>
  * { margin: 0; box-sizing: border-box; }
  body {
    width: 1200px; height: 630px; overflow: hidden;
    background: radial-gradient(120% 100% at 50% 0%, #1a2540 0%, #0b0f16 70%);
    font-family: 'Segoe UI', system-ui, sans-serif; color: #d8e0ee; position: relative;
  }
  .map { position: absolute; inset: 0; display: flex; align-items: center; }
  .map svg { width: 100%; opacity: 0.95; }
  .land { fill: #243350; stroke: #46608f; stroke-width: 0.7; }
  .arc { fill: none; stroke: #63b3ff; stroke-width: 2.2; opacity: 1; }
  .dot { fill: #8ecbff; }
  .scrim { position: absolute; inset: 0;
    background: linear-gradient(180deg, #0b0f16e0 0%, #0b0f1633 38%, #0b0f1699 76%, #0b0f16f0 100%); }
  .copy { position: absolute; inset: 0; padding: 62px 70px;
    display: flex; flex-direction: column; justify-content: space-between; }
  h1 { font-size: 92px; letter-spacing: -0.02em; font-weight: 800; line-height: 1; }
  .tag { font-size: 34px; color: #9fb0c8; margin-top: 18px; }
  .row { display: flex; gap: 14px; flex-wrap: wrap; }
  .chip { font-size: 22px; color: #b9c6da; border: 1px solid #35415d;
    background: #131c2ecc; border-radius: 999px; padding: 8px 18px; }
  .rule { height: 4px; width: 132px; background: #4fa3ff; border-radius: 2px; margin-bottom: 26px; }
</style>
<div class="map">
  <svg viewBox="0 0 ${mapW} ${mapH}" preserveAspectRatio="xMidYMid meet">
    <path class="land" d="${landPath}" />
    ${ROUTES.map((r) => `<path class="arc" d="${arc(r[0], r[1])}" />`).join('')}
    ${DOTS.map((d) => {
      const p = at(d)
      return `<circle class="dot" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.4" />`
    }).join('')}
  </svg>
</div>
<div class="scrim"></div>
<div class="copy">
  <div>
    <div class="rule"></div>
    <h1>Load Factor</h1>
    <div class="tag">Routes. Jets. Margins. Fill the seats.</div>
  </div>
  <div class="row">
    <span class="chip">Five decades, 1960–2010</span>
    <span class="chip">164 airports</span>
    <span class="chip">Rivals who fight back</span>
  </div>
</div>`

const tmp = join(root, 'public/.social-card.html')
writeFileSync(tmp, html)
const browser = await chromium.launch(
  process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
)
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } })
await page.goto(`file://${tmp}`)
await page.screenshot({ path: join(root, 'public/social-card.png') })
await browser.close()
unlinkSync(tmp)
console.log('wrote public/social-card.png (1200x630)')
