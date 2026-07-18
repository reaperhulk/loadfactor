// Deterministic PRNG for the simulation (xoshiro128** — 32-bit integer ops only,
// so results are bit-identical on every platform). RNG state is plain data that
// lives inside GameState; every draw returns the next state instead of mutating.

export interface Rng {
  a: number
  b: number
  c: number
  d: number
}

export function fnv1a(str: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

function splitmix32(state: number): { value: number; state: number } {
  const s = (state + 0x9e3779b9) >>> 0
  let t = s
  t = Math.imul(t ^ (t >>> 16), 0x21f0aaad)
  t = Math.imul(t ^ (t >>> 15), 0x735a2d97)
  t = (t ^ (t >>> 15)) >>> 0
  return { value: t, state: s }
}

export function rngFromSeed(seed: string): Rng {
  let s = fnv1a(seed)
  const words: number[] = []
  for (let i = 0; i < 4; i++) {
    const r = splitmix32(s)
    words.push(r.value)
    s = r.state
  }
  const rng: Rng = { a: words[0]!, b: words[1]!, c: words[2]!, d: words[3]! }
  if ((rng.a | rng.b | rng.c | rng.d) === 0) rng.a = 1 // all-zero state is a fixed point
  return rng
}

// Independent substreams (economy, events, negotiations, rivals) derived from one
// game seed, so adding a draw to one subsystem never reshuffles another.
// See PLAN.md §3.2.
export function deriveStream(seed: string, stream: string): Rng {
  return rngFromSeed(`${seed} ${stream}`)
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0
}

export function nextU32(rng: Rng): { value: number; rng: Rng } {
  const { a, b, c, d } = rng
  const value = Math.imul(rotl(Math.imul(b, 5) >>> 0, 7), 9) >>> 0
  const t = (b << 9) >>> 0
  let c2 = (c ^ a) >>> 0
  let d2 = (d ^ b) >>> 0
  const b2 = (b ^ c2) >>> 0
  const a2 = (a ^ d2) >>> 0
  c2 = (c2 ^ t) >>> 0
  d2 = rotl(d2, 11)
  return { value, rng: { a: a2, b: b2, c: c2, d: d2 } }
}

// Uniform integer in [min, max], both inclusive. Rejection sampling removes
// modulo bias so distributions stay uniform regardless of range.
export function nextInt(rng: Rng, min: number, max: number): { value: number; rng: Rng } {
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min > max) {
    throw new Error(`nextInt: invalid range [${min}, ${max}]`)
  }
  const range = max - min + 1
  const limit = Math.floor(0x1_0000_0000 / range) * range
  let r = rng
  let v: number
  do {
    const n = nextU32(r)
    v = n.value
    r = n.rng
  } while (v >= limit)
  return { value: min + (v % range), rng: r }
}

// True with probability bp/10000.
export function chanceBp(rng: Rng, bp: number): { value: boolean; rng: Rng } {
  const n = nextInt(rng, 0, 9999)
  return { value: n.value < bp, rng: n.rng }
}

// Stateless per-entity noise: a multiplier in [10000 - spreadBp, 10000 + spreadBp]
// derived by hashing (seed, turn, key). Unlike stream draws, adding or removing
// one entity never reshuffles the noise of any other — see PLAN.md §3.2 rule 2.
export function hashNoiseBp(seed: string, turn: number, key: string, spreadBp: number): number {
  const h = fnv1a(`${seed}|${turn}|${key}`)
  return 10000 - spreadBp + (h % (2 * spreadBp + 1))
}
