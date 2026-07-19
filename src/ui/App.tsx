import { useEffect, useState, useSyncExternalStore } from 'react'
import { SCENARIOS, getScenario } from '../data/scenarios'
import { netWorth, quarterOf, yearOf } from '../engine/queries'
import { CityPanel } from './CityPanel'
import { CoachMarks } from './CoachMarks'
import { useCountUp } from './countUp'
import { isMuted, setMuted } from './sounds'
import { MapView } from './MapView'
import { AirportsPanel, FinancePanel, FleetPanel, ReportPanel, RoutesPanel } from './panels'
import { ReplayViewer } from './ReplayViewer'
import { ReportCard } from './ReportCard'
import { RivalsPanel } from './RivalsPanel'
import { RouteDossier } from './RouteDossier'
import { RouteSetupDialog } from './RouteSetupDialog'
import { dispatch, getReplay, getSession, loadSave, resumeSave, startGame, reset } from './session'
import { subscribe } from './session'
import { ToastStack } from './toasts'
import type { GameState, Replay } from '../engine'
import { money } from './format'

type Tab = 'routes' | 'fleet' | 'airports' | 'rivals' | 'finance' | 'report'

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
      <label className="seed-field">
        Seed (optional):{' '}
        <input
          value={seed}
          placeholder="random each day"
          onChange={(e) => setSeed(e.target.value)}
          data-testid="seed-input"
        />
      </label>
      <div className="scenario-card continue-card">
        <h2>Daily challenge</h2>
        <p className="dim">Everyone flies the same seed today. Compare final net worth with your friends.</p>
        <button
          data-testid="start-daily"
          onClick={() => startGame('jet_age', `daily-${new Date().toISOString().slice(0, 10)}`)}
        >
          ▶ Fly today’s seed
        </button>
      </div>
      {SCENARIOS.map((s) => (
        <div key={s.id} className="scenario-card">
          <h2>{s.name}</h2>
          <p>{s.description}</p>
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

const TABS: readonly Tab[] = ['routes', 'fleet', 'airports', 'rivals', 'finance', 'report']

function MuteToggle() {
  const [muted, setMutedState] = useState(isMuted)
  return (
    <button
      className="mute-toggle"
      data-testid="mute-toggle"
      aria-label={muted ? 'unmute sounds' : 'mute sounds'}
      onClick={() => {
        setMuted(!muted)
        setMutedState(!muted)
      }}
    >
      {muted ? '🔇' : '🔊'}
    </button>
  )
}

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
  const [selectedRoute, setSelectedRoute] = useState<number | null>(null)
  const [routeFrom, setRouteFrom] = useState<string | null>(null)
  const [pendingRoute, setPendingRoute] = useState<{ from: string; to: string } | null>(null)
  const [showReport, setShowReport] = useState(false)
  const state = session.state
  const player = state.airlines[0]!
  const scenario = getScenario(state.scenario)

  // Map interaction: a click selects a city (dossier panel). With a route
  // armed from the panel, the next click is the destination.
  const handleCityClick = (cityId: string): void => {
    setSelectedRoute(null)
    if (routeFrom !== null && routeFrom !== cityId) {
      // Destination picked: configure the launch (aircraft, frequency, fare).
      setPendingRoute({ from: routeFrom, to: cityId })
      setRouteFrom(null)
    } else if (routeFrom === cityId) {
      setRouteFrom(null) // clicking the armed origin disarms it
    } else {
      setSelectedCity(selectedCity === cityId ? null : cityId)
    }
  }

  const inspectRoute = (routeId: number): void => {
    setSelectedCity(null)
    setRouteFrom(null)
    setSelectedRoute(routeId)
  }

  const endQuarter = (): void => {
    if (getSession()?.state.phase !== 'planning') return
    dispatch({ type: 'end_quarter' })
    setShowReport(true)
  }

  // Keyboard shortcuts: Space/E end the quarter (or dismiss the report card),
  // 1–6 switch panels, Esc backs out of route mode, then the panel. Ignored
  // while typing in a form control.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null
      if (target && ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(target.tagName)) return
      if (e.key === ' ' || e.key === 'e' || e.key === 'E' || e.key === 'Enter') {
        e.preventDefault()
        setShowReport((open) => {
          if (open) return false
          if (e.key !== 'Enter') {
            // End the quarter only when no report card was in the way.
            if (getSession()?.state.phase === 'planning') {
              dispatch({ type: 'end_quarter' })
              return true
            }
          }
          return open
        })
      } else if (e.key >= '1' && e.key <= String(TABS.length)) {
        setTab(TABS[Number(e.key) - 1]!)
      } else if (e.key === 'Escape') {
        setShowReport(false)
        setSelectedRoute(null)
        setPendingRoute(null)
        setRouteFrom((armed) => {
          if (armed === null) setSelectedCity(null)
          return null
        })
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
        <MuteToggle />
        {state.phase === 'planning' && (
          <button className="end-quarter" data-testid="end-quarter" onClick={endQuarter}>
            End Quarter ▶
          </button>
        )}
      </header>
      <CoachMarks state={state} />
      {showReport && session.reportEvents.length > 0 && (
        <ReportCard state={state} events={session.reportEvents} onClose={() => setShowReport(false)} />
      )}
      {pendingRoute !== null && (
        <RouteSetupDialog
          state={state}
          from={pendingRoute.from}
          to={pendingRoute.to}
          onClose={() => setPendingRoute(null)}
        />
      )}
      {state.phase !== 'planning' && <GameOverOverlay state={state} onWatchReplay={onWatchReplay} />}
      <div className="map-area">
        <MapView
          state={state}
          selected={selectedCity}
          routeFrom={routeFrom}
          onCityClick={handleCityClick}
          onRouteClick={inspectRoute}
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
        {selectedCity !== null && (
          <CityPanel
            state={state}
            cityId={selectedCity}
            routeFrom={routeFrom}
            onPlanRoute={(from) => setRouteFrom(routeFrom === from ? null : from)}
            onClose={() => {
              setSelectedCity(null)
              setRouteFrom(null)
            }}
          />
        )}
        {selectedRoute !== null && (
          <RouteDossier state={state} routeId={selectedRoute} onClose={() => setSelectedRoute(null)} />
        )}
      </div>
      <ToastStack events={session.lastEvents} state={state} />
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
        <span className="key-hints">space = end quarter · 1–6 = panels · esc = deselect</span>
      </nav>
      <section className="panel">
        {tab === 'routes' && <RoutesPanel state={state} onInspect={inspectRoute} />}
        {tab === 'fleet' && <FleetPanel state={state} />}
        {tab === 'airports' && <AirportsPanel state={state} />}
        {tab === 'rivals' && <RivalsPanel state={state} />}
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
