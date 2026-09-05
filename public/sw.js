// Fresh documents, immutable assets, and a bounded offline shell. Only this
// game's cache is owned here: other applications may share the same origin.
const CACHE = 'loadfactor-v2'
const LIMIT = 48
const INDEX = new URL('index.html', self.registration.scope).href
let writes = Promise.resolve()

function remember(key, response) {
  if (!response.ok) return Promise.resolve()
  const copy = response.clone()
  writes = writes.catch(() => {}).then(async () => {
    const cache = await caches.open(CACHE)
    await cache.put(key, copy)
    const keys = await cache.keys()
    const assets = keys.filter((request) => request.url !== INDEX)
    for (const request of assets.slice(0, Math.max(0, keys.length - LIMIT))) await cache.delete(request)
  }).catch(() => { /* Storage quota must never break online play. */ })
  return writes
}
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(INDEX)))
  self.skipWaiting()
})
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key.startsWith('loadfactor-') && key !== CACHE).map((key) => caches.delete(key)),
  )).then(() => self.clients.claim()))
})
self.addEventListener('fetch', (event) => {
  const request = event.request, url = new URL(request.url), scope = new URL(self.registration.scope)
  if (request.method !== 'GET' || url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request)
        if (response.ok) { await remember(INDEX, response); return response }
        return (await caches.match(INDEX)) ?? response
      } catch {
        return (await caches.match(INDEX)) ?? new Response('Load Factor is offline. Connect once to install the game.', { status: 503, headers: { 'Content-Type': 'text/plain' } })
      }
    })())
    return
  }
  if (!['script', 'style', 'image', 'font'].includes(request.destination)) return
  event.respondWith((async () => {
    const cached = await caches.match(request)
    if (cached) return cached
    try {
      const response = await fetch(request)
      await remember(request, response)
      return response
    } catch { return new Response('Asset unavailable offline', { status: 503 }) }
  })())
})
