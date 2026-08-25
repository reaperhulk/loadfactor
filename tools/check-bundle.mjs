// Keep the menu and game shell quick to start. Run after `vite build`; the
// module script referenced by index.html is the eager entry, while the map
// and replay viewer are deliberately lazy chunks.
import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'

const dist = new URL('../dist/', import.meta.url)
const html = readFileSync(new URL('index.html', dist), 'utf8')
const entry = html.match(/<script type="module" crossorigin src="\.\/(assets\/[^"]+\.js)"><\/script>/)?.[1]
if (!entry) throw new Error('could not find the production entry script in dist/index.html')

const bytes = gzipSync(readFileSync(new URL(entry, dist))).byteLength
const limit = 190 * 1024
if (bytes > limit) {
  throw new Error(`initial bundle ${Math.ceil(bytes / 1024)} KiB gzip exceeds ${limit / 1024} KiB budget`)
}

console.log(`initial bundle ${Math.ceil(bytes / 1024)} KiB gzip (budget ${limit / 1024} KiB)`)
