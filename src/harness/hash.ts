// Canonical hash of a game state for golden tests: FNV-1a over the JSON text.
// JSON.stringify is deterministic here because GameState is plain data built
// with fixed key insertion order.
export function hashState(value: unknown): string {
  const str = JSON.stringify(value)
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}
