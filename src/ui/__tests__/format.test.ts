// Money and sign formatting: one glyph for minus (U+2212) placed before the
// currency symbol, the same tiers everywhere, and zero always neutral.

import { describe, expect, it } from 'vitest'
import { leaderTone, MINUS, money, moneyOrNone, NONE, plural, inQuarters, joinParts, objectiveValue, pct, signed, signedCount, signedMoney, signedPct, tone } from '../format'

describe('money', () => {
  it('formats positive amounts by tier', () => {
    expect(money(0)).toBe('$0k')
    expect(money(999)).toBe('$999k')
    expect(money(1000)).toBe('$1.0M')
    expect(money(1940)).toBe('$1.9M')
    expect(money(999_949)).toBe('$999.9M')
    expect(money(999_950)).toBe('$1.00B')
    expect(money(999_999)).toBe('$1.00B')
    expect(money(1_000_000)).toBe('$1.00B')
    expect(money(2_370_000)).toBe('$2.37B')
  })

  it('puts a true minus sign before the dollar sign', () => {
    expect(MINUS).toBe('−')
    expect(money(-1)).toBe('−$1k')
    expect(money(-440)).toBe('−$440k')
    expect(money(-1900)).toBe('−$1.9M')
    expect(money(-2_370_000)).toBe('−$2.37B')
    for (const k of [-1, -999, -1000, -55_555, -3_000_000]) {
      expect(money(k)).not.toContain('$-')
      expect(money(k)).not.toContain('-')
    }
  })

  it('treats negative zero as zero', () => {
    expect(money(-0)).toBe('$0k')
    expect(money(-0.4)).toBe('$0k')
    expect(signedMoney(-0.4)).toBe('$0k')
  })

  it('never renders a tier past its boundary', () => {
    expect(money(999.6)).toBe('$1.0M')
    expect(money(-999_960)).toBe('−$1.00B')
    for (let k = 0; k < 3_000_000; k += 997) {
      expect(money(k)).not.toMatch(/\$1000(\.0)?[kM]/)
    }
  })

  it('renders missing figures as an em dash, never NaN', () => {
    expect(money(Number.NaN)).toBe(NONE)
    expect(money(Number.POSITIVE_INFINITY)).toBe(NONE)
    expect(signedMoney(Number.NaN)).toBe(NONE)
    expect(pct(Number.NaN)).toBe(NONE)
    expect(signed(Number.NaN)).toBe(NONE)
    expect(NONE).toBe('—')
  })
})

describe('moneyOrNone', () => {
  it('shows a dash where zero means nothing', () => {
    expect(moneyOrNone(0)).toBe('—')
    expect(moneyOrNone(-0)).toBe('—')
    expect(moneyOrNone(0.2)).toBe('—')
    expect(moneyOrNone(undefined)).toBe('—')
    expect(moneyOrNone(null)).toBe('—')
    expect(moneyOrNone(Number.NaN)).toBe('—')
    expect(moneyOrNone(480)).toBe('$480k')
    expect(moneyOrNone(-1900)).toBe('−$1.9M')
  })
})

describe('signedMoney', () => {
  it('signs gains, losses and leaves zero unsigned', () => {
    expect(signedMoney(5600)).toBe('+$5.6M')
    expect(signedMoney(12)).toBe('+$12k')
    expect(signedMoney(1_250_000)).toBe('+$1.25B')
    expect(signedMoney(-1900)).toBe('−$1.9M')
    expect(signedMoney(-12)).toBe('−$12k')
    expect(signedMoney(0)).toBe('$0k')
  })
})

describe('signed numbers and percentages', () => {
  it('signs plain numbers with the same minus glyph', () => {
    expect(signed(12)).toBe('+12')
    expect(signed(-3)).toBe('−3')
    expect(signed(0)).toBe('0')
    expect(signed(-0.04, 1)).toBe('0.0')
    expect(signed(2.46, 1)).toBe('+2.5')
  })

  it('formats basis points', () => {
    expect(pct(8400)).toBe('84%')
    expect(pct(-250, 1)).toBe('−2.5%')
    expect(pct(0)).toBe('0%')
    expect(signedPct(250, 1)).toBe('+2.5%')
    expect(signedPct(-40, 1)).toBe('−0.4%')
    expect(signedPct(0, 1)).toBe('0.0%')
  })

  it('signs counts with separators', () => {
    expect(signedCount(1200)).toBe('+1,200')
    expect(signedCount(-35)).toBe('−35')
    expect(signedCount(0)).toBe('0')
  })

  it('renders objective values through the shared formatters', () => {
    expect(objectiveValue(-1500, 'money')).toBe('−$1.5M')
    expect(objectiveValue(7600, 'rate')).toBe('76.0%')
    expect(objectiveValue(22_000_000, 'count')).toBe('22,000,000')
  })
})

describe('tone', () => {
  it('is neutral at zero, green up, red down', () => {
    expect(tone(0)).toBe('')
    expect(tone(-0)).toBe('')
    expect(tone(Number.NaN)).toBe('')
    expect(tone(1)).toBe('pos')
    expect(tone(-1)).toBe('neg')
  })

  it('inverts for figures where up is bad', () => {
    expect(tone(5, true)).toBe('neg')
    expect(tone(-5, true)).toBe('pos')
    expect(tone(0, true)).toBe('')
  })
})

describe('leaderTone', () => {
  it('highlights only a positive best', () => {
    expect(leaderTone(500, 500)).toBe('pos')
    expect(leaderTone(400, 500)).toBe('')
    expect(leaderTone(0, 0)).toBe('')
    expect(leaderTone(-5, -5)).toBe('')
  })
})

describe('plain-language counts', () => {
  it('pluralizes nouns by count', () => {
    expect(plural(1, 'route')).toBe('1 route')
    expect(plural(0, 'route')).toBe('0 routes')
    expect(plural(2, 'route')).toBe('2 routes')
    expect(plural(1200, 'passenger')).toBe('1,200 passengers')
    expect(plural(2, 'city', 'cities')).toBe('2 cities')
  })

  it('says lead times in words, never "0q"', () => {
    expect(inQuarters(0)).toBe('this quarter')
    expect(inQuarters(-1)).toBe('this quarter')
    expect(inQuarters(1)).toBe('next quarter')
    expect(inQuarters(37)).toBe('in 37 quarters')
  })
})

describe('joinParts', () => {
  it('joins present parts without stray separators', () => {
    expect(joinParts(['Checks $480k', false, 0, null, undefined, ''])).toBe('Checks $480k')
    expect(joinParts(['a', 'b'])).toBe('a · b')
    expect(joinParts([false, 'b'])).toBe('b')
    expect(joinParts([])).toBe('')
  })
})
