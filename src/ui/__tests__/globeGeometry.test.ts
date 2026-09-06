import { afterEach, expect, it, vi } from 'vitest'
import { loadGlobeGeometry } from '../globeGeometry'

afterEach(() => vi.unstubAllGlobals())
it('shares in-flight geometry and retries failures without reloading the career', async () => {
  const data = { WORLD_RINGS: [[[0,0]]], WORLD_RINGS_FINE: [], BORDER_LINES: [], ISLET_POINTS: [] }
  const fetch = vi.fn().mockRejectedValueOnce(new Error('connection interrupted'))
    .mockResolvedValueOnce(new Response('unavailable', { status: 503 }))
    .mockResolvedValueOnce(new Response(JSON.stringify(data)))
  vi.stubGlobal('fetch', fetch)
  const one = loadGlobeGeometry(), two = loadGlobeGeometry()
  expect(two).toBe(one)
  await expect(one).rejects.toThrow('interrupted')
  await expect(loadGlobeGeometry()).rejects.toThrow('unavailable')
  await expect(loadGlobeGeometry()).resolves.toEqual(data)
  await expect(loadGlobeGeometry()).resolves.toEqual(data)
  expect(fetch).toHaveBeenCalledTimes(3)
})
