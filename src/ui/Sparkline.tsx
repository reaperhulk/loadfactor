// Tiny SVG charts for stats surfaces: a single-series sparkline and a
// multi-series line chart (the net-worth race). Pure presentation.

import { useCallback, useEffect, useRef, useState } from 'react'
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

// The pure geometry behind a sparkline, kept apart from the markup so it can
// be tested. A plot band sits under a strip of end-value labels; each point
// gets a quarter tick on the bottom edge, and a zero baseline is drawn only
// when the series actually crosses zero (a line hovering at $40M does not
// need a floor forty million below it).
export const SPARK_LABEL_BAND = 13
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
      <text className="spark-label" x={0} y={10} textAnchor="start">{format(points[0]!)}</text>
      <text className="spark-label spark-label-last" x={width} y={10} textAnchor="end">{format(points[points.length - 1]!)}</text>
    </svg>
  )
}

export interface RaceSeries {
  label: string
  points: readonly number[]
  className: string
}

// X-axis ticks that never crowd: a whole step of quarters (1, 2, then whole
// years) wide enough that neighbouring labels sit at least `minGap` pixels
// apart, starting at the first point. The last point gets a tick too when it
// has room. Returns point indices.
export function raceTicks(count: number, plotWidth: number, minGap = 72): number[] {
  if (count <= 0) return []
  if (count === 1) return [0]
  const perIndex = plotWidth / (count - 1)
  const steps = [1, 2, 4, 8, 12, 16, 20, 40, 80]
  const step = steps.find((s) => s * perIndex >= minGap) ?? count - 1
  const out: number[] = []
  for (let i = 0; i < count; i += step) out.push(i)
  const last = count - 1
  if (out[out.length - 1] !== last && (last - out[out.length - 1]!) * perIndex >= minGap) out.push(last)
  return out
}

// Rough label width in px at the chart's 11px tabular font — enough to size
// the gutters so labels never run off the edge or into the lines.
export function labelWidth(text: string, px = 11): number {
  return Math.ceil(text.length * px * 0.62)
}

// Width of the element, tracked with a ResizeObserver: the chart is drawn at
// true pixel size so its labels stay at the app's type sizes on any screen
// (a scaled viewBox turned 8px labels into 30px headlines on a desktop).
function useWidth(fallback: number): [React.RefCallback<HTMLDivElement>, number] {
  const [width, setWidth] = useState(fallback)
  const observer = useRef<ResizeObserver | null>(null)
  const ref = useCallback((el: HTMLDivElement | null) => {
    observer.current?.disconnect()
    observer.current = null
    if (!el) return
    const measure = () => {
      const w = Math.floor(el.getBoundingClientRect().width)
      if (w > 0) setWidth(w)
    }
    measure()
    if (typeof ResizeObserver !== 'undefined') {
      observer.current = new ResizeObserver(measure)
      observer.current.observe(el)
    }
  }, [])
  useEffect(() => () => observer.current?.disconnect(), [])
  return [ref, width]
}

// Multi-series chart with a shared y-scale — who's winning, at a glance.
// Gridlines with real values, per-series end labels and a legend turn the
// picture into data: no guessing what a line is or what it is worth.
export function RaceChart({
  series,
  height = 220,
  format = money,
  target,
  xLabel = (i) => `Q${i + 1}`,
  label = 'The race by airline over time',
}: {
  series: readonly RaceSeries[]
  height?: number
  format?: (v: number) => string
  // A ghost line to race against (e.g. a challenger's final net worth) —
  // always kept inside the y-scale so the number to beat stays visible.
  target?: { v: number; label: string }
  // The date under point i ("1961 Q1").
  xLabel?: (i: number) => string
  label?: string
}) {
  const [ref, width] = useWidth(640)
  const all = series.flatMap((s) => s.points)
  if (all.length < 2) return <p className="hint">Play a few quarters to see the race.</p>
  const count = Math.max(...series.map((s) => s.points.length))
  const lo = Math.min(0, ...all)
  const hi = Math.max(...all, target?.v ?? -Infinity)
  const span = hi - lo || 1
  const top = 10, bottom = height - 22 // room for the date axis
  const yFor = (v: number) => bottom - ((v - lo) / span) * (bottom - top)
  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((f) => ({ v: lo + span * f, y: yFor(lo + span * f) }))
  const endText = series.map((s) => (s.points.length >= 2 ? format(Math.round(s.points[s.points.length - 1]!)) : ''))
  const plotX0 = Math.max(...gridLines.map((g) => labelWidth(format(Math.round(g.v))))) + 10
  const plotX1 = width - Math.max(24, ...endText.map((t) => labelWidth(t))) - 12
  const xFor = (i: number) => plotX0 + (count > 1 ? (i * (plotX1 - plotX0)) / (count - 1) : 0)
  const line = (points: readonly number[]) => points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xFor(i).toFixed(1)},${yFor(p).toFixed(1)}`).join('')
  // End labels sit where each line ends, then get pushed apart a full line
  // height so airlines finishing neck and neck never overprint.
  const endLabelY = spreadLabels(
    series.map((s) => (s.points.length >= 2 ? yFor(s.points[s.points.length - 1]!) + 4 : Number.NaN)),
    top + 4,
    bottom + 4,
    14,
  )
  const ticks = raceTicks(count, plotX1 - plotX0, Math.max(64, labelWidth(xLabel(count - 1)) + 16))
  return (
    <figure className="race-figure">
      <div ref={ref} className="race-chart-frame">
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="race-chart" role="img" aria-label={label}>
          {gridLines.map((g, k) => (
            <g key={k}>
              <line x1={plotX0} x2={plotX1} y1={g.y} y2={g.y} className={k === 0 ? 'chart-baseline' : 'chart-grid'} />
              <text x={plotX0 - 6} y={g.y + 4} textAnchor="end" className="chart-grid-label">
                {format(Math.round(g.v))}
              </text>
            </g>
          ))}
          {target && (
            <g data-testid="race-target">
              <line x1={plotX0} x2={plotX1} y1={yFor(target.v)} y2={yFor(target.v)} className="race-target-line" />
              <text x={plotX0 + 4} y={Math.max(top + 10, yFor(target.v) - 4)} className="race-target-label">
                {target.label} {format(Math.round(target.v))}
              </text>
            </g>
          )}
          <g className="chart-axis">
            {ticks.map((i) => (
              <text
                key={i}
                x={xFor(i)}
                y={height - 5}
                className="chart-axis-label"
                textAnchor={i === 0 ? 'start' : i === count - 1 ? 'end' : 'middle'}
              >
                {xLabel(i)}
              </text>
            ))}
          </g>
          {series.map((s, i) =>
            s.points.length >= 2 ? (
              <g key={s.label}>
                <path d={line(s.points)} fill="none" className={`race-line ${s.className}`} />
                <text x={plotX1 + 8} y={endLabelY[i]} className={`chart-end-label ${s.className}`}>
                  {endText[i]}
                </text>
              </g>
            ) : null,
          )}
        </svg>
      </div>
      <figcaption className="race-legend" data-testid="race-legend">
        {series.map((s) => (
          <span key={s.label} className={`race-key ${s.className}`}>
            <span className="race-swatch" aria-hidden="true" />
            {s.label}
          </span>
        ))}
      </figcaption>
    </figure>
  )
}
