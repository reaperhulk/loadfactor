// Watch a finished (or in-progress) game re-run itself — determinism as a
// feature. The full career is refolded through the engine once, snapshotting
// at every quarter boundary; the viewer then just scrubs snapshots.

import { useEffect, useMemo, useState } from 'react'
import { applyCommand, newGame, type GameState, type Replay } from '../engine'
import { netWorth, quarterOf, yearOf } from '../engine/queries'
import { MapView } from './MapView'
import { money } from './format'

const EMPTY = new Set<never>()

function snapshotQuarters(replay: Replay): GameState[] {
  const snapshots: GameState[] = []
  let state = newGame(replay.scenario, replay.seed)
  snapshots.push(state)
  for (const command of replay.commands) {
    state = applyCommand(state, command).state
    if (command.type === 'end_quarter') snapshots.push(state)
  }
  return snapshots
}

export function ReplayViewer({ replay, onExit }: { replay: Replay; onExit: () => void }) {
  const snapshots = useMemo(() => snapshotQuarters(replay), [replay])
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(true)
  const last = snapshots.length - 1

  useEffect(() => {
    if (!playing) return
    const timer = setInterval(() => {
      setIndex((i) => {
        if (i >= last) {
          setPlaying(false)
          return i
        }
        return i + 1
      })
    }, 600)
    return () => clearInterval(timer)
  }, [playing, last])

  const state = snapshots[index]!
  return (
    <main className="game replay" data-testid="replay-viewer">
      <header>
        <h1>Load Factor</h1>
        <span className="replay-badge">REPLAY</span>
        <span data-testid="replay-date">
          {yearOf(state)} Q{quarterOf(state)}
        </span>
        <span>{replay.seed}</span>
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
        <button onClick={() => setIndex(0)} title="restart">
          ⏮
        </button>
        <button onClick={() => setIndex((i) => Math.max(0, i - 1))} title="back one quarter">
          ⏪
        </button>
        <button onClick={() => setPlaying((p) => !p)} data-testid="replay-playpause">
          {playing ? '⏸' : '▶'}
        </button>
        <button
          onClick={() => setIndex((i) => Math.min(last, i + 1))}
          title="forward one quarter"
          data-testid="replay-step"
        >
          ⏩
        </button>
        <input
          type="range"
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
