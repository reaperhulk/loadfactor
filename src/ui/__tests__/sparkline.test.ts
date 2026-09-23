// Sparkline geometry: quarter ticks, a zero baseline only when the series
// crosses zero, end points pinned inside the box, and a readable summary.

import { describe, expect, it } from 'vitest'
import { money } from '../format'
import { SPARK_LABEL_BAND, sparkGeometry, sparkSummary } from '../Sparkline'

describe('sparkGeometry', () => {
  it('puts one tick per quarter across the full width', () => {
    const g = sparkGeometry([1, 2, 3, 4, 5], 120, 39)
    expect(g.ticks).toHaveLength(5)
    expect(g.ticks[0]).toBe(0.5)
    expect(g.ticks[2]).toBe(60)
    expect(g.ticks[4]).toBe(119.5)
  })

  it('draws a zero baseline only when the range crosses zero', () => {
    expect(sparkGeometry([10, 20, 30], 100, 39).zeroY).toBeNull()
    expect(sparkGeometry([-10, -20], 100, 39).zeroY).toBeNull()
    const g = sparkGeometry([-100, 100], 100, 39)
    expect(g.zeroY).not.toBeNull()
    // Zero sits halfway between the two extremes of the plot band.
    expect(g.zeroY!).toBeCloseTo((g.first.y + g.last.y) / 2, 0)
  })

  it('keeps the line inside the plot band below the label strip', () => {
    const g = sparkGeometry([5, -3, 8, 0], 100, 39)
    expect(g.top).toBe(SPARK_LABEL_BAND)
    for (const y of [g.first.y, g.last.y]) {
      expect(y).toBeGreaterThanOrEqual(g.top)
      expect(y).toBeLessThanOrEqual(g.bottom)
    }
    // Highest value is nearest the top: 8 is above 5.
    expect(g.d.startsWith('M0.5,')).toBe(true)
    expect(g.last.x).toBe(99.5)
  })

  it('respects fixed bounds', () => {
    const g = sparkGeometry([0, 10000], 100, 39, 0, 10000)
    expect(g.first.y).toBeGreaterThan(g.last.y)
    expect(g.zeroY).toBeNull()
  })

  it('does not divide by zero on a flat series', () => {
    const g = sparkGeometry([7, 7, 7], 60, 39)
    expect(g.d).not.toContain('NaN')
    expect(g.first.y).toBe(g.last.y)
  })
})

describe('sparkSummary', () => {
  it('names first, last, min and max', () => {
    expect(sparkSummary([-500, 1200, 3000, 2500], money, 'Net profit per quarter')).toBe(
      'Net profit per quarter over 4 quarters: from −$500k to $2.5M; low −$500k, high $3.0M',
    )
  })

  it('handles an empty series', () => {
    expect(sparkSummary([], money)).toBe('Trend: no data')
  })
})
