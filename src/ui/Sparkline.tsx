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
export function RaceChart({ series, width = 320, height = 120 }: { series: readonly RaceSeries[]; width?: number; height?: number }) {
  const all = series.flatMap((s) => s.points)
  if (all.length < 2) return <p className="hint">Play a few quarters to see the race.</p>
  const lo = Math.min(0, ...all)
  const hi = Math.max(...all)
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
            {money(Math.round(g.v))}
          </text>
        </g>
      ))}
      {series.map((s) =>
        s.points.length >= 2 ? (
          <g key={s.label}>
            <path d={path(s.points, plotW, height, lo, hi)} fill="none" className={s.className} />
            <text
              x={plotW + 3}
              y={Math.max(8, Math.min(height - 2, yFor(s.points[s.points.length - 1]!) + 3))}
              className={`chart-end-label ${s.className}`}
            >
              {money(Math.round(s.points[s.points.length - 1]!))}
            </text>
          </g>
        ) : null,
      )}
    </svg>
  )
}
