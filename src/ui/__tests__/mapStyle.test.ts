// Rival networks must never read as "losing money": the old palette led with
// the very red the map uses for a loss. Distances are CIE76 ΔE in Lab, where
// ~2 is a just-noticeable difference and 25+ is plainly a different color.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CONTESTED_COLOR, LOSS_COLOR, RIVAL_COLORS, rivalColor, rivalColorClass } from '../mapStyle'

function lab(hex: string): [number, number, number] {
  const lin = (i: number): number => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92
  }
  const [r, g, b] = [lin(1), lin(3), lin(5)]
  const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  const fx = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047)
  const fy = f(0.2126 * r + 0.7152 * g + 0.0722 * b)
  const fz = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

const deltaE = (a: string, b: string): number => {
  const p = lab(a)
  const q = lab(b)
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])
}

function hue(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number]
  const max = Math.max(r, g, b)
  const d = max - Math.min(r, g, b)
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return (h * 60 + 360) % 360
}
const hueGap = (a: string, b: string): number => {
  const d = Math.abs(hue(a) - hue(b)) % 360
  return Math.min(d, 360 - d)
}

// Every red the map and its text use for a loss.
const LOSS_REDS = [LOSS_COLOR, '#e06c6c', '#ff9c90']

describe('rival palette', () => {
  it('stays far from every loss red', () => {
    for (const c of RIVAL_COLORS) {
      for (const red of LOSS_REDS) expect(deltaE(c, red), `${c} vs ${red}`).toBeGreaterThan(45)
      expect(hueGap(c, LOSS_COLOR), `${c} hue vs loss`).toBeGreaterThan(40)
    }
  })

  it('stays clear of the contested orange and the default livery', () => {
    for (const c of RIVAL_COLORS) {
      expect(deltaE(c, CONTESTED_COLOR)).toBeGreaterThan(45)
      expect(deltaE(c, '#80cfeb')).toBeGreaterThan(45)
    }
  })

  it('tells the rivals apart from each other', () => {
    for (let i = 0; i < RIVAL_COLORS.length; i++) {
      for (let j = i + 1; j < RIVAL_COLORS.length; j++) {
        expect(deltaE(RIVAL_COLORS[i]!, RIVAL_COLORS[j]!), `${RIVAL_COLORS[i]} vs ${RIVAL_COLORS[j]}`).toBeGreaterThan(30)
      }
    }
  })

  it('gives each airline one color, the same in CSS as in script', () => {
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8')
    for (const id of [1, 2, 3, 4]) {
      const cls = rivalColorClass(id)
      const rule = new RegExp(`\\.${cls}\\s*\\{\\s*stroke:\\s*(#[0-9a-f]{6})`).exec(css)
      expect(rule?.[1], cls).toBe(rivalColor(id))
      // The race chart keys the same airline by its index.
      if (id <= 3) expect(new RegExp(`\\.race-rival-${id}\\s*\\{\\s*stroke:\\s*(#[0-9a-f]{6})`).exec(css)?.[1]).toBe(rivalColor(id))
    }
  })
})
