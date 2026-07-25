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
}

function path(points: readonly number[], w: number, h: number, lo: number, hi: number): string {
  const span = hi - lo || 1
  const step = points.length > 1 ? w / (points.length - 1) : 0
  return points
    .map((p, i) => {
      const px = (i * step).toFixed(1)
      const py = (h - ((p - lo) / span) * (h - 2) - 1).toFixed(1)
      return `${i === 0 ? 'M' : 'L'}${px},${py}`
    })
    .join('')
}

export function Sparkline({ points, width = 120, height = 28, className, min, max }: SparklineProps) {
  if (points.length < 2) return <span className="dim">—</span>
  const lo = min ?? Math.min(...points)
  const hi = max ?? Math.max(...points)
  return (
    <svg width={width} height={height} className={className ?? 'sparkline'} aria-hidden="true">
      <path d={path(points, width, height, lo, hi)} fill="none" />
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
          <line x1={0} x2={plotW} y1={g.y} y2={g.y} className="chart-grid" />
          <text x={2} y={g.y - 2} className="chart-grid-label">
            {format(Math.round(g.v))}
          </text>
        </g>
      ))}
      {target && (
        <g data-testid="race-target">
          <line x1={0} x2={plotW} y1={yFor(target.v)} y2={yFor(target.v)} className="race-target-line" />
          <text x={2} y={Math.max(8, yFor(target.v) - 3)} className="race-target-label">
            {target.label} {format(Math.round(target.v))}
          </text>
        </g>
      )}
      {/* A time axis. The chart had a y-scale but nothing saying the x was
          quarters at all, so a rising line carried no sense of HOW LONG. */}
      <g className="chart-axis">
        <line x1={0} x2={plotW} y1={height - 0.5} y2={height - 0.5} />
        {[0, 0.5, 1].map((f) => {
          const q = Math.max(1, Math.round(f * (all.length / series.length || 1)))
          const qx = f * plotW
          return (
            <text
              key={f}
              x={Math.min(plotW - 12, Math.max(2, qx))}
              y={height - 3}
              className="chart-axis-label"
              textAnchor={f === 0 ? 'start' : f === 1 ? 'end' : 'middle'}
            >
              {f === 0 ? 'q1' : `q${q}`}
            </text>
          )
        })}
      </g>
      {series.map((s) =>
        s.points.length >= 2 ? (
          <g key={s.label}>
            <path d={path(s.points, plotW, height, lo, hi)} fill="none" className={s.className} />
            <text
              x={plotW + 3}
              y={Math.max(8, Math.min(height - 2, yFor(s.points[s.points.length - 1]!) + 3))}
              className={`chart-end-label ${s.className}`}
            >
              {format(Math.round(s.points[s.points.length - 1]!))}
            </text>
          </g>
        ) : null,
      )}
    </svg>
  )
}
