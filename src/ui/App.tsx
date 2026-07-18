import { useState, useSyncExternalStore } from 'react'
import { SCENARIOS, getScenario } from '../data/scenarios'
import { netWorth, quarterOf, yearOf } from '../engine/queries'
import { MapView } from './MapView'
import { AirportsPanel, FinancePanel, FleetPanel, ReportPanel, RoutesPanel } from './panels'
import { dispatch, getSession, startGame, reset } from './session'
import { subscribe } from './session'

type Tab = 'routes' | 'fleet' | 'airports' | 'finance' | 'report'

function money(k: number): string {
  return k >= 1000 || k <= -1000 ? `$${(k / 1000).toFixed(1)}M` : `$${k}k`
}

function ScenarioSelect() {
  const [seed, setSeed] = useState('')
  return (
    <main className="menu">
      <h1>Load Factor</h1>
      <p className="tagline">Routes. Jets. Margins. Fill the seats.</p>
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

function GameScreen() {
  const session = getSession()!
  const [tab, setTab] = useState<Tab>('routes')
  const state = session.state
  const player = state.airlines[0]!
  const scenario = getScenario(state.scenario)

  return (
    <main className="game">
      <header>
        <h1>Load Factor</h1>
        <span data-testid="date">
          {yearOf(state)} Q{quarterOf(state)}
        </span>
        <span data-testid="cash">Cash {money(player.cash)}</span>
        <span data-testid="networth">
          Net worth {money(netWorth(player))} / {money(scenario.targetNetWorth)}
        </span>
        {state.phase === 'planning' ? (
          <button className="end-quarter" data-testid="end-quarter" onClick={() => dispatch({ type: 'end_quarter' })}>
            End Quarter ▶
          </button>
        ) : (
          <span className={state.phase === 'won' ? 'banner won' : 'banner lost'} data-testid="game-over">
            {state.phase === 'won' ? 'VICTORY' : 'DEFEAT'}
            <button onClick={() => reset()}>new game</button>
          </span>
        )}
      </header>
      <MapView state={state} />
      <nav className="tabs">
        {(['routes', 'fleet', 'airports', 'finance', 'report'] as const).map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} data-testid={`tab-${t}`} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
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
  return session ? <GameScreen /> : <ScenarioSelect />
}
