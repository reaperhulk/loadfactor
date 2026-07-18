import { useEffect, useState, useSyncExternalStore } from 'react'
import { SCENARIOS, getScenario } from '../data/scenarios'
import { netWorth, quarterOf, yearOf } from '../engine/queries'
import { useCountUp } from './countUp'
import { MapView } from './MapView'
import { AirportsPanel, FinancePanel, FleetPanel, ReportPanel, RoutesPanel } from './panels'
import { ReplayViewer } from './ReplayViewer'
import { dispatch, getReplay, getSession, loadSave, resumeSave, startGame, reset } from './session'
import { subscribe } from './session'
import { ToastStack } from './toasts'
import type { GameState, Replay } from '../engine'

type Tab = 'routes' | 'fleet' | 'airports' | 'finance' | 'report'

function money(k: number): string {
  return k >= 1000 || k <= -1000 ? `$${(k / 1000).toFixed(1)}M` : `$${k}k`
}

function ScenarioSelect({ onWatchReplay }: { onWatchReplay: (replay: Replay) => void }) {
  const [seed, setSeed] = useState('')
  const save = loadSave()
  return (
    <main className="menu">
      <h1>Load Factor</h1>
      <p className="tagline">Routes. Jets. Margins. Fill the seats.</p>
      {save && (
        <div className="scenario-card continue-card">
          <h2>Saved game</h2>
          <p className="dim">
            {save.scenario} · seed “{save.seed}” · {save.commands.filter((c) => c.type === 'end_quarter').length}{' '}
            quarters played
          </p>
          <button data-testid="continue-save" onClick={() => resumeSave()}>
            Continue
          </button>{' '}
          <button data-testid="watch-save-replay" onClick={() => onWatchReplay(save)}>
            Watch replay
          </button>
        </div>
      )}
      {SCENARIOS.map((s) => (
        <div key={s.id} className="scenario-card">
          <h2>{s.name}</h2>
          <p>{s.description}</p>
          <label>
            Seed (optional):{' '}
            <input
              value={seed}
              placeholder="random each day"
              onChange={(e) => setSeed(e.target.value)}
              data-testid="seed-input"
            />
          </label>
          <button
            data-testid={`start-${s.id}`}
            onClick={() => startGame(s.id, seed || new Date().toISOString().slice(0, 10))}
          >
            Start
          </button>
        </div>
      ))}
    </main>
  )
}

const TABS: readonly Tab[] = ['routes', 'fleet', 'airports', 'finance', 'report']

// Final standings, ranked — the scenario is a race, show the podium.
function GameOverOverlay({ state, onWatchReplay }: { state: GameState; onWatchReplay: (r: Replay) => void }) {
  const ranked = [...state.airlines].sort((a, b) => netWorth(b) - netWorth(a))
  return (
    <div className="gameover-overlay" data-testid="gameover-overlay">
      <div className="gameover-card">
        <h2 className={state.phase === 'won' ? 'pos' : 'neg'}>
          {state.phase === 'won' ? '🏆 VICTORY' : 'DEFEAT'}
        </h2>
        <ol>
          {ranked.map((a) => (
            <li key={a.id} className={a.id === 0 ? 'me' : ''}>
              {a.name} — {a.bankrupt ? 'bankrupt' : money(netWorth(a))}
            </li>
          ))}
        </ol>
        <button
          data-testid="watch-replay"
          onClick={() => {
            const replay = getReplay()
            if (replay) onWatchReplay(replay)
          }}
        >
          Watch replay
        </button>{' '}
        <button data-testid="new-game" onClick={() => reset()}>
          New game
        </button>
      </div>
    </div>
  )
}

function GameScreen({ onWatchReplay }: { onWatchReplay: (r: Replay) => void }) {
  const session = getSession()!
  const [tab, setTab] = useState<Tab>('routes')
  const [selectedCity, setSelectedCity] = useState<string | null>(null)
  const state = session.state
  const player = state.airlines[0]!
  const scenario = getScenario(state.scenario)

  // Keyboard shortcuts: Space/E end the quarter, 1–5 switch panels, Esc
  // clears the map selection. Ignored while typing in a form control.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null
      if (target && ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(target.tagName)) return
      if (e.key === ' ' || e.key === 'e' || e.key === 'E') {
        e.preventDefault()
        if (getSession()?.state.phase === 'planning') dispatch({ type: 'end_quarter' })
      } else if (e.key >= '1' && e.key <= String(TABS.length)) {
        setTab(TABS[Number(e.key) - 1]!)
      } else if (e.key === 'Escape') {
        setSelectedCity(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const shownCash = useCountUp(player.cash)
  const shownWorth = useCountUp(netWorth(player))

  return (
    <main className="game">
      <header>
        <h1>Load Factor</h1>
        <span data-testid="date">
          {yearOf(state)} Q{quarterOf(state)}
        </span>
        <span data-testid="cash">Cash {money(shownCash)}</span>
        <span data-testid="networth">
          Net worth {money(shownWorth)} / {money(scenario.targetNetWorth)}
        </span>
        {state.phase === 'planning' && (
          <button className="end-quarter" data-testid="end-quarter" onClick={() => dispatch({ type: 'end_quarter' })}>
            End Quarter ▶
          </button>
        )}
      </header>
      {state.phase !== 'planning' && <GameOverOverlay state={state} onWatchReplay={onWatchReplay} />}
      <MapView
        state={state}
        selected={selectedCity}
        onSelect={setSelectedCity}
        newRouteIds={
          new Set(
            session.lastEvents
              .filter((e) => e.type === 'route_opened' && e.airline === 0)
              .map((e) => (e.type === 'route_opened' ? e.routeId : -1)),
          )
        }
        newSlotCities={
          new Set(
            session.lastEvents
              .filter((e) => e.type === 'slots_granted' && e.airline === 0)
              .map((e) => (e.type === 'slots_granted' ? e.city : '')),
          )
        }
      />
      <ToastStack events={session.lastEvents} />
      <nav className="tabs">
        {TABS.map((t, i) => (
          <button
            key={t}
            className={tab === t ? 'active' : ''}
            data-testid={`tab-${t}`}
            onClick={() => setTab(t)}
            title={`shortcut: ${i + 1}`}
          >
            {t}
          </button>
        ))}
        <span className="key-hints">space = end quarter · 1–5 = panels · esc = deselect</span>
      </nav>
      <section className="panel">
        {tab === 'routes' && <RoutesPanel state={state} />}
        {tab === 'fleet' && <FleetPanel state={state} />}
        {tab === 'airports' && <AirportsPanel state={state} />}
        {tab === 'finance' && <FinancePanel state={state} />}
        {tab === 'report' && <ReportPanel state={state} events={session.reportEvents} />}
      </section>
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

export function App() {
  const session = useSyncExternalStore(subscribe, getSession)
  const [replay, setReplay] = useState<Replay | null>(null)
  if (replay) return <ReplayViewer replay={replay} onExit={() => setReplay(null)} />
  return session ? (
    <GameScreen onWatchReplay={setReplay} />
  ) : (
    <ScenarioSelect onWatchReplay={setReplay} />
  )
}
