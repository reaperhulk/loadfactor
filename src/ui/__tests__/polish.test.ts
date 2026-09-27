// Small pure helpers behind the UI polish pass: plain-language campaign and
// hedge advice on the Desk, and race-chart ticks that never crowd.

import { describe, expect, it } from 'vitest'
import { campaignLeft, fuelAdvice, hedgeCovers } from '../ManagementBrief'
import { labelWidth, raceTicks } from '../Sparkline'
import { PAGE_LABELS, PAGE_SHORT_LABELS } from '../workspace'

describe('desk wording', () => {
  it('never says "0 quarters remaining"', () => {
    expect(campaignLeft(0)).toBe('ends this quarter')
    expect(campaignLeft(-2)).toBe('ends this quarter')
    expect(campaignLeft(1)).toBe('1 quarter to run')
    expect(campaignLeft(6)).toBe('6 quarters to run')
  })

  it('only advises hedging when no hedge covers the shock', () => {
    expect(hedgeCovers(null)).toBe(false)
    expect(hedgeCovers({ quartersLeft: 1 })).toBe(false)
    expect(hedgeCovers({ quartersLeft: 3 })).toBe(true)
    expect(fuelAdvice(null)).toMatch(/^Hedge now/)
    expect(fuelAdvice(undefined)).toMatch(/^Hedge now/)
    expect(fuelAdvice({ quartersLeft: 4 })).toBe('Your fuel hedge covers the shock for 4 more quarters. Plan for the bill when it expires.')
    expect(fuelAdvice({ quartersLeft: 4, coverBp: 5000 })).toMatch(/^Your hedge locks 50% of your fuel/)
    expect(fuelAdvice({ quartersLeft: 1 })).toMatch(/^Your hedge expires as the shock lands/)
    for (const hedge of [{ quartersLeft: 2 }, { quartersLeft: 2, coverBp: 5000 }]) expect(fuelAdvice(hedge)).not.toContain('Hedge now')
  })
})

describe('race chart ticks', () => {
  it('always starts at the first quarter and keeps labels apart', () => {
    for (const [count, width] of [[2, 300], [25, 1100], [25, 260], [80, 900], [161, 320], [9, 60]] as const) {
      const ticks = raceTicks(count, width, 64)
      expect(ticks[0]).toBe(0)
      const perIndex = width / (count - 1)
      for (let k = 1; k < ticks.length; k++) {
        expect(ticks[k]!).toBeGreaterThan(ticks[k - 1]!)
        expect(ticks[k]! <= count - 1).toBe(true)
        expect((ticks[k]! - ticks[k - 1]!) * perIndex).toBeGreaterThanOrEqual(64)
      }
    }
  })

  it('steps by whole years once quarters get crowded', () => {
    expect(raceTicks(25, 1100, 64)).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24])
    expect(raceTicks(25, 300, 64)).toEqual([0, 8, 16, 24])
    expect(raceTicks(1, 300)).toEqual([0])
    expect(raceTicks(0, 300)).toEqual([])
  })

  it('sizes label gutters from the text', () => {
    expect(labelWidth('$493.4M')).toBeGreaterThan(labelWidth('$0k'))
    expect(labelWidth('')).toBe(0)
  })
})

describe('tab labels', () => {
  it('short phone labels are contained in the full accessible names', () => {
    for (const [page, short] of Object.entries(PAGE_SHORT_LABELS)) {
      expect(PAGE_LABELS[page as keyof typeof PAGE_LABELS].toLowerCase()).toContain(short!.toLowerCase())
    }
  })
})
