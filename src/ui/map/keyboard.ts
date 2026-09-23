// Keyboard travel between airports. The map is one tab stop (a roving
// tabindex over the city markers): arrow keys hop to the nearest airport in
// that direction, so the hundred-odd markers never flood the tab order.

export type Direction = 'left' | 'right' | 'up' | 'down'

export const ARROW_DIRECTIONS: Readonly<Record<string, Direction>> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
}

export interface Site {
  id: string
  x: number
  y: number
}

// The closest site in the direction pressed, favouring ones straight ahead:
// sideways distance costs double, and anything more sideways than ahead is
// outside the cone (pressing → never jumps to a city due north). Screen
// convention: y grows downward. Ties go to the lower id, so the walk is
// deterministic.
export function nearestInDirection(from: { x: number; y: number }, sites: readonly Site[], dir: Direction): string | null {
  let best: string | null = null
  let bestScore = Infinity
  for (const s of sites) {
    const dx = s.x - from.x
    const dy = s.y - from.y
    const along = dir === 'right' ? dx : dir === 'left' ? -dx : dir === 'down' ? dy : -dy
    const side = Math.abs(dir === 'left' || dir === 'right' ? dy : dx)
    if (along <= 1e-6 || side > along) continue
    const score = along + 2 * side
    if (score < bestScore || (score === bestScore && best !== null && s.id < best)) {
      best = s.id
      bestScore = score
    }
  }
  return best
}
