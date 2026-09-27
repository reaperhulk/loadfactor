// Rival networks must never read as "losing money": the old palette led with
// the very red the map uses for a loss. Distances are CIE76 ΔE in Lab, where
// ~2 is a just-noticeable difference and 25+ is plainly a different color.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CONTESTED_COLOR, LENS_COLORS, LENS_DASH, LOSS_COLOR, RIVAL_COLORS, rivalColor, rivalColorClass } from '../mapStyle'

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

// ---- The metric lenses' palette -------------------------------------------
// Colour-vision deficiency is simulated with Machado, Oliveira & Fernandes
// (2009) at full severity, applied in linear RGB — the standard matrices
// behind browser devtools' "emulate vision deficiencies".
type Matrix = readonly (readonly [number, number, number])[]
const CVD: Record<string, Matrix | null> = {
  normal: null,
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
}
const toLinear = (hex: string): [number, number, number] =>
  [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92
  }) as [number, number, number]
const toHex = (lin: readonly number[]): string =>
  '#' +
  lin
    .map((c) => {
      const v = Math.min(1, Math.max(0, c))
      const e = v > 0.0031308 ? 1.055 * v ** (1 / 2.4) - 0.055 : 12.92 * v
      return Math.round(e * 255).toString(16).padStart(2, '0')
    })
    .join('')
function simulate(hex: string, m: Matrix | null): string {
  if (m === null) return hex
  const l = toLinear(hex)
  return toHex(m.map((row) => row[0] * l[0] + row[1] * l[1] + row[2] * l[2]))
}
function luminance(hex: string): number {
  const [r, g, b] = toLinear(hex)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

// The map behind the arcs, every era: the open sea (deep and shallow) and
// the land (its lit and base stops). From styles.css's .map.era-* rules.
const SEAS = ['#091b25', '#173642', '#091a22', '#19353e', '#091523', '#193344', '#071924', '#15394a', '#071625', '#103549']
const LANDS = ['#626653', '#343e38', '#5b6050', '#353b35', '#435967', '#273c4d', '#355d68', '#203e51', '#315766', '#19384e']

describe('lens palette', () => {
  const { good, mid, bad, none } = LENS_COLORS

  it('keeps adjacent buckets apart for every reader', () => {
    for (const [name, m] of Object.entries(CVD)) {
      const [g, n, b] = [good, mid, bad].map((c) => simulate(c, m)) as [string, string, string]
      expect(deltaE(g, n), `${name}: good vs neutral`).toBeGreaterThan(35)
      expect(deltaE(n, b), `${name}: neutral vs bad`).toBeGreaterThan(35)
      expect(deltaE(g, b), `${name}: good vs bad`).toBeGreaterThan(60)
      // Not flown yet is none of the three.
      for (const c of [g, n, b]) expect(deltaE(simulate(none, m), c), `${name}: no data vs ${c}`).toBeGreaterThan(25)
    }
  })

  it('is not the red/green pair it replaced', () => {
    // Under deuteranopia the old green (#4fae62) and red (#d0636e) were
    // close enough to confuse; the new ends must not be.
    const old = deltaE(simulate('#4fae62', CVD.deuteranopia!), simulate('#d0636e', CVD.deuteranopia!))
    const now = deltaE(simulate(good, CVD.deuteranopia!), simulate(bad, CVD.deuteranopia!))
    expect(now).toBeGreaterThan(old * 2)
  })

  it('reads against the map in every era', () => {
    for (const c of [good, mid, bad]) {
      for (const sea of SEAS) expect(contrast(c, sea), `${c} on sea ${sea}`).toBeGreaterThanOrEqual(4.5)
      // Land is the harder ground (the lightest stop is a mid olive); a
      // line needs 3:1 as a graphic, and the lit stop is only the brightest
      // sliver of a continent, so it gets a little slack.
      for (const land of LANDS) expect(contrast(c, land), `${c} on land ${land}`).toBeGreaterThanOrEqual(land === '#626653' || land === '#5b6050' ? 2.5 : 3)
    }
  })

  it('keeps the neutral bucket off the default route colour', () => {
    // The old "0–14%" key sat in the default text colour and read as an
    // ordinary arc. Every bucket must be clearly not the livery.
    for (const accent of ['#9bd7e8', '#80cfeb']) {
      for (const c of [good, mid, bad]) expect(deltaE(c, accent), `${c} vs ${accent}`).toBeGreaterThan(20)
    }
  })

  it('carries a second cue, so colour is never the only one', () => {
    expect(new Set(Object.values(LENS_DASH)).size).toBe(Object.keys(LENS_DASH).length)
    expect(LENS_DASH.good).toBe('none')
  })

  it('is the same palette in CSS as in script', () => {
    const css = readFileSync(new URL('../map.css', import.meta.url), 'utf8')
    for (const bucket of ['good', 'mid', 'bad', 'none'] as const) {
      const rule = new RegExp(`\\.route-player\\.lens-${bucket}\\s*\\{\\s*stroke:\\s*(#[0-9a-f]{6});\\s*stroke-dasharray:\\s*([^;]+);`).exec(css)
      expect(rule?.[1], bucket).toBe(LENS_COLORS[bucket])
      expect(rule?.[2], bucket).toBe(LENS_DASH[bucket])
    }
  })
})

