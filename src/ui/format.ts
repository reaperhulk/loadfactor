import { announce } from './toasts'
// One money formatter for every surface: $k in, human string out. Keeping a
// single definition means every panel rounds and tiers the same way —
// comparisons only work when the numbers are presented identically.

// Negative amounts lead with a true minus sign (U+2212) before the currency
// symbol: "−$1.9M", never "$-1.9M". Every signed figure in the UI uses the
// same glyph so columns of gains and losses line up.
export const MINUS = '\u2212'

// Tiers pick by the *rounded* figure so a value never renders past its tier
// ("$1000.0M" becomes "$1.00B", "$1000k" becomes "$1.0M").
function magnitude(abs: number): string {
  const k = Math.round(abs)
  // 999,950 and up would print "$1000.0M" in the M tier.
  if (k >= 999_950) return `$${(k / 1_000_000).toFixed(2)}B`
  if (k >= 1000) return `$${(k / 1000).toFixed(1)}M`
  return `$${k}k`
}

// Not-a-number and negative zero never leak out as "$NaNk" or "−$0k": a
// missing figure renders as an em dash, and anything that rounds to zero is
// an unsigned "$0k".
export const NONE = '\u2014'

export function money(k: number): string {
  if (!Number.isFinite(k)) return NONE
  const abs = Math.abs(k)
  if (Math.round(abs) === 0) return '$0k'
  return k < 0 ? `${MINUS}${magnitude(abs)}` : magnitude(abs)
}

// Money where zero means "nothing here" — no loan, no repairs owed, no
// launch cost: an em dash instead of a noisy "$0k". Use plain money() when
// zero is itself a meaningful result (profit, a balance, a change).
export function moneyOrNone(k: number | null | undefined): string {
  if (k === null || k === undefined || !Number.isFinite(k) || Math.round(k) === 0) return NONE
  return money(k)
}

// A change, always signed: "+$5.6M", "−$1.9M", and an unsigned "$0k" for no
// change at all.
export function signedMoney(k: number): string {
  return Number.isFinite(k) && Math.round(k) > 0 ? `+${magnitude(k)}` : money(k)
}

// Plain signed number with the same minus glyph ("+12", "−3", "0").
export function signed(n: number, digits = 0): string {
  if (!Number.isFinite(n)) return NONE
  const text = Math.abs(n).toFixed(digits)
  if (Number(text) === 0) return (0).toFixed(digits)
  return n > 0 ? `+${text}` : `${MINUS}${text}`
}

// Signed whole count with thousands separators ("+1,200", "−35", "0").
export function signedCount(n: number): string {
  const text = Math.abs(n).toLocaleString('en-US')
  return n > 0 ? `+${text}` : n < 0 ? `${MINUS}${text}` : '0'
}

// Sign colour for any figure where up is good (or, with `invert`, where up is
// bad — costs, fuel). Zero is neutral: an empty class, never green or red.
export type Tone = 'pos' | 'neg' | ''
export function tone(n: number, invert = false): Tone {
  if (n === 0 || Number.isNaN(n)) return ''
  return (n > 0) !== invert ? 'pos' : 'neg'
}

export function pct(bp: number, digits = 0): string {
  if (!Number.isFinite(bp)) return NONE
  const text = (Math.abs(bp) / 100).toFixed(digits)
  return bp < 0 && Number(text) !== 0 ? `${MINUS}${text}%` : `${text}%`
}

// A signed percentage from basis points: "+2.5%", "−0.4%", "0.0%".
export function signedPct(bp: number, digits = 0): string {
  return `${signed(bp / 100, digits)}%`
}

export function count(n: number): string {
  return n.toLocaleString('en-US')
}

import type { CostBreakdown } from '../engine'

// Clipboard with feedback: every copy action confirms via toast or says why
// it failed (non-secure context, permission denied) — five silent buttons
// used to look broken, one of them the game's entire share loop.
export function copyText(text: string, label: string): void {
  const write = navigator.clipboard?.writeText(text)
  if (!write) {
    announce(`Clipboard unavailable — ${label} not copied`, '⚠️', 'error')
    return
  }
  write.then(
    () => announce(`${label} copied to clipboard`),
    () => announce(`Copy blocked by the browser — ${label} not copied`, '⚠️', 'error'),
  )
}

// Rows → clipboard TSV: the spreadsheet bridge. Numbers go raw (no $/commas)
// so formulas work on paste.
export function copyTsv(header: readonly string[], rows: readonly (string | number)[][], label = 'Table'): void {
  const tsv = [header.join('\t'), ...rows.map((r) => r.join('\t'))].join('\n')
  copyText(tsv, label)
}

// Human labels for the engine's cost buckets, shared by every surface that
// presents a breakdown.
export const COST_LABELS: Record<keyof CostBreakdown, string> = {
  fuel: 'Fuel',
  fees: 'Landing fees',
  flightPay: 'Flight pay',
  service: 'Cabin service',
  salaries: 'Crew salaries',
  ownership: 'Ownership & leases',
  maintenance: 'Maintenance',
  admin: 'Fleet admin',
  slots: 'Airport slots',
  overhead: 'Overhead',
  marketing: 'Marketing',
  interest: 'Interest',
}

// Highlight for the best value in a comparison column. A column where the
// "best" is zero (nobody has flown yet, everybody broke even) has no leader.
export function leaderTone(value: number, best: number): Tone {
  return best > 0 && value === best ? 'pos' : ''
}

// An objective score rendered in its own units: money, a passenger count, or
// a load-factor rate. One formatter so the HUD, the menu, the standings and
// the game-over card all read identically.
export function objectiveValue(score: number, unit: 'money' | 'count' | 'rate'): string {
  if (unit === 'money') return money(score)
  if (unit === 'rate') return pct(score, 1)
  return score.toLocaleString('en-US')
}

// "1 route", "3 routes" — counts in running text agree with their noun.
export function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? singular : pluralForm}`
}

// A lead time in plain words: "this quarter", "next quarter", "in 5 quarters".
// Never "in 0q".
export function inQuarters(n: number): string {
  if (n <= 0) return 'this quarter'
  if (n === 1) return 'next quarter'
  return `in ${n} quarters`
}

// Joins the parts that are present with a middle dot — no leading, trailing
// or doubled separators ("Checks $480k ·" read as if something was cut off).
export function joinParts(parts: readonly (string | false | null | undefined | 0)[], sep = ' · '): string {
  return parts.filter((p): p is string => typeof p === 'string' && p.length > 0).join(sep)
}
