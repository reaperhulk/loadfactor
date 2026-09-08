import { needsFullReport } from './quarterPacing'
import { useDisplayPreferences } from './display'
import type { FlowFocus } from './PassengerFlows'
import { PlanTray } from './PlanTray'
import type { ExpansionOption } from '../engine/expansion'
import { useInbox } from './inbox'
import { Celebration, useCelebration } from './Celebration'
import { planningForecast } from './forecast'
import { AREA_PAGES, PAGE_LABELS, areaFor, type WorkspaceArea, type WorkspacePage } from './workspace'
import { DisplaySettings } from './DisplaySettings'
import { Dialog } from './Dialog'
import { AudioSettings } from './AudioSettings'
import { ManagementBrief } from './ManagementBrief'
import { rulesOf, identityOf } from '../engine/version'
import { lazy, Suspense, useCallback, useEffect, useReducer, useRef, useState, useSyncExternalStore } from 'react'
import { CITIES } from '../data/cities'
import { AIRCRAFT } from '../data/aircraft'
import { getEventDef } from '../data/events'
import { SCENARIOS, SHORT_SCENARIOS, getScenario } from '../data/scenarios'
import { netWorth, networkCities, objectiveQualified, objectiveScore, quarterOf, yearOf } from '../engine/queries'
import { nextExpansion } from '../engine/slots'
import { CityPanel } from './CityPanel'
import { CoachMarks } from './CoachMarks'
import { ConfirmButton } from './ConfirmButton'
import { useCountUp } from './countUp'
import { isMuted, setMuted } from './sounds'
import { ActiveDeals, OfferCard } from './OfferCard'
import { DeskTimeline } from './DeskTimeline'
import { AircraftDossier } from './AircraftDossier'
import { AirportsPanel, FleetPanel, RoutesPanel } from './panels'
const loadRivalsPanel = () => import('./RivalsPanel').then(m=>({default:m.RivalsPanel}))
const RivalsPanel = lazy(loadRivalsPanel)
import { RouteDossier } from './RouteDossier'
import { RouteSetupDialog } from './RouteSetupDialog'
import { ACHIEVEMENTS, loadAchievements } from './achievements'
import { canEndQuarter, getLastSentLink, listMpGames, mpStatus, passSeat, receiveTurn, resumeMpGame, seatOrder, sendSitting, startLinkGame, viewSeat,
  clearAllData,
  clearSaveAt,
  canUndo,
  exportSave,
  exportCurrentCareer,
  getStorageWarning,
  importSave,
  dispatch,
  getChallengeTarget,
  getPlayerColor,
  getReplay,
  getSession,
  listSaves,
  loadFame,
  nextFreeSlot,
  resumeSave,
  startGame,
  reset,
  undoLastAction,
} from './session'
import { subscribe } from './session'
import {
  CabinLegend,
  HedgeLegend,
  HubLegend,
  MarketingLegend,
  SeasonLegend,
  ReliabilityLegend,
  RivalryLegend,
  ServiceLegend,
  SlotLegend,
  SpoolLegend,
  TakeoverLegend,
} from './legends'
import { EVENT_ICONS, EVENT_NAMES, ToastStack } from './toasts'
import type { GameState, Replay } from '../engine'
import { copyText, money, objectiveValue } from './format'
import { Icon } from './Icon'

type Tab = 'routes' | 'fleet' | 'airports' | 'rivals' | 'finance' | 'report'

const loadQuarterReview = () => import('./QuarterReview').then(({ QuarterReview }) => ({ default: QuarterReview }))
const QuarterReview = lazy(loadQuarterReview)
const loadReportCard = () => import('./ReportCard').then(({ ReportCard }) => ({ default: ReportCard }))
const ReportCard = lazy(loadReportCard)
const loadReportPanel = () => import('./ReportPanel').then(({ ReportPanel }) => ({ default: ReportPanel }))
const ReportPanel = lazy(loadReportPanel)
const loadFinancePanel = () => import('./FinancePanel').then(m=>({default:m.FinancePanel}))
const FinancePanel = lazy(loadFinancePanel)
const FrameDiagnostics = lazy(() => import('./FrameDiagnostics').then(m=>({default:m.FrameDiagnostics})))
const loadOperationsBoard = () => import('./OperationsBoard').then(m=>({default:m.OperationsBoard}))
const OperationsBoard = lazy(loadOperationsBoard)
const loadCapitalOutlook = () => import('./CapitalOutlook').then(m=>({default:m.CapitalOutlook}))
const CapitalOutlook = lazy(loadCapitalOutlook)
const MapView = lazy(() => import('./MapView').then(({ MapView }) => ({ default: MapView })))
const ReplayViewer = lazy(() => import('./ReplayViewer').then(({ ReplayViewer }) => ({ default: ReplayViewer })))

// Livery choices: the player's accent color across the whole UI.
const LIVERY_COLORS = ['#4fa3ff', '#4fae62', '#d0636e', '#d8a052', '#9d7bd8', '#3fbfb0'] as const

function EraMark({ year }: { year: number }) {
  return (
    <div className="era-mark" aria-hidden="true">
      <svg viewBox="0 0 180 44">
        <path className="era-mark-route" d="M7 35C48 4 111 4 173 27" />
        <path className="era-mark-plane" d="m99 13 18 4 10-7 4 1-7 9 14 5-2 4-16-3-5 10-4-1 1-11-14-6Z" />
      </svg>
      <span>{year}s</span>
    </div>
  )
}

function ScenarioSelect({ onWatchReplay }: { onWatchReplay: (replay: Replay) => void }) {
  const [seed, setSeed] = useState('')
  const [players, setPlayers] = useState(1) // hot-seat seats at this device

  const [airlineName, setAirlineName] = useState('')
  const [color, setColor] = useState<string>(LIVERY_COLORS[0])
  const [hq, setHq] = useState('') // '' = the scenario's authored HQ
  const [, bumpSaves] = useReducer((n: number) => n + 1, 0)
  const [importText, setImportText] = useState('')
  const saves = listSaves()
  const savedRows = saves.map((s, slot) => ({ save: s, slot })).filter((r) => r.save !== null)
  const { overwrites } = nextFreeSlot()
  const custom = () => ({
    name: airlineName.trim() !== '' ? airlineName.trim() : undefined,
    hq: hq !== '' ? hq : undefined,
    color: color !== LIVERY_COLORS[0] ? color : undefined,
  })
  // A challenge link carries (scenario, seed) in the URL — determinism makes
  // the same seed the same world for everyone who opens it. `target`/`by`
  // upgrade it to a duel: the challenger's net worth is the number to beat.
  const challenge = (() => {
    const params = new URLSearchParams(window.location.search)
    const scenario = params.get('scenario')
    const chSeed = params.get('seed')
    if (!scenario || !chSeed) return null
    const rawTarget = Number.parseInt(params.get('target') ?? '', 10)
    const by = params.get('by')?.trim() || undefined
    const rulesVersion = Number(params.get('rules') ?? 1)
    try {
      return {
        scenario: getScenario(scenario),
        seed: chSeed,
        rulesVersion: rulesOf({ rulesVersion }),
        duel: Number.isFinite(rawTarget) && (rawTarget > 0 || params.has('metric')) ? { worth: rawTarget, by, ...(params.get('metric') === getScenario(scenario).objective.kind ? { kind: getScenario(scenario).objective.kind } : {}) } : null,
      }
    } catch {
      return null
    }
  })()
  return (
    <main className="menu">
      <SaveWarning />
      <h1>Load Factor</h1>
      <p className="tagline">
        Routes. Jets. Margins. Fill the seats. <BuildStamp />
      </p>
      {listMpGames().length > 0 && (
        <div className="scenario-card continue-card" data-testid="mp-games">
          <h2>Link duels</h2>
          {listMpGames().map((g) => (
            <p key={g.gameId}>
              seed “{g.seed}” · seat {g.mySeat + 1} · {g.awaiting ? 'waiting for their turn' : 'your move'}{' '}
              <button data-testid={`mp-resume-${g.gameId}`} onClick={() => resumeMpGame(g.gameId)}>
                Open
              </button>
            </p>
          ))}
        </div>
      )}
      {challenge && (
        <div className="scenario-card continue-card" data-testid="challenge-card">
          <h2>⚔ Challenge accepted?</h2>
          <p className="dim">
            {challenge.scenario.name} · seed “{challenge.seed}” — same seed, same world.{' '}
            {challenge.duel ? (
              <span data-testid="duel-target">
                Beat {challenge.duel.by ? <strong>{challenge.duel.by}</strong> : 'their'}{' '}
                <strong className="pos">{objectiveValue(challenge.duel.worth, challenge.duel.kind ? challenge.scenario.objective.unit : 'money')}</strong> before the deadline.
              </span>
            ) : (
              'Build the strongest airline on this seed.'
            )}
          </p>
          <button
            data-testid="start-challenge"
            onClick={() => {
              window.history.replaceState(null, '', window.location.pathname)
              startGame(challenge.scenario.id, challenge.seed, custom(), challenge.duel ?? undefined, 1, challenge.rulesVersion)
            }}
          >
            ▶ Fly the challenge
          </button>
        </div>
      )}
      {savedRows.length > 0 && (
        <div className="scenario-card continue-card">
          <h2>Saved games</h2>
          {savedRows.map(({ save, slot }, i) => (
            <p key={slot} className="save-row" data-testid={`save-slot-${slot}`}>
              <span>
                {save!.finished && (
                  <span title="this career is finished — a replayable record">🏁 </span>
                )}
                {save!.player?.name ?? 'Your airline'}{' '}
                <span className="dim">
                  — {(() => {
                    try {
                      return getScenario(save!.scenario).name
                    } catch {
                      return save!.scenario
                    }
                  })()}{' '}
                  · seed “{save!.seed}” ·{' '}
                  {(save!.version === 1 ? save!.commands : save!.entries.map((e) => e.command)).filter(
                    (c) => c.type === 'end_quarter',
                  ).length}{' '}
                  quarters{save!.version === 2 ? ' · hot-seat' : ''}
                </span>
              </span>{' '}
              <button data-testid={i === 0 ? 'continue-save' : `continue-save-${slot}`} onClick={() => resumeSave(slot)}>
                Continue
              </button>{' '}
              {(
                <button
                  data-testid={i === 0 ? 'watch-save-replay' : `watch-save-replay-${slot}`}
                  onClick={() => { try { rulesOf(save!); onWatchReplay(save!.version === 1 ? save! : { ...save!, commands: [] }) } catch (error) { alert(String(error)) } }}
                >
                  Watch replay
                </button>
              )}{' '}
              <button
                data-testid={`export-save-${slot}`}
                title="copy this career as JSON — paste it into Import on any browser"
                onClick={() => {
                  const json = exportSave(slot)
                  if (json) copyText(json, 'Career JSON')
                }}
              >
                export
              </button>{' '}
              <ConfirmButton
                data-testid={`delete-save-${slot}`}
                label="delete"
                confirmLabel="really delete?"
                onConfirm={() => {
                  clearSaveAt(slot)
                  bumpSaves()
                }}
              />
            </p>
          ))}
          <details>
            <summary className="dim">Import a career</summary>
            <textarea
              data-testid="import-save-text"
              placeholder="paste exported save JSON here"
              rows={3}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
            />{' '}
            <button
              data-testid="import-save"
              disabled={importText.trim() === ''}
              onClick={() => {
                const { slot, overwrites: taken } = nextFreeSlot()
                if (taken !== null) {
                  setImportText('— all slots full — delete one first —')
                  return
                }
                if (importSave(importText.trim(), slot)) {
                  setImportText('')
                  bumpSaves()
                } else {
                  setImportText('— that JSON did not replay cleanly —')
                }
              }}
            >
              import into a slot
            </button>
          </details>
        </div>
      )}
      <section className="first-career" aria-labelledby="first-career-heading">
        <div><span className="eyebrow">New here? Start with The Jet Age</span>
          <h2 id="first-career-heading">Build your first airline</h2>
          <p>Choose a route, fill its seats, and keep the airline profitable. Plan at your own pace; time moves only when you fly a quarter.</p>
          <p className="dim">Your Desk compares two first routes and guides your opening three quarters. Airline details below are optional.</p>
        </div>
        {overwrites !== null ? <ConfirmButton data-testid="start-first-career" label="Start flying" confirmLabel="All slots full — replace oldest save?" onConfirm={() => startGame('jet_age', seed || new Date().toISOString().slice(0, 10), custom(), undefined, players)} />
          : <button className="primary-action" data-testid="start-first-career" onClick={() => startGame('jet_age', seed || new Date().toISOString().slice(0, 10), custom(), undefined, players)}>Start flying <span aria-hidden="true">→</span></button>}
      </section>
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
              aria-pressed={color === c}
              data-testid={`livery-${c.slice(1)}`}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
        <p className="dim">
          A custom HQ starts you with slots there plus footholds at the strongest nearby cities.
        </p>
      </div>
      <div className="seed-field">
        <label>
        Seed (optional):{' '}
        <input
          value={seed}
          placeholder="random each day"
          onChange={(e) => setSeed(e.target.value)}
          data-testid="seed-input"
        />{' '}
        </label>
        <label className="dim">
          players{' '}
          <select
            data-testid="players-select"
            value={players}
            onChange={(e) => setPlayers(Number(e.target.value))}
            title="more than one: hot-seat — each quarter, every player plans in turn at this device"
          >
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="scenario-card continue-card">
        <h2>Daily challenge</h2>
        <p className="dim">Everyone flies the same seed today. Compare final net worth with your friends.</p>
        {overwrites !== null ? (
          <ConfirmButton
            data-testid="start-daily"
            label="▶ Fly today’s seed"
            confirmLabel="all slots full — overwrite your oldest save?"
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
      {(() => {
        const fame = loadFame()
        if (fame.length === 0) return null
        return (
          <div className="scenario-card" data-testid="hall-of-fame">
            <h2>Past careers</h2>
            <ul className="fame-list">
              {fame.slice(0, 5).map((f, i) => (
                <li key={i}>
                  {f.won ? '🏆' : '🕯'} {f.name} — {objectiveValue(f.score ?? f.netWorth, f.score === undefined ? 'money' : getScenario(f.scenario).objective.unit)} ·{' '}
                  {(() => {
                    try {
                      return getScenario(f.scenario).name
                    } catch {
                      return f.scenario
                    }
                  })()}{' '}
                  · “{f.seed}” · {f.years}y
                </li>
              ))}
            </ul>
          </div>
        )
      })()}
      {(() => {
        const unlocked = loadAchievements()
        const anyUnlocked = ACHIEVEMENTS.some((a) => unlocked[a.id])
        if (!anyUnlocked) return null
        return (
          <div className="scenario-card" data-testid="achievements">
            <h2>Achievements</h2>
            <p className="achievement-row">
              {ACHIEVEMENTS.map((a) => (
                <span
                  key={a.id}
                  className={`event-chip${unlocked[a.id] ? '' : ' achievement-locked'}`}
                  title={unlocked[a.id] ? `${a.name} — ${a.desc}` : `locked — ${a.desc}`}
                >
                  {a.icon} {unlocked[a.id] ? a.name : '???'}
                </span>
              ))}
            </p>
          </div>
        )
      })()}
      {(savedRows.length > 0 || loadFame().length > 0) && (
        <p className="dim menu-housekeeping">
          <ConfirmButton
            data-testid="clear-all-data"
            label="clear all data"
            confirmLabel="delete every save and the hall of fame?"
            onConfirm={() => {
              clearAllData()
              bumpSaves()
            }}
          />
        </p>
      )}
      <section className="short-scenarios"><h2>Short-haul sessions</h2><p className="dim">Focused challenges in 16–24 quarters. Every mandate uses the full simulation.</p>
        {SHORT_SCENARIOS.map((s) => <article className="scenario-card" key={s.id} data-testid={`scenario-${s.id}`}>
          <h3>{s.name}</h3><p>{s.description}</p><p>{s.objective.blurb}</p>
          <ConfirmButton label={`Start · ${s.quarters} quarters`} confirmLabel={overwrites ? 'Replace oldest save and start?' : 'Take the mandate?'} onConfirm={() => startGame(s.id, seed.trim() || crypto.randomUUID().slice(0, 8), custom(), undefined, players)} />
        </article>)}
      </section>
      {SCENARIOS.map((s, si) => {
        // The unlock chain: each era opens when the previous one is WON —
        // but it's an invitation, not a wall (start anyway, twice).
        const wonIds = new Set(loadFame().filter((f) => f.won).map((f) => f.scenario))
        const won = wonIds.has(s.id)
        const prev = si > 0 ? SCENARIOS[si - 1]! : null
        const locked = prev !== null && !wonIds.has(prev.id)
        return (
        <div
          key={s.id}
          className={`scenario-card scenario-era scenario-era-${s.startYear}`}
          data-testid={`scenario-${s.id}`}
        >
          <EraMark year={s.startYear} />
          <h2>
            {s.name}
            {won && <span className="pos" title="you have won this era"> ✓</span>}
            {locked && (
              <span className="dim" data-testid={`locked-${s.id}`} title={`unlocks when you win ${prev!.name}`}>
                {' '}
                🔒
              </span>
            )}
          </h2>
          <p>{s.description}</p>
          <p className="dim scenario-facts">
            {s.startYear}–{s.startYear + Math.floor(s.quarters / 4)} · {s.quarters} quarters · target{' '}
            {objectiveValue(s.objective.target, s.objective.unit)} {s.objective.label} · vs{' '}
            {s.rivals.map((r) => `${r.name} (${r.personality ?? 'balanced'})`).join(', ')}
          </p>
          <p className="scenario-chips">
            <span className="event-chip scenario-rule">{s.rules.blurb}</span>
            <span className="event-chip">✈ {s.player.name} — {s.player.hq}</span>
            <span className="event-chip">⚔ {s.rivals.length} rival{s.rivals.length > 1 ? 's' : ''}</span>
            {(s.eventWeightMult?.['oil_shock'] ?? 1) > 1 && <span className="event-chip">🛢️ volatile fuel</span>}
            {(s.eventWeightMult?.['boom'] ?? 1) > 1 && <span className="event-chip">📈 boom era</span>}
            {(s.eventWeightMult?.['conflict'] ?? 1) > 1 && <span className="event-chip">⚠️ unstable regions</span>}
          </p>
          {overwrites !== null || locked ? (
            <ConfirmButton
              data-testid={`start-${s.id}`}
              label={locked ? '🔒 Start' : 'Start'}
              confirmLabel={
                locked
                  ? `${prev!.name} not yet won — start anyway?`
                  : 'all slots full — overwrite your oldest save?'
              }
              onConfirm={() =>
                startGame(s.id, seed || new Date().toISOString().slice(0, 10), custom(), undefined, players)
              }
            />
          ) : (
            <>
              <button
                data-testid={`start-${s.id}`}
                onClick={() =>
                  startGame(s.id, seed || new Date().toISOString().slice(0, 10), custom(), undefined, players)
                }
              >
                <Icon name="play" /> Start
              </button>{' '}
              <button
                data-testid={`duel-${s.id}`}
                title="start a two-player game by link: you open the first quarter, then send the turn link to your opponent — no server, the link is the game"
                onClick={() => startLinkGame(s.id, seed || new Date().toISOString().slice(0, 10))}
              >
                <Icon name="duel" /> duel
              </button>
            </>
          )}
        </div>
        )
      })}
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
      <Icon name={muted ? 'mute' : 'volume'} />
    </button>
  )
}

// Final standings, ranked — the scenario is a race, show the podium.
function GameOverOverlay({
  state,
  earned,
  onWatchReplay,
}: {
  state: GameState
  earned: string[] // achievement ids unlocked during this career
  onWatchReplay: (r: Replay) => void
}) {
  // The final table ranks on the ERA's objective — the thing that actually
  // decided the career — with net worth alongside for context.
  const obj = getScenario(state.scenario).objective
  const score = (a: (typeof state.airlines)[number]): number => objectiveScore(a, obj.kind)
  const qualifies = (a: (typeof state.airlines)[number]): boolean => !a.bankrupt && objectiveQualified(state, a)
  const ranked = [...state.airlines].sort((a, b) =>
    Number(qualifies(b)) - Number(qualifies(a)) || (obj.higherIsBetter ? score(b) - score(a) : score(a) - score(b)),
  )
  // The career in numbers — what those decades added up to.
  const me = state.airlines[viewSeat()]!
  const totalPax = me.history.reduce((s, h) => s + h.pax, 0)
  const totalProfit = me.history.reduce((s, h) => s + h.profit, 0)
  const peakWorth = me.history.reduce((s, h) => Math.max(s, h.netWorth), 0)
  const won = state.winnerSeat === undefined ? state.phase === 'won' : state.winnerSeat === viewSeat()
  return (
    <Dialog label="Career results" className="gameover-overlay" testId="gameover-overlay" onClose={() => {}}>
      {won && (
        <div className="confetti" aria-hidden="true" data-testid="confetti">
          {/* Deterministic scatter — index drives position, drift, and delay. */}
          {Array.from({ length: 28 }, (_, i) => (
            <span
              key={i}
              style={{
                left: `${(i * 37) % 100}%`,
                background: ['#ffd166', '#4fae62', '#4fa3ff', '#d0636e', '#9d7bd8'][i % 5],
                animationDelay: `${(i % 7) * 0.35}s`,
                animationDuration: `${2.6 + (i % 5) * 0.5}s`,
              }}
            />
          ))}
        </div>
      )}
      <div className="gameover-card">
        <h2 className={won ? 'pos' : 'neg'}>
          {won ? '🏆 VICTORY' : 'DEFEAT'}
        </h2>
        {(() => {
          // The duel verdict: a career started from a challenge link is
          // scored against the challenger's number, win or lose the race.
          const duel = getChallengeTarget()
          if (!duel) return null
          const mine = objectiveScore(me, duel.kind ?? 'netWorth')
          const duelValue = (n: number) => objectiveValue(n, duel.kind ? obj.unit : 'money')
          const beat = mine > duel.worth
          return (
            <p className={beat ? 'pos' : 'neg'} data-testid="duel-verdict">
              {beat
                ? `⚔ Duel won — you beat ${duel.by ?? 'the challenger'}'s ${duelValue(duel.worth)} with ${duelValue(mine)}`
                : `⚔ Duel lost — ${duel.by ?? 'the challenger'}'s ${duelValue(duel.worth)} stood against your ${duelValue(mine)}`}
            </p>
          )
        })()}
        {won &&
          (() => {
            const idx = SCENARIOS.findIndex((s) => s.id === state.scenario)
            const next = idx >= 0 ? SCENARIOS[idx + 1] : undefined
            if (!next) return null
            return (
              <p className="pos" data-testid="era-unlocked">
                🔓 {next.name} unlocked — the next era awaits
              </p>
            )
          })()}
        <p className="dim" data-testid="objective-name">
          Scored on {obj.label} — target {objectiveValue(obj.target, obj.unit)}
        </p>
        <p className="dim">{obj.blurb}{rulesOf(state) >= 2 && obj.kind === 'loadFactor' ? ' Qualification requires 1.5M total boardings and three active routes.' : ''}</p>
        <ol data-testid="final-standings">
          {ranked.map((a) => (
            <li key={a.id} className={a.id === viewSeat() ? 'me' : ''}>
              {a.name} —{' '}
              {a.bankrupt ? (
                'bankrupt'
              ) : (
                <>
                  <strong>{objectiveValue(score(a), obj.unit)}</strong>
                  {!qualifies(a) && <span className="neg"> · qualification not met</span>}
                  {obj.kind !== 'netWorth' && <span className="dim"> · {money(netWorth(a))} net worth</span>}
                </>
              )}
            </li>
          ))}
        </ol>
        <p className="dim" data-testid="career-summary">
          {Math.floor(state.turn / 4)} years · {totalPax.toLocaleString('en-US')} passengers flown · lifetime
          P&L {money(totalProfit)} · peak worth {money(peakWorth)}
        </p>
        {earned.length > 0 && (
          <p className="achievement-row" data-testid="career-achievements">
            {ACHIEVEMENTS.filter((a) => earned.includes(a.id)).map((a) => (
              <span key={a.id} className="event-chip" title={a.desc}>
                {a.icon} {a.name}
              </span>
            ))}
          </p>
        )}
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
    </Dialog>
  )
}

// The objective as a bar, not just two numbers: how far along the era's own
// scoring you are, read in one glance from the HUD.
function ObjectiveBar({ value, target }: { value: number; target: number }) {
  const pct = target > 0 ? Math.max(0, Math.min(100, Math.round((value * 100) / target))) : 0
  return (
    <span className="objective-bar" data-testid="objective-bar" aria-hidden="true">
      <span className={`objective-fill${pct >= 100 ? ' met' : ''}`} style={{ width: `${pct}%` }} />
    </span>
  )
}

// Keep animation state in the two text leaves. Updating a balance must not
// reconcile the map and every retained workspace page on each animation frame.
function AnimatedMoney({ value }: { value: number }) {
  return money(useCountUp(value))
}

function GameScreen({ onWatchReplay }: { onWatchReplay: (r: Replay) => void }) {
  useEffect(() => {
    // Keep first paint light, then warm the quarter flow for offline play.
    const warm = () => { void Promise.allSettled([loadQuarterReview(), loadReportCard(), loadReportPanel(), loadRivalsPanel(), loadFinancePanel(), loadOperationsBoard(), loadCapitalOutlook(), import('./PassengerFlows')]) }
    const timer = window.setTimeout(warm, 500)
    window.addEventListener('online', warm)
    return () => { clearTimeout(timer); window.removeEventListener('online', warm) }
  }, [])
  const session = getSession()!
  const state = session.state, seat = viewSeat(), player = state.airlines[seat]!
  const celebration = useCelebration(session.lastEvents, seat, state.phase === 'planning')
  const scenario = getScenario(state.scenario)
  const [tab, setTabState] = useState<WorkspacePage>('map')
  const [visited, setVisited] = useState<ReadonlySet<WorkspacePage>>(new Set(['map']))
  const lastPage = useRef<Record<WorkspaceArea, WorkspacePage>>({ desk: 'desk', network: 'map', fleet: 'fleet', company: 'finance' })
  const setTab = useCallback((page: WorkspacePage) => {
    lastPage.current[areaFor(page)] = page
    setVisited((old) => old.has(page) ? old : new Set([...old, page]))
    setTabState(page)
  }, [])
  const area = areaFor(tab)
  const [flowFocus, setFlowFocus] = useState<FlowFocus | null>(null)
  const [selectedCity, setSelectedCity] = useState<string | null>(null)
  const [selectedRoute, setSelectedRoute] = useState<number | null>(null)
  const [selectedAircraft, setSelectedAircraft] = useState<number | null>(null)
  const inspectedAircraft = player.fleet.find((a) => a.id === selectedAircraft)
  const inspectedRoute = player.routes.find((r) => r.id === selectedRoute)
  const [routeFrom, setRouteFrom] = useState<string | null>(null)
  const [pendingRoute, setPendingRoute] = useState<{ from: string; to: string; preset?: Pick<ExpansionOption, 'aircraftId' | 'frequency'> } | null>(null)
  const display = useDisplayPreferences()
  const [quietTurn,setQuietTurn]=useState<number | null>(null)
  const [showReport, setShowReport] = useState(false)
  const [showReview, setShowReview] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const forecast = planningForecast(state, seat)
  const attentionCount = useInbox(state, seat, forecast.cashAfter, tab === 'desk')
  const highlightFlow = (focus: FlowFocus) => { setFlowFocus(focus); setSelectedCity(null); setSelectedRoute(null); setTab('map') }
  const handleCityClick = (cityId: string): void => {
    setFlowFocus(null)
    setSelectedRoute(null)
    if (routeFrom !== null && routeFrom !== cityId) {
      setPendingRoute({ from: routeFrom, to: cityId }); setRouteFrom(null)
    } else if (routeFrom === cityId) setRouteFrom(null)
    else setSelectedCity(selectedCity === cityId ? null : cityId)
  }
  const inspectRoute = (routeId: number): void => {
    setFlowFocus(null)
    setSelectedCity(null); setRouteFrom(null); setSelectedRoute(routeId)
    if (tab !== 'map') setTab('routes')
  }
  const closeRoute = (): void => {
    const r = player.routes.find((r) => r.id === selectedRoute)
    setSelectedRoute(null)
    if (r) requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-testid="inspect-${r.from}-${r.to}"]`)?.focus({ preventScroll: true }))
  }
  const clearSelection = (): void => {
    setFlowFocus(null)
    setSelectedRoute(null); setSelectedAircraft(null); setSelectedCity(null); setRouteFrom(null)
  }
  const endQuarter = (): void => {
    if (getSession()?.state.phase !== 'planning' || !canEndQuarter()) return
    if (getSession()?.mode === 'hotseat') clearSelection()
    setShowReview(false); dispatch({ type: 'end_quarter' })
    const next=getSession()
    const full=!display.quietReports || !next || needsFullReport(next.state,next.reportEvents,seat)
    setShowReport(full); setQuietTurn(full ? null : next!.state.turn); if(!full) setTab('desk')
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null
      if (target?.closest('[role=dialog]')) return
      if (e.key === 'Escape') {
        setSelectedRoute(null); setSelectedAircraft(null); setPendingRoute(null)
        setRouteFrom((armed) => { if (armed === null) setSelectedCity(null); return null })
        return
      }
      if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return
      if (target?.tagName === 'BUTTON' && [' ', 'e', 'E'].includes(e.key)) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        if (undoLastAction()) e.preventDefault()
      } else if ([' ', 'e', 'E'].includes(e.key)) {
        e.preventDefault()
        if (getSession()?.state.phase === 'planning' && canEndQuarter()) setShowReview(true)
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const s = getSession()?.state
        if (!s) return
        const cities = [...networkCities(s.airlines[viewSeat()]!)].sort()
        if (!cities.length) return
        e.preventDefault(); setTab('map'); setSelectedRoute(null)
        const step = e.key === 'ArrowRight' ? 1 : -1
        setSelectedCity((cur) => { const idx = cur !== null ? cities.indexOf(cur) : step > 0 ? -1 : 0; return cities[(idx + step + cities.length) % cities.length]! })
      } else if (e.key >= '1' && e.key <= String(TABS.length)) setTab(TABS[Number(e.key) - 1]!)
      else if (e.key === '?') setShowHelp((h) => !h)

    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setTab])
  const livery = getPlayerColor()
  return <main className={`game game-shell era-${Math.min(2000, Math.max(1960, Math.floor(yearOf(state) / 10) * 10))}`} style={livery ? ({ '--livery': livery } as React.CSSProperties) : undefined}>
    <SaveWarning />
    <header className="app-header" data-testid="app-header">
      <div className="airline-brand"><Icon name="aircraft" /><div><h1 title={player.name}>{player.name}</h1><small>Load Factor</small></div></div>
      <span className="app-date"><span data-testid="date">{yearOf(state)} Q{quarterOf(state)}</span><small data-testid="race-clock">{Math.max(0, scenario.quarters - state.turn)}q left</small></span>
      <button className="inbox-button" data-testid="open-inbox" title="New items since your last Desk visit. Opening the Desk marks them as seen." onClick={() => setTab('desk')}><Icon name="inbox" /><span>Inbox</span>{attentionCount > 0 && <b aria-label={`${attentionCount} unseen items`}>{attentionCount}</b>}</button>
      <button className="settings-button" data-testid="open-settings" aria-label="Open settings" onClick={() => setShowSettings(true)}><Icon name="settings" /></button>
    </header>
    <div className="turn-actions" data-testid="turn-actions"><span className="mobile-profit"><small>Planned net profit</small><strong className={forecast.profit >= 0 ? 'pos' : 'neg'}>{money(forecast.profit)}</strong></span>
        {state.phase === 'planning' &&
          (() => {
            const sess = getSession()!
            if (sess.mode === 'hotseat') {
              const order = seatOrder()
              const at = order.indexOf(sess.activeSeat)
              const next = order[at + 1]
              return (
                <span className="hotseat-controls">
                  <span className="seat-chip" data-testid="active-seat">
                    🎮 {state.airlines[sess.activeSeat]!.name}
                  </span>
                  {next !== undefined ? (
                    <button
                      className="end-quarter"
                      data-testid="pass-seat"
                      onClick={() => { clearSelection(); passSeat() }}
                    >
                      Done — pass to {state.airlines[next]!.name} ▶
                    </button>
                  ) : (
                    <button className="end-quarter" data-testid="end-quarter" onClick={() => setShowReview(true)}>
                      Review quarter →
                    </button>
                  )}
                </span>
              )
            }
            if (sess.mode === 'link') {
              const st = mpStatus()
              if (!st) return null
              if (!st.yourSitting) {
                return (
                  <span className="hotseat-controls" data-testid="mp-waiting">
                    ✉ waiting for opponent
                    {getLastSentLink() !== null && (
                      <button onClick={() => copyText(getLastSentLink()!, 'Turn link')}>
                        copy link again
                      </button>
                    )}
                  </span>
                )
              }
              return (
                <span className="hotseat-controls">
                  {canEndQuarter() && (
                    <button className="end-quarter" data-testid="end-quarter" onClick={() => setShowReview(true)}>
                      Review quarter →
                    </button>
                  )}
                  <button
                    className="end-quarter"
                    data-testid="mp-send"
                    title="package everything since their last look into a link — send it to them over any channel"
                    onClick={() => {
                      void sendSitting().then((url) => {
                        if (url) copyText(url, 'Turn link')
                      })
                    }}
                  >
                    ✉ Send turn
                  </button>
                </span>
              )
            }
            return (
              <button className="end-quarter" data-testid="end-quarter" onClick={() => setShowReview(true)}>
                Review quarter →
              </button>
            )
          })()}

    </div>
    <section className="status-bar" aria-label="Airline status" data-testid="status-bar">
      <span className="hud-stat hud-figure" data-label="Cash now" data-testid="cash"><AnimatedMoney value={player.cash} /></span>
      <span className={`hud-stat hud-figure planned-profit ${forecast.profit >= 0 ? 'pos' : 'neg'}`} data-label="Planned net profit / q" data-testid="planned-profit">{money(forecast.profit)}</span>
      <button className="hud-stat hud-figure planned-cash" data-label="Planned ending cash" onClick={() => setShowReview(true)}>{money(forecast.cashAfter)}</button>
        <span className="hud-stat hud-figure hud-objective" data-label="Objective" data-testid="networth">
          {scenario.objective.kind === 'netWorth' ? (
            <>
              <AnimatedMoney value={netWorth(player)} /> <span className="hud-target">/ {money(scenario.objective.target)}</span>
              <ObjectiveBar value={netWorth(player)} target={scenario.objective.target} />
            </>
          ) : (
            <>
              <span data-testid="objective-progress">
                {objectiveValue(objectiveScore(player, scenario.objective.kind), scenario.objective.unit)}{' '}
                <span className="hud-target">
                  / {objectiveValue(scenario.objective.target, scenario.objective.unit)}{' '}
                  {scenario.objective.label}
                </span>
              </span>
              <ObjectiveBar
                value={objectiveScore(player, scenario.objective.kind)}
                target={scenario.objective.target}
              />
            </>
          )}
        </span>
        {(() => {
          // The race, always on screen: current rank among the living, and
          // the gap to whoever must be caught (or is catching up).
          const worths = state.airlines.filter((a) => !a.bankrupt).map((a) => ({ id: a.id, w: objectiveScore(a, scenario.objective.kind) }))
          worths.sort((a, b) => b.w - a.w)
          const rank = worths.findIndex((x) => x.id === viewSeat()) + 1
          if (rank === 0) return null
          const me = objectiveScore(player, scenario.objective.kind)
          const gapTo = rank === 1 ? worths[1] : worths[rank - 2]
          return (
            <span
              data-testid="rank"
              className={`hud-stat hud-figure ${rank === 1 ? 'pos' : 'neg'}`}
              data-label="Position"
            >
              #{rank}/{worths.length}
              {gapTo && (
                <span className="dim">
                  {' '}
                  ({rank === 1 ? '+' : '−'}
                  {objectiveValue(Math.abs(me - gapTo.w), scenario.objective.unit)})
                </span>
              )}
            </span>
          )
        })()}

    </section>
    <nav className="primary-nav" aria-label="Game areas" data-testid="primary-nav">
      {(['desk', 'network', 'fleet', 'company'] as const).map((item) => <button key={item} data-testid={`nav-${item}`} aria-current={area === item ? 'page' : undefined} className={area === item ? 'active' : ''} onClick={() => setTab(lastPage.current[item])}><Icon name={item === 'fleet' ? 'aircraft' : item} /><span>{item === 'desk' ? 'Desk' : item === 'network' ? 'Network' : item === 'fleet' ? 'Fleet' : 'Company'}</span></button>)}
      <div className="nav-footer"><button className="link-btn" onClick={() => setShowHelp(true)}>Handbook <span aria-hidden="true">?</span></button><small>{scenario.name}</small><BuildStamp /></div>
    </nav>
    <section className="workspace" data-testid="workspace">
      <nav className="workspace-tabs tabs" aria-label={`${area} views`} data-testid="workspace-tabs">
        {AREA_PAGES[area].map((page) => <button key={page} data-testid={`tab-${page}`} aria-current={tab === page ? 'page' : undefined} className={tab === page ? 'active' : ''} onClick={() => setTab(page)}>{PAGE_LABELS[page]}</button>)}
        <button className="undo-action" data-testid="undo-action" disabled={!canUndo()} aria-label="Undo last planning action" onClick={() => undoLastAction()}><Icon name="undo" /><span>Undo</span></button>
      </nav>
      <div className="workspace-pages">
        <section className="workspace-page desk-page" hidden={tab !== 'desk'} data-testid="page-desk">
          <div className="page-heading"><div><span className="eyebrow">{yearOf(state)} Q{quarterOf(state)}</span><h2>Operations desk</h2></div><span className="dim">{scenario.name}</span></div>
        {(() => {
          // The duel, always on screen: a challenge career shows the number
          // to beat in the HUD, not just on a chart two tabs away.
          const duel = getChallengeTarget()
          if (!duel) return null
          const mine = objectiveScore(player, duel.kind ?? 'netWorth')
          const duelValue = (n: number) => objectiveValue(n, duel.kind ? scenario.objective.unit : 'money')
          const ahead = mine > duel.worth
          return (
            <span
              className={ahead ? 'pos' : 'neg'}
              data-testid="duel-chip"
              title={`challenge target: beat ${duel.by ?? 'the challenger'}'s ${duelValue(duel.worth)}`}
            >
              ⚔ {ahead ? 'ahead of' : 'behind'} {duel.by ?? 'challenger'} by {duelValue(Math.abs(mine - duel.worth))}
            </span>
          )
        })()}
        {(player.insolventQuarters > 0 || player.cash < 0) && state.phase === 'planning' && (
          <span className="neg insolvency-warning" data-testid="insolvency-warning">
            ⚠ INSOLVENT — {player.insolventQuarters > 0 ? 'one more losing quarter folds the airline' : 'end the quarter in the red and the clock starts'}
          </span>
        )}
      {quietTurn===state.turn && <div className="quiet-result" role="status" data-testid="quiet-result"><strong>Quarter complete</strong><span>{money(player.history.at(-1)?.profit ?? 0)} profit · {money(player.cash)} cash</span><button onClick={()=>setShowReport(true)}>Read full report</button></div>}
      <div className="desk-columns"><div className="desk-priorities">
      {state.phase === 'planning' && <ManagementBrief state={state} onTab={setTab} onAircraft={(id) => { setSelectedAircraft(id); setTab('fleet') }} onInspect={(id) => { setSelectedRoute(id); setTab('routes') }} onPlan={(from, to, preset) => setPendingRoute({ from, to, preset })} />}
      <OfferCard state={state} />
      </div><aside className="desk-agenda"><h2>Coming up</h2><DeskTimeline state={state} onTab={setTab} /><ActiveDeals state={state} />
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
      {(state.rulesVersion ?? 1) >= 2 && <details className="world-outlook" data-testid="world-outlook">
        <summary>Planning calendar · next board opportunity in {state.turn % 8 === 0 ? 0 : 8 - state.turn % 8}q</summary>
        <p>Board opportunities arrive every eight quarters with four quarters to decide. Accepted commitments can run for several years.</p>
        <p>{scenario.objective.blurb} {scenario.objective.kind === 'loadFactor' ? 'Qualification also requires 1.5M total passengers and three active routes.' : ''}</p>
        <p>Scheduled deliveries: {player.orders.length === 0 ? 'none' : player.orders.map((o) => `${o.type} in ${o.quartersLeft}q${o.replacesAircraftId ? ' (replacement)' : ''}`).join(' · ')}</p>
        <p>Aircraft entering the market within two years: {AIRCRAFT.filter((t) => t.availableFrom > yearOf(state) && t.availableFrom <= yearOf(state) + 2).map((t) => `${t.name} (${t.availableFrom})`).join(' · ') || 'none announced'}.</p>
        <p>Airport programmes on your network: {[...new Set([...Object.keys(player.slots), ...player.slotRequests.map((r) => r.city)])].map((city) => ({ city, ...nextExpansion(state, city) })).filter((e) => e.quartersAway <= 8).sort((a,b) => a.quartersAway-b.quartersAway).map((e) => `${e.city}: +${e.slots} slots in ${e.quartersAway}q`).join(' · ') || 'none opening in the next eight quarters'}.</p>
        {state.airlines.filter((a) => a.campaign).map((a) => <p key={a.id}>{a.name}: {a.campaign!.kind} campaign at {a.campaign!.city}, through quarter {a.campaign!.untilTurn}.</p>)}
      </details>}
      </aside></div>
      <CoachMarks state={state} />

        </section>
        <section className="workspace-page map-page" hidden={tab !== 'map'} data-testid="page-map">
      <div className={`map-area split-view${selectedCity !== null || inspectedRoute !== undefined ? " has-inspector" : ""}`}>
      {display.diagnostics && tab==='map' && <Suspense fallback={null}><FrameDiagnostics /></Suspense>}
        <Suspense
          fallback={
            <div className="map-wrap map-loading" data-testid="map-loading" aria-busy="true">
              <span>Loading route map…</span>
            </div>
          }
        >
          <MapView
            flowRouteIds={flowFocus?.routes}
          selectedRouteId={inspectedRoute?.id}
            state={state}
            active={tab === "map"}
            selected={selectedCity}
            routeFrom={routeFrom}
            onCityClick={handleCityClick}
            onRouteClick={inspectRoute}
            newRouteIds={
              new Set(
                session.lastEvents
                  .filter((e) => e.type === 'route_opened' && e.airline === viewSeat())
                  .map((e) => (e.type === 'route_opened' ? e.routeId : -1)),
              )
            }
            newSlotCities={
              new Set(
                session.lastEvents
                  .filter((e) => e.type === 'slots_granted' && e.airline === viewSeat())
                  .map((e) => (e.type === 'slots_granted' ? e.city : '')),
              )
            }
            acquiredRouteIds={(() => {
              // A takeover appends the target's routes with fresh ids — the
              // last `routes` entries are the ones that just changed flags.
              const deal = session.lastEvents.find((e) => e.type === 'rival_acquired' && e.airline === viewSeat())
              if (!deal || deal.type !== 'rival_acquired' || deal.routes === 0) return new Set<number>()
              return new Set(player.routes.slice(-deal.routes).map((r) => r.id))
            })()}
          />
        </Suspense>
        {state.turn === 0 && player.routes.length === 0 && !selectedCity && !inspectedRoute && !routeFrom && <aside className="first-flight" data-testid="first-flight">
          <strong>Your aircraft are ready. Choose their first route.</strong>
          <p>Compare launch costs and profit on your Desk, then review the quarter to fly.</p>
          <button className="primary-action" onClick={() => setTab('desk')}>Compare first routes <span aria-hidden="true">→</span></button>
        </aside>}
        {flowFocus && <div className="flow-focus-banner" data-testid="flow-focus"><strong>{flowFocus.label}</strong><button onClick={()=>setFlowFocus(null)}>Clear journey</button></div>}
        {tab === "map" && selectedCity !== null && (
          <CityPanel
            state={state}
            cityId={selectedCity}
            onHighlight={highlightFlow}
            routeFrom={routeFrom}
            onPlanRoute={(from) => { setRouteFrom(routeFrom === from ? null : from); setSelectedCity(null) }}
            onPlanPair={(from, to) => {
              setSelectedCity(null)
              setRouteFrom(null)
              setPendingRoute({ from, to })
            }}
            onClose={() => {
              setSelectedCity(null)
              setRouteFrom(null)
            }}
          />
        )}
        {tab === "map" && inspectedRoute !== undefined && (
          <RouteDossier
            state={state}
            routeId={inspectedRoute!.id}
            onClose={() => setSelectedRoute(null)}
            onSelectRoute={setSelectedRoute}
            onHighlight={highlightFlow}
          />
        )}
      </div>

        </section>
        {visited.has('routes') && <section className={`workspace-page route-page split-view${inspectedRoute !== undefined ? ' has-inspector' : ''}`} hidden={tab !== 'routes'} data-testid="page-routes">
          <div className="split-list"><div className="page-heading"><div><span className="eyebrow">Network</span><h2>Routes <span>{player.routes.length}</span></h2></div><span className="dim">Last quarter’s results</span></div><RoutesPanel state={state} selectedRouteId={selectedRoute} onInspect={inspectRoute} onPlan={(from, to, preset) => setPendingRoute({ from, to, preset })} onAirport={(city) => { setTab('map'); setSelectedCity(city); setSelectedRoute(null) }} /></div>
          {tab === 'routes' && inspectedRoute !== undefined && <RouteDossier state={state} routeId={inspectedRoute!.id} onClose={closeRoute} onSelectRoute={setSelectedRoute} onHighlight={highlightFlow} />}
        </section>}
        {visited.has('fleet') && <section className={`workspace-page fleet-page split-view${inspectedAircraft ? ' has-inspector' : ''}`} hidden={tab !== 'fleet'} data-testid="page-fleet"><div className="split-list"><FleetPanel state={state} selectedAircraftId={selectedAircraft} onInspect={setSelectedAircraft} /></div>{tab === 'fleet' && inspectedAircraft && <AircraftDossier state={state} aircraftId={inspectedAircraft.id} onClose={() => { setSelectedAircraft(null); requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-testid="inspect-aircraft-${inspectedAircraft.id}"]`)?.focus({ preventScroll:true })) }} />}</section>}
        {visited.has('orders') && <section className="workspace-page" hidden={tab !== 'orders'} data-testid="page-orders"><FleetPanel state={state} view="orders" /></section>}
        {visited.has('catalog') && <section className="workspace-page" hidden={tab !== 'catalog'} data-testid="page-catalog"><FleetPanel state={state} view="catalog" /></section>}
        {visited.has('airports') && <section className="workspace-page" hidden={tab !== 'airports'} data-testid="page-airports"><div className="page-heading"><h2>Airports</h2></div><AirportsPanel state={state} /></section>}
        {visited.has('rivals') && <section className="workspace-page" hidden={tab !== 'rivals'} data-testid="page-rivals"><Suspense fallback={<p role="status">Loading rival intelligence…</p>}><RivalsPanel state={state} /></Suspense></section>}
        {visited.has('operations') && <section className="workspace-page" hidden={tab !== 'operations'} data-testid="page-operations"><Suspense fallback={<p role="status">Preparing operations calendar…</p>}><OperationsBoard state={state} active={tab==='operations'} /></Suspense></section>}
        {visited.has('outlook') && <section className="workspace-page" hidden={tab !== 'outlook'} data-testid="page-outlook"><Suspense fallback={<p role="status">Preparing capital outlook…</p>}><CapitalOutlook state={state} active={tab==='outlook'} /></Suspense></section>}
        {visited.has('finance') && <section className="workspace-page" hidden={tab !== 'finance'} data-testid="page-finance"><Suspense fallback={<p role="status">Loading finances…</p>}><FinancePanel state={state} /></Suspense></section>}
        {visited.has('report') && <section className="workspace-page" hidden={tab !== 'report'} data-testid="page-report"><Suspense fallback={<p role="status">Loading reports…</p>}><ReportPanel state={state} archive={session.reportArchive} onInspect={(id) => { setTab('routes'); inspectRoute(id) }} /></Suspense></section>}
      </div>
      <PlanTray state={state} />
    </section>
    {celebration.milestones.length > 0 && <Celebration milestones={celebration.milestones} state={state} onClose={celebration.dismiss} />}
    <ToastStack events={session.lastEvents} state={state} unlocks={session.lastUnlocks} onOpenRoute={inspectRoute} />
    {showReview && <Suspense fallback={<Dialog label="Review quarter" className="gameover-overlay" onClose={() => setShowReview(false)}><p role="status">Loading quarter review…</p></Dialog>}><QuarterReview state={state} forecast={forecast} onClose={() => setShowReview(false)} onConfirm={endQuarter} /></Suspense>}
    {showReport && !celebration.milestones.length && session.reportEvents.length > 0 && <Suspense fallback={<Dialog label="Quarterly report" className="gameover-overlay" onClose={() => setShowReport(false)}><p role="status">Loading quarterly report…</p></Dialog>}><ReportCard state={state} events={session.reportEvents} onClose={() => setShowReport(false)} onInspect={(id) => { setShowReport(false); setTab('routes'); inspectRoute(id) }} /></Suspense>}
    {pendingRoute !== null && <RouteSetupDialog state={state} from={pendingRoute.from} to={pendingRoute.to}
        preset={pendingRoute.preset} onClose={() => setPendingRoute(null)} />}
    {state.phase !== 'planning' && <GameOverOverlay state={state} earned={session.careerUnlocks} onWatchReplay={onWatchReplay} />}
    {showSettings && <Dialog label="Settings" className="gameover-overlay" testId="settings-dialog" onClose={() => setShowSettings(false)}><div className="settings-card"><div className="dialog-heading"><h2>Settings</h2><button onClick={() => setShowSettings(false)} aria-label="Close settings">×</button></div>
        <button
          data-testid="share-challenge"
          title="copy a challenge link — same scenario, same seed, same world for whoever opens it"
          aria-label="copy challenge link"
          onClick={() => {
            // The link carries your current net worth as the number to beat —
            // sharing mid-career throws down where you stand right now.
            const me = state.airlines[viewSeat()]!
            const url =
              `${window.location.origin}${window.location.pathname}?scenario=${encodeURIComponent(
                state.scenario,
              )}&seed=${encodeURIComponent(state.seed)}` +
              `&target=${objectiveScore(me, scenario.objective.kind)}&metric=${scenario.objective.kind}&rules=${identityOf(state).rulesVersion}&by=${encodeURIComponent(me.name)}`
            copyText(url, 'Challenge link')
          }}
        >
          <Icon name="share" /> share
        </button>
        <MuteToggle />
        <AudioSettings />
        <DisplaySettings />
<button onClick={() => { setShowSettings(false); setShowHelp(true) }}>Open handbook</button></div></Dialog>}
      {showHelp && (
        <Dialog label="Airline handbook" className="gameover-overlay" testId="help-overlay" onClose={() => setShowHelp(false)}>
          <div className="gameover-card report-card handbook" onClick={(e) => e.stopPropagation()}>
            <h2>Handbook</h2>
            <p className="dim" data-testid="handbook-intro">
              Each scenario has its own goal, shown below. Each quarter you plan (open routes, assign jets, set fares, queue for
              slots), then end the quarter — everyone flies, demand splits by appeal (schedule × cabin
              × fare × service × brand), and the world moves. Every system below is explained where
              you use it too.
            </p>
            <p className="dim" data-testid="handbook-objective">
              <strong>This era: {scenario.objective.blurb}</strong>
            </p>
            <div data-testid="handbook-systems">
              <HubLegend />
              <SpoolLegend />
              <SeasonLegend />
              <SlotLegend />
              <MarketingLegend />
              <HedgeLegend />
              <ReliabilityLegend />
              <RivalryLegend />
              <TakeoverLegend />
              <CabinLegend />
              <ServiceLegend />
            </div>
            <h2>Shortcuts</h2>
            <table className="report-lines">
              <tbody>
                <tr>
                  <td>Space / E</td>
                  <td>review the next quarter before flying</td>
                </tr>
                <tr>
                  <td>1–6</td>
                  <td>switch panels</td>
                </tr>
                <tr>
                  <td>← / →</td>
                  <td>cycle the dossier through your network's cities</td>
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
                  <td>rival overlay · data lens (load → P&L → season) · globe projection</td>
                </tr>
                <tr>
                  <td>Fleet tab</td>
                  <td>🛠 puts every idle plane on its best route in one click</td>
                </tr>
                <tr>
                  <td>Finance tab</td>
                  <td>marketing (brand appeal), fuel hedges, loans at today's rate</td>
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
        </Dialog>
      )}

  </main>
}

// Which build is running. Small, dim, and selectable, in the footer of the
// menu and of the game — the deployed page and the repo are otherwise
// impossible to line up by eye. A trailing "+" means the build was made from
// a working tree with uncommitted changes, so the hash alone would be a lie.
function BuildStamp() {
  return (
    <span
      className="build-stamp"
      data-testid="build-stamp"
      title={`build ${__BUILD_SHA__} · ${__BUILD_TIME__}`}
    >
      {__BUILD_SHA__}
    </span>
  )
}

export function App() {
  const session = useSyncExternalStore(subscribe, getSession)
  const [replay, setReplay] = useState<Replay | null>(null)
  const [mpNotice, setMpNotice] = useState<string | null>(null)
  // Turn links arrive as a URL fragment, and they must work from ANY screen —
  // a player mid-game opens their opponent's reply directly. Same-page hash
  // navigation fires hashchange rather than a reload, so both paths feed the
  // same intake.
  useEffect(() => {
    const intake = (): void => {
      const hash = window.location.hash
      if (!hash.startsWith('#mpturn=')) return
      void receiveTurn(hash.slice('#mpturn='.length)).then((res) => {
        window.history.replaceState(null, '', window.location.pathname)
        setMpNotice(res.ok ? null : res.reason)
      })
    }
    intake()
    window.addEventListener('hashchange', intake)
    return () => window.removeEventListener('hashchange', intake)
  }, [])
  if (replay)
    return (
      <Suspense fallback={<main className="menu">
      <SaveWarning />Loading replay…</main>}>
        <ReplayViewer replay={replay} onExit={() => setReplay(null)} />
      </Suspense>
    )
  return (
    <>
      {mpNotice !== null && (
        <div className="mp-notice" data-testid="mp-notice" role="alert">
          ✉ {mpNotice} <button onClick={() => setMpNotice(null)}>dismiss</button>
        </div>
      )}
      {session ? <GameScreen key={`${session.state.scenario}-${session.state.seed}`} onWatchReplay={setReplay} /> : <ScenarioSelect onWatchReplay={setReplay} />}
    </>
  )
}

function SaveWarning() {
  const warning = useSyncExternalStore(subscribe, getStorageWarning)
  if (!warning) return null
  return <aside role="alert" className="save-warning">{warning} <button onClick={() => {
    const text = exportCurrentCareer()
    if (!text) return
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url; a.download = 'loadfactor-career.json'; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }}>Download career</button></aside>
}
