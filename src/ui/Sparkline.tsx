// Tiny SVG charts for stats surfaces: a single-series sparkline and a
// multi-series line chart (the net-worth race). Pure presentation.

import { money } from './format'

interface SparklineProps {
  points: readonly number[]
  width?: number
  height?: number
  className?: string
  // Optional fixed bounds (e.g. 0..10000 for load factor); else auto-fit.
  min?: number
  max?: number
  // How a value reads in the end labels and the accessible summary.
  format?: (v: number) => string
  // What the series is ("Profit per quarter"), for screen readers.
  label?: string
}

function path(points: readonly number[], w: number, h: number, lo: number, hi: number, x0 = 0): string {
  const span = hi - lo || 1
  const step = points.length > 1 ? (w - x0) / (points.length - 1) : 0
  return points
    .map((p, i) => {
      const px = (x0 + i * step).toFixed(1)
      const py = (h - ((p - lo) / span) * (h - 2) - 1).toFixed(1)
      return `${i === 0 ? 'M' : 'L'}${px},${py}`
    })
    .join('')
}

// The pure geometry behind a sparkline, kept apart from the markup so it can
// be tested. A plot band sits under a strip of end-value labels; each point
// gets a quarter tick on the bottom edge, and a zero baseline is drawn only
// when the series actually crosses zero (a line hovering at $40M does not
// need a floor forty million below it).
export const SPARK_LABEL_BAND = 11
export interface SparkGeometry {
  d: string
  top: number
  bottom: number
  zeroY: number | null
  ticks: number[]
  first: { x: number; y: number }
  last: { x: number; y: number }
}
export function sparkGeometry(points: readonly number[], width: number, height: number, min?: number, max?: number): SparkGeometry {
  const lo = min ?? Math.min(...points)
  const hi = max ?? Math.max(...points)
  const top = SPARK_LABEL_BAND, bottom = height - 3 // leave room for tick marks
  const plotH = bottom - top
  const span = hi - lo || 1
  const step = points.length > 1 ? width / (points.length - 1) : 0
  const xAt = (i: number) => Math.min(width - 0.5, Math.max(0.5, i * step))
  const yAt = (v: number) => top + plotH - ((v - lo) / span) * (plotH - 2) - 1
  const round = (n: number) => Math.round(n * 10) / 10
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(1)},${yAt(p).toFixed(1)}`).join('')
  return {
    d,
    top,
    bottom,
    zeroY: lo < 0 && hi > 0 ? round(yAt(0)) : null,
    ticks: points.map((_, i) => round(xAt(i))),
    first: { x: round(xAt(0)), y: round(yAt(points[0]!)) },
    last: { x: round(xAt(points.length - 1)), y: round(yAt(points[points.length - 1]!)) },
  }
}

// One sentence a screen reader can use in place of the picture.
export function sparkSummary(points: readonly number[], format: (v: number) => string, label = 'Trend'): string {
  if (points.length === 0) return `${label}: no data`
  const lo = Math.min(...points), hi = Math.max(...points)
  return `${label} over ${points.length} quarters: from ${format(points[0]!)} to ${format(points[points.length - 1]!)}; low ${format(lo)}, high ${format(hi)}`
}

// Nudge a set of label baselines apart by at least `gap`, inside [top, bottom],
// keeping their order. NaN entries (series with no line) pass through.
export function spreadLabels(ys: readonly number[], top: number, bottom: number, gap: number): number[] {
  const order = ys.map((y, i) => ({ y, i })).filter((e) => !Number.isNaN(e.y)).sort((a, b) => a.y - b.y)
  const placed = order.map((e) => Math.max(top, Math.min(bottom, e.y)))
  for (let k = 1; k < placed.length; k++) placed[k] = Math.max(placed[k]!, placed[k - 1]! + gap)
  // Ran off the bottom: walk back up, closing from the last label.
  for (let k = placed.length - 1; k >= 0; k--) {
    const limit = k === placed.length - 1 ? bottom : placed[k + 1]! - gap
    if (placed[k]! > limit) placed[k] = limit
  }
  const out = [...ys]
  order.forEach((e, k) => { out[e.i] = placed[k]! })
  return out
}

export function Sparkline({ points, width = 120, height = 28, className, min, max, format = money, label }: SparklineProps) {
  if (points.length < 2) return <span className="dim">—</span>
  const svgH = height + SPARK_LABEL_BAND
  const g = sparkGeometry(points, width, svgH, min, max)
  const summary = sparkSummary(points, format, label)
  return (
    <svg width={width} height={svgH} viewBox={`0 0 ${width} ${svgH}`} className={className ?? 'sparkline'} role="img" aria-label={summary} data-testid="sparkline">
      <title>{summary}</title>
      {g.ticks.map((x, i) => <line key={i} className="spark-tick" x1={x} x2={x} y1={g.bottom + 1} y2={svgH} />)}
      {g.zeroY !== null && <line className="spark-zero" x1={0} x2={width} y1={g.zeroY} y2={g.zeroY} />}
      <path d={g.d} fill="none" />
      <circle className="spark-end" cx={g.last.x} cy={g.last.y} r={1.8} />
      <text className="spark-label" x={0} y={8} textAnchor="start">{format(points[0]!)}</text>
      <text className="spark-label spark-label-last" x={width} y={8} textAnchor="end">{format(points[points.length - 1]!)}</text>
    </svg>
  )
}

export interface RaceSeries {
  label: string
  points: readonly number[]
  className: string
}

// Multi-series chart with a shared y-scale — who's winning, at a glance.
// Gridlines with real values and per-series end labels turn the picture
// into data: no guessing what a line is worth.
export function RaceChart({
  series,
  width = 320,
  height = 120,
  format = money,
  target,
}: {
  series: readonly RaceSeries[]
  width?: number
  height?: number
  format?: (v: number) => string
  // A ghost line to race against (e.g. a challenger's final net worth) —
  // always kept inside the y-scale so the number to beat stays visible.
  target?: { v: number; label: string }
}) {
  const all = series.flatMap((s) => s.points)
  if (all.length < 2) return <p className="hint">Play a few quarters to see the race.</p>
  const lo = Math.min(0, ...all)
  const hi = Math.max(...all, target?.v ?? -Infinity)
  const span = hi - lo || 1
  const yFor = (v: number) => height - ((v - lo) / span) * (height - 2) - 1
  const gridLines = [0.25, 0.5, 0.75].map((f) => ({ v: lo + span * f, y: yFor(lo + span * f) }))
  const plotW = width - 56 // reserve a gutter for end labels
  // End labels sit where each line ends, then get pushed apart so two
  // airlines finishing neck and neck do not overprint into one smudge.
  const endLabelY = spreadLabels(
    series.map((s) => (s.points.length >= 2 ? yFor(s.points[s.points.length - 1]!) + 3 : Number.NaN)),
    8,
    height - 2,
    9,
  )
  const plotX0 = 40 // and one on the left for the scale, clear of the line starts
  return (
    <svg
      width="100%"
      viewBox={`0 0 ${width} ${height}`}
      className="race-chart"
      role="img"
      aria-label="Net worth over time by airline"
    >
      {gridLines.map((g) => (
        <g key={g.y}>
          <line x1={plotX0} x2={plotW} y1={g.y} y2={g.y} className="chart-grid" />
          <text x={2} y={g.y - 2} className="chart-grid-label">
            {format(Math.round(g.v))}
          </text>
        </g>
      ))}
      {target && (
        <g data-testid="race-target">
          <line x1={plotX0} x2={plotW} y1={yFor(target.v)} y2={yFor(target.v)} className="race-target-line" />
          <text x={plotX0 + 2} y={Math.max(8, yFor(target.v) - 3)} className="race-target-label">
            {target.label} {format(Math.round(target.v))}
          </text>
        </g>
      )}
      {/* A time axis. The chart had a y-scale but nothing saying the x was
          quarters at all, so a rising line carried no sense of HOW LONG. */}
      <g className="chart-axis">
        <line x1={plotX0} x2={plotW} y1={height - 0.5} y2={height - 0.5} />
        {[0, 0.5, 1].map((f) => {
          const q = Math.max(1, Math.round(f * (all.length / series.length || 1)))
          const qx = plotX0 + f * (plotW - plotX0)
          return (
            <text
              key={f}
              x={Math.min(plotW - 12, Math.max(plotX0, qx))}
              y={height - 3}
              className="chart-axis-label"
              textAnchor={f === 0 ? 'start' : f === 1 ? 'end' : 'middle'}
            >
              {f === 0 ? 'q1' : `q${q}`}
            </text>
          )
        })}
      </g>
      {series.map((s, i) =>
        s.points.length >= 2 ? (
          <g key={s.label}>
            <path d={path(s.points, plotW, height, lo, hi, plotX0)} fill="none" className={s.className} />
            <text x={plotW + 3} y={endLabelY[i]} className={`chart-end-label ${s.className}`}>
              {format(Math.round(s.points[s.points.length - 1]!))}
            </text>
          </g>
        ) : null,
      )}
    </svg>
  )
}
