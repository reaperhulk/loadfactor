import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

// Exercise the actual worker's public events with cache/network boundaries.
function worker() {
  const stores = new Map<string, Map<string, Response>>()
  const handlers = new Map<string, (event: Record<string, unknown>) => void>()
  let network: () => Promise<Response> = async () => new Response('fresh')
  const key = (request: string | { url: string }) => typeof request === 'string' ? request : request.url
  const caches = {
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    match: async (request: string | { url: string }) => {
      for (const store of stores.values()) { const found = store.get(key(request)); if (found) return found.clone() }
    },
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map())
      const store = stores.get(name)!
      return {
        add: async (request: string) => { store.set(key(request), await network()) },
        put: async (request: string | { url: string }, response: Response) => { store.set(key(request), response.clone()) },
        keys: async () => [...store.keys()].map((url) => ({ url })),
        delete: async (request: { url: string }) => store.delete(request.url),
      }
    },
  }
  runInNewContext(readFileSync(new URL('../../../public/sw.js', import.meta.url), 'utf8'), {
    URL, Response, caches, fetch: () => network(),
    self: { registration: { scope: 'https://example.test/loadfactor/' }, addEventListener: (name: string, handler: (event: Record<string, unknown>) => void) => handlers.set(name, handler), skipWaiting() {}, clients: { claim: async () => {} } },
  })
  const fire = async (name: string) => {
    let completion: Promise<unknown> = Promise.resolve()
    handlers.get(name)!({ waitUntil: (promise: Promise<unknown>) => { completion = promise } })
    await completion
  }
  const fetch = async (url: string, mode = 'navigate', destination = 'document') => {
    let response: Promise<Response> | undefined
    handlers.get('fetch')!({ request: { url, mode, destination, method: 'GET' }, respondWith: (promise: Promise<Response>) => { response = promise } })
    return response
  }
  return { stores, fire, fetch, network: (next: typeof network) => { network = next } }
}

describe('offline release behavior', () => {
  it('uses fresh documents online and the last successful shell offline', async () => {
    const w = worker()
    await w.fire('install')
    w.network(async () => new Response('new release'))
    expect(await (await w.fetch('https://example.test/loadfactor/?seed=test'))!.text()).toBe('new release')
    w.network(async () => { throw new Error('offline') })
    expect(await (await w.fetch('https://example.test/loadfactor/'))!.text()).toBe('new release')
    expect([...w.stores.get('loadfactor-v2')!.keys()]).toEqual(['https://example.test/loadfactor/index.html'])
  })
  it('bounds assets and preserves other applications on activation', async () => {
    const w = worker()
    w.stores.set('another-app', new Map())
    w.stores.set('loadfactor-v1', new Map())
    await w.fire('install'); await w.fire('activate')
    expect(w.stores.has('another-app')).toBe(true)
    expect(w.stores.has('loadfactor-v1')).toBe(false)
    for (let i = 0; i < 60; i++) await w.fetch(`https://example.test/loadfactor/assets/${i}.js`, 'cors', 'script')
    expect(w.stores.get('loadfactor-v2')!.size).toBe(48)
    expect(w.stores.get('loadfactor-v2')!.has('https://example.test/loadfactor/index.html')).toBe(true)
  })
  it('does not intercept other apps and returns a valid offline miss response', async () => {
    const w = worker()
    expect(await w.fetch('https://example.test/another-app/')).toBeUndefined()
    expect(await w.fetch('https://example.test.evil/loadfactor/')).toBeUndefined()
    w.network(async () => { throw new Error('offline') })
    expect((await w.fetch('https://example.test/loadfactor/assets/missing.js', 'cors', 'script'))!.status).toBe(503)
  })
})

it('caches optional globe data after success, recovers from misses, and leaves other JSON alone', async () => {
  const w = worker(), url = 'https://example.test/loadfactor/assets/globemap.gen-abc123.json'
  w.network(async () => { throw new Error('offline') })
  expect((await w.fetch(url, 'cors', ''))!.status).toBe(503)
  w.network(async () => new Response('{"WORLD_RINGS":[]}'))
  expect(await (await w.fetch(url, 'cors', ''))!.text()).toBe('{"WORLD_RINGS":[]}')
  w.network(async () => { throw new Error('offline') })
  expect(await (await w.fetch(url, 'cors', ''))!.text()).toBe('{"WORLD_RINGS":[]}')
  expect(await w.fetch('https://example.test/loadfactor/api/data.json', 'cors', '')).toBeUndefined()
})
