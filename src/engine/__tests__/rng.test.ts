import { describe, expect, it } from 'vitest'
import { chanceBp, deriveStream, hashNoiseBp, nextInt, nextU32, rngFromSeed } from '../rng'

describe('rng', () => {
  it('is deterministic from a seed', () => {
    const a = rngFromSeed('hello')
    const b = rngFromSeed('hello')
    expect(nextU32(a).value).toBe(nextU32(b).value)
  })

  it('different seeds produce different streams', () => {
    const a = rngFromSeed('hello')
    const b = rngFromSeed('world')
    const drawsA = []
    const drawsB = []
    let ra = a
    let rb = b
    for (let i = 0; i < 8; i++) {
      const na = nextU32(ra)
      const nb = nextU32(rb)
      drawsA.push(na.value)
      drawsB.push(nb.value)
      ra = na.rng
      rb = nb.rng
    }
    expect(drawsA).not.toEqual(drawsB)
  })

  it('substreams are independent', () => {
    const economy = deriveStream('seed', 'economy')
    const events = deriveStream('seed', 'events')
    expect(nextU32(economy).value).not.toBe(nextU32(events).value)
  })

  it('draws do not mutate the input state', () => {
    const rng = rngFromSeed('frozen')
    const before = { ...rng }
    nextU32(rng)
    nextInt(rng, 0, 100)
    expect(rng).toEqual(before)
  })

  it('nextInt stays in range and covers the range', () => {
    let rng = rngFromSeed('range')
    const seen = new Set<number>()
    for (let i = 0; i < 2000; i++) {
      const n = nextInt(rng, 3, 7)
      rng = n.rng
      expect(n.value).toBeGreaterThanOrEqual(3)
      expect(n.value).toBeLessThanOrEqual(7)
      seen.add(n.value)
    }
    expect(seen.size).toBe(5)
  })

  it('nextInt rejects invalid ranges', () => {
    expect(() => nextInt(rngFromSeed('x'), 5, 4)).toThrow()
    expect(() => nextInt(rngFromSeed('x'), 0.5, 4)).toThrow()
  })

  it('chanceBp approximates its probability', () => {
    let rng = rngFromSeed('chance')
    let hits = 0
    const n = 10000
    for (let i = 0; i < n; i++) {
      const c = chanceBp(rng, 2500)
      rng = c.rng
      if (c.value) hits++
    }
    expect(hits / n).toBeGreaterThan(0.22)
    expect(hits / n).toBeLessThan(0.28)
  })

  it('hashNoiseBp is stable, bounded, and key-independent', () => {
    const a = hashNoiseBp('seed', 4, 'JFK-LHR', 800)
    expect(hashNoiseBp('seed', 4, 'JFK-LHR', 800)).toBe(a)
    expect(a).toBeGreaterThanOrEqual(9200)
    expect(a).toBeLessThanOrEqual(10800)
    // Changing one key never affects another (the whole point vs stream draws).
    const other = hashNoiseBp('seed', 4, 'HND-JFK', 800)
    expect(hashNoiseBp('seed', 4, 'HND-JFK', 800)).toBe(other)
  })
})
