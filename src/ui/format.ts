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

// Human labels for the engine's cost buckets, shared by every surface that
// presents a breakdown.
// Rows → clipboard TSV: the spreadsheet bridge. Numbers go raw (no $/commas)
// so formulas work on paste.
export function copyTsv(header: readonly string[], rows: readonly (string | number)[][]): void {
  const tsv = [header.join('\t'), ...rows.map((r) => r.join('\t'))].join('\n')
  void navigator.clipboard?.writeText(tsv)
}

export const COST_LABELS: Record<keyof CostBreakdown, string> = {
  fuel: 'Fuel',
  fees: 'Landing fees',
  flightPay: 'Flight pay',
  service: 'Cabin service',
  salaries: 'Crew salaries',
  ownership: 'Ownership & leases',
  maintenance: 'Maintenance',
  admin: 'Fleet admin',
  overhead: 'Overhead',
  marketing: 'Marketing',
  interest: 'Interest',
}
