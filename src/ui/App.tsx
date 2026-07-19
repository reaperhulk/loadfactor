import { useEffect, useState, useSyncExternalStore } from 'react'
import { CITIES } from '../data/cities'
import { getEventDef } from '../data/events'
import { SCENARIOS, getScenario } from '../data/scenarios'
import { netWorth, quarterOf, yearOf } from '../engine/queries'
import { CityPanel } from './CityPanel'
import { CoachMarks } from './CoachMarks'
import { ConfirmButton } from './ConfirmButton'
import { useCountUp } from './countUp'
import { isMuted, setMuted } from './sounds'
import { MapView } from './MapView'
import { AirportsPanel, FinancePanel, FleetPanel, ReportPanel, RoutesPanel } from './panels'
import { ReplayViewer } from './ReplayViewer'
import { ReportCard } from './ReportCard'
import { RivalsPanel } from './RivalsPanel'
import { RouteDossier } from './RouteDossier'
import { RouteSetupDialog } from './RouteSetupDialog'
import { dispatch, getPlayerColor, getReplay, getSession, loadSave, resumeSave, startGame, reset } from './session'
import { subscribe } from './session'
import { EVENT_ICONS, EVENT_NAMES, ToastStack } from './toasts'
import type { GameState, Replay } from '../engine'
import { money } from './format'

type Tab = 'routes' | 'fleet' | 'airports' | 'rivals' | 'finance' | 'report'

// Livery choices: the player's accent color across the whole UI.
const LIVERY_COLORS = ['#4fa3ff', '#4fae62', '#d0636e', '#d8a052', '#9d7bd8', '#3fbfb0'] as const

function ScenarioSelect({ onWatchReplay }: { onWatchReplay: (replay: Replay) => void }) {
  const [seed, setSeed] = useState('')
  const [airlineName, setAirlineName] = useState('')
  const [color, setColor] = useState<string>(LIVERY_COLORS[0])
  const [hq, setHq] = useState('') // '' = the scenario's authored HQ
  const save = loadSave()
  const custom = () => ({
    name: airlineName.trim() !== '' ? airlineName.trim() : undefined,
    hq: hq !== '' ? hq : undefined,
    color: color !== LIVERY_COLORS[0] ? color : undefined,
  })
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
      <div className="airline-setup" data-testid="airline-setup">
        <h2>Your airline</h2>
        <label>
          Name:{' '}
          <input
            value={airlineName}
            placeholder="scenario default"
            maxLength={40}
            onChange={(e) => setAirlineName(e.target.value)}
            data-testid="airline-name"
          />
        </label>{' '}
        <label>
          HQ:{' '}
          <select value={hq} onChange={(e) => setHq(e.target.value)} data-testid="airline-hq">
            <option value="">scenario default</option>
            {[...CITIES]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.id})
                </option>
              ))}
          </select>
        </label>
        <div className="livery-row">
          Livery:{' '}
          {LIVERY_COLORS.map((c) => (
            <button
              key={c}
              className={`livery-swatch${color === c ? ' active' : ''}`}
              style={{ background: c }}
              aria-label={`livery color ${c}`}
              data-testid={`livery-${c.slice(1)}`}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
        <p className="dim">
          A custom HQ starts you with slots there plus footholds at the strongest nearby cities.
        </p>
      </div>
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
        {save ? (
          <ConfirmButton
            data-testid="start-daily"
            label="▶ Fly today’s seed"
            confirmLabel="overwrite your saved game?"
            onConfirm={() => startGame('jet_age', `daily-${new Date().toISOString().slice(0, 10)}`, custom())}
          />
        ) : (
          <button
            data-testid="start-daily"
            onClick={() => startGame('jet_age', `daily-${new Date().toISOString().slice(0, 10)}`, custom())}
          >
            ▶ Fly today’s seed
          </button>
        )}
      </div>
      {SCENARIOS.map((s) => (
        <div key={s.id} className="scenario-card">
          <h2>{s.name}</h2>
          <p>{s.description}</p>
          <p className="dim scenario-facts">
            {s.startYear}–{s.startYear + Math.floor(s.quarters / 4)} · {s.quarters} quarters · target{' '}
            {money(s.targetNetWorth)} · vs{' '}
            {s.rivals.map((r) => `${r.name} (${r.personality ?? 'balanced'})`).join(', ')}
          </p>
          {save ? (
            <ConfirmButton
              data-testid={`start-${s.id}`}
              label="Start"
              confirmLabel="overwrite your saved game?"
              onConfirm={() => startGame(s.id, seed || new Date().toISOString().slice(0, 10), custom())}
            />
          ) : (
            <button
              data-testid={`start-${s.id}`}
              onClick={() => startGame(s.id, seed || new Date().toISOString().slice(0, 10), custom())}
            >
              Start
            </button>
          )}
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
  // The career in numbers — what those decades added up to.
  const me = state.airlines[0]!
  const totalPax = me.history.reduce((s, h) => s + h.pax, 0)
  const totalProfit = me.history.reduce((s, h) => s + h.profit, 0)
  const peakWorth = me.history.reduce((s, h) => Math.max(s, h.netWorth), 0)
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
        <p className="dim" data-testid="career-summary">
          {Math.floor(state.turn / 4)} years · {totalPax.toLocaleString('en-US')} passengers flown · lifetime
          P&L {money(totalProfit)} · peak worth {money(peakWorth)}
        </p>
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
  const [showHelp, setShowHelp] = useState(false)
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
      } else if (e.key === '?') {
        setShowHelp((h) => !h)
      } else if (e.key === 'Escape') {
        setShowHelp(false)
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

  // The chosen livery recolors the player's accent everywhere — arcs, dots,
  // bars, chips — via the CSS custom property the whole UI already uses.
  const livery = getPlayerColor()
  return (
    <main className="game" style={livery ? ({ '--accent': livery } as React.CSSProperties) : undefined}>
      <header>
        <h1>Load Factor</h1>
        <span data-testid="date">
          {yearOf(state)} Q{quarterOf(state)}
        </span>
        <span className="dim" data-testid="race-clock" title="quarters until the race is scored">
          {Math.max(0, scenario.quarters - state.turn)}q left
        </span>
        {(player.insolventQuarters > 0 || player.cash < 0) && state.phase === 'planning' && (
          <span className="neg insolvency-warning" data-testid="insolvency-warning">
            ⚠ INSOLVENT — {player.insolventQuarters > 0 ? 'one more losing quarter folds the airline' : 'end the quarter in the red and the clock starts'}
          </span>
        )}
        <span data-testid="cash">Cash {money(shownCash)}</span>
        <span data-testid="networth">
          Net worth {money(shownWorth)} / {money(scenario.targetNetWorth)}
        </span>
        {(() => {
          // The race, always on screen: current rank among the living, and
          // the gap to whoever must be caught (or is catching up).
          const worths = state.airlines.filter((a) => !a.bankrupt).map((a) => ({ id: a.id, w: netWorth(a) }))
          worths.sort((a, b) => b.w - a.w)
          const rank = worths.findIndex((x) => x.id === 0) + 1
          if (rank === 0) return null
          const me = netWorth(player)
          const gapTo = rank === 1 ? worths[1] : worths[rank - 2]
          return (
            <span data-testid="rank" className={rank === 1 ? 'pos' : 'neg'}>
              #{rank}/{worths.length}
              {gapTo && (
                <span className="dim">
                  {' '}
                  ({rank === 1 ? '+' : '−'}
                  {money(Math.abs(me - gapTo.w))})
                </span>
              )}
            </span>
          )
        })()}
        <MuteToggle />
        {state.phase === 'planning' && (
          <button className="end-quarter" data-testid="end-quarter" onClick={endQuarter}>
            End Quarter ▶
          </button>
        )}
      </header>
      <CoachMarks state={state} />
      {state.world.events.length > 0 && (
        <div className="events-strip" data-testid="events-strip">
          {state.world.events.map((e) => {
            const def = getEventDef(e.id)
            const pct = def.demandModBp !== undefined ? (def.demandModBp - 10000) / 100 : null
            return (
              <span key={`${e.id}-${e.city ?? e.region ?? 'world'}`} className="event-chip">
                {EVENT_ICONS[e.id] ?? '🌍'} {EVENT_NAMES[e.id] ?? def.name}
                {e.city ? ` · ${e.city}` : e.region ? ` · ${e.region.toUpperCase()}` : ''}
                {pct !== null && (
                  <span className={pct >= 0 ? 'pos' : 'neg'}>
                    {' '}
                    {pct >= 0 ? '+' : ''}
                    {pct.toFixed(0)}%
                  </span>
                )}
                <span className="dim"> · {e.quartersLeft}q</span>
              </span>
            )
          })}
        </div>
      )}
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
      {showHelp && (
        <div className="gameover-overlay" data-testid="help-overlay" onClick={() => setShowHelp(false)}>
          <div className="gameover-card report-card" onClick={(e) => e.stopPropagation()}>
            <h2>Shortcuts</h2>
            <table className="report-lines">
              <tbody>
                <tr>
                  <td>Space / E</td>
                  <td>end the quarter (and dismiss the report)</td>
                </tr>
                <tr>
                  <td>1–6</td>
                  <td>switch panels</td>
                </tr>
                <tr>
                  <td>Esc</td>
                  <td>back out of route mode, panels, overlays</td>
                </tr>
                <tr>
                  <td>Drag / wheel</td>
                  <td>pan and zoom the map (spin the globe)</td>
                </tr>
                <tr>
                  <td>⚔ / ◐ / 🌐</td>
                  <td>rival overlay · data lens · globe projection</td>
                </tr>
                <tr>
                  <td>?</td>
                  <td>this card</td>
                </tr>
              </tbody>
            </table>
            <button data-testid="help-close" onClick={() => setShowHelp(false)}>
              Close
            </button>
          </div>
        </div>
      )}
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
          <RouteDossier
            state={state}
            routeId={selectedRoute}
            onClose={() => setSelectedRoute(null)}
            onSelectRoute={setSelectedRoute}
          />
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
        {tab === 'routes' && (
          <RoutesPanel
            state={state}
            onInspect={inspectRoute}
            onPlan={(from, to) => setPendingRoute({ from, to })}
          />
        )}
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
