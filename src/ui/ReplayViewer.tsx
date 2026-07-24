// Watch a finished (or in-progress) game re-run itself — determinism as a
// feature. The full career is refolded through the engine once, snapshotting
// at every quarter boundary; the viewer then just scrubs snapshots.

import { useEffect, useMemo, useState } from 'react'
import { getScenario } from '../data/scenarios'
import { applyCommand, newGame, type GameEvent, type GameState, type Replay } from '../engine'
import { netWorth, quarterOf, yearOf } from '../engine/queries'
import { MapView } from './MapView'
import { RaceChart } from './Sparkline'
import { EVENT_ICONS, EVENT_NAMES } from './toasts'
import { money } from './format'

const EMPTY = new Set<never>()

interface ReplayFrame {
  state: GameState
  headlines: string[] // the quarter's big beats, for the narration strip
}

// The story beats worth narrating while decades scrub past: world events,
// bankruptcies, consolidation, the player's city wins, and the ending.
function headlinesFor(state: GameState, events: GameEvent[]): string[] {
  const out: string[] = []
  const name = (i: number): string => state.airlines[i]?.name ?? `airline ${i}`
  for (const e of events) {
    switch (e.type) {
      case 'world_event_started':
        out.push(`${EVENT_ICONS[e.eventId] ?? '🌍'} ${EVENT_NAMES[e.eventId] ?? e.eventId}${e.city ? ` — ${e.city}` : ''}`)
        break
      case 'airline_bankrupt':
        out.push(`🕯️ ${name(e.airline)} went bankrupt`)
        break
      case 'rival_acquired':
        out.push(`💼 ${name(e.airline)} acquired ${name(e.target)}`)
        break
      case 'slots_granted':
        if (e.airline === 0) out.push(`🤝 won slots at ${e.city}`)
        break
      case 'game_over':
        out.push(e.result === 'won' ? `🏆 ${e.reason}` : `🕯️ ${e.reason}`)
        break
      default:
        break
    }
  }
  return out.slice(0, 4)
}

function snapshotQuarters(replay: Replay): ReplayFrame[] {
  const frames: ReplayFrame[] = []
  // The player customization is part of the replay — without it a custom-HQ
  // career would replay against the wrong world and silently diverge.
  let state = newGame(replay.scenario, replay.seed, replay.player)
  frames.push({ state, headlines: [] })
  for (const command of replay.commands) {
    const res = applyCommand(state, command)
    state = res.state
    if (command.type === 'end_quarter') {
      frames.push({ state, headlines: headlinesFor(state, res.events) })
    }
  }
  return frames
}

export function ReplayViewer({ replay, onExit }: { replay: Replay; onExit: () => void }) {
  const frames = useMemo(() => snapshotQuarters(replay), [replay])
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [fast, setFast] = useState(false)
  const last = frames.length - 1

  useEffect(() => {
    if (!playing) return
    const timer = setInterval(
      () => {
        setIndex((i) => {
          if (i >= last) {
            setPlaying(false)
            return i
          }
          return i + 1
        })
      },
      fast ? 150 : 600,
    )
    return () => clearInterval(timer)
  }, [playing, fast, last])

  const state = frames[index]!.state
  const headlines = frames[index]!.headlines
  return (
    <main className="game replay" data-testid="replay-viewer">
      <header>
        <h1>Load Factor</h1>
        <span className="replay-badge">REPLAY</span>
        <span data-testid="replay-identity">
          {state.airlines[0]!.name} · {(() => {
            try {
              return getScenario(replay.scenario).name
            } catch {
              return replay.scenario
            }
          })()}
        </span>
        <span data-testid="replay-date">
          {yearOf(state)} Q{quarterOf(state)}
        </span>
        <span className="dim">seed “{replay.seed}”</span>
        <button className="end-quarter" onClick={onExit} data-testid="replay-exit">
          Exit replay
        </button>
      </header>
      <MapView
        state={state}
        selected={null}
        routeFrom={null}
        onCityClick={() => {}}
        newRouteIds={EMPTY}
        newSlotCities={EMPTY}
      />
      <div className="replay-controls">
        <button onClick={() => setIndex(0)} title="restart" aria-label="restart replay">
          ⏮
        </button>
        <button onClick={() => setIndex((i) => Math.max(0, i - 1))} title="back one quarter" aria-label="back one quarter">
          ⏪
        </button>
        <button onClick={() => setPlaying((p) => !p)} data-testid="replay-playpause" aria-label={playing ? 'pause replay' : 'play replay'}>
          {playing ? '⏸' : '▶'}
        </button>
        <button
          onClick={() => setIndex((i) => Math.min(last, i + 1))}
          title="forward one quarter"
          aria-label="forward one quarter"
          data-testid="replay-step"
        >
          ⏩
        </button>
        <button
          className={fast ? 'active' : ''}
          onClick={() => setFast((f) => !f)}
          title="playback speed"
          aria-label="toggle playback speed"
          data-testid="replay-speed"
        >
          {fast ? '4×' : '1×'}
        </button>
        <input
          type="range"
          aria-label="replay position"
          min={0}
          max={last}
          value={index}
          onChange={(e) => {
            setPlaying(false)
            setIndex(Number(e.target.value))
          }}
        />
        <span className="dim">
          {index}/{last}
        </span>
      </div>
      {/* The quarter's story beats, so decades of oil shocks and takeovers
          don't scrub past as silently appearing arcs. */}
      {headlines.length > 0 && (
        <p className="events-strip replay-headlines" data-testid="replay-headlines">
          {headlines.map((h, i) => (
            <span key={i} className="event-chip">
              {h}
            </span>
          ))}
        </p>
      )}
      {/* The race so far, up to the scrub position — the story under the map. */}
      {index >= 2 && (
        <div className="replay-chart" data-testid="replay-chart">
          <RaceChart
            series={state.airlines.map((a, i) => ({
              label: a.name,
              points: a.history.map((h) => h.netWorth),
              className: i === 0 ? 'race-me' : `race-rival-${i}`,
            }))}
          />
        </div>
      )}
      <footer className="standings">
        {state.airlines.map((a) => (
          <span key={a.id} className={a.id === 0 ? 'me' : ''}>
            {a.name}: {a.bankrupt ? 'bankrupt' : `${a.routes.length} routes, ${money(netWorth(a))}`}
          </span>
        ))}
      </footer>
    </main>
  )
}
