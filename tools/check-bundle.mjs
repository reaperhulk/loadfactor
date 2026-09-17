// Run after `vite build`. The module script referenced by index.html is the
// eager entry; the map and replay viewer are deliberately lazy chunks.
import { readFileSync, readdirSync } from 'node:fs'
import { gzipSync } from 'node:zlib'

const dist = new URL('../dist/', import.meta.url)
const html = readFileSync(new URL('index.html', dist), 'utf8')
const entry = html.match(/<script type="module" crossorigin src="\.\/(assets\/[^"]+\.js)"><\/script>/)?.[1]
if (!entry) throw new Error('could not find the production entry script in dist/index.html')

// The shell's size is reported, not gated: the simulation is eager by nature
// and grows with every rules version, and the last budget bought lazy twins
// of small components rather than a faster start.
const bytes = gzipSync(readFileSync(new URL(entry, dist))).byteLength
console.log(`initial bundle ${Math.ceil(bytes / 1024)} KiB gzip (reported, not gated)`)

// The map is the first game screen. Guard its own download as well as the
// shell so optional globe coordinates cannot silently become eager again.
const map = readdirSync(new URL('assets/', dist)).find((name) => /^MapView-.*\.js$/.test(name))
if (!map) throw new Error('could not find the production map chunk')
const mapBytes = gzipSync(readFileSync(new URL(`assets/${map}`, dist))).byteLength
const mapLimit = 95 * 1024
if (mapBytes > mapLimit) throw new Error(`flat map ${Math.ceil(mapBytes / 1024)} KiB gzip exceeds 95 KiB budget`)
console.log(`flat map ${Math.ceil(mapBytes / 1024)} KiB gzip (budget 95 KiB; globe loaded on demand)`)
