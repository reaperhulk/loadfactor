import { announce } from './toasts'
// One money formatter for every surface: $k in, human string out. Keeping a
// single definition means every panel rounds and tiers the same way —
// comparisons only work when the numbers are presented identically.

export function money(k: number): string {
  const abs = Math.abs(k)
  if (abs >= 1_000_000) return `$${(k / 1_000_000).toFixed(2)}B`
  if (abs >= 1000) return `$${(k / 1000).toFixed(1)}M`
  return `$${k}k`
}

export function pct(bp: number, digits = 0): string {
  return `${(bp / 100).toFixed(digits)}%`
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

// An objective score rendered in its own units: money, a passenger count, or
// a load-factor rate. One formatter so the HUD, the menu, the standings and
// the game-over card all read identically.
export function objectiveValue(score: number, unit: 'money' | 'count' | 'rate'): string {
  if (unit === 'money') return money(score)
  if (unit === 'rate') return `${(score / 100).toFixed(1)}%`
  return score.toLocaleString('en-US')
}
