// Achievements: career milestones persisted across games. Evaluated in the
// session after every engine call — pure checks over state/events, stored as
// unlock flags in localStorage. Presentation-only; the engine knows nothing.

import type { GameEvent, GameState } from '../engine'
import { netWorth, slotCities } from '../engine/queries'

export interface AchievementDef {
  id: string
  icon: string
  name: string
  desc: string
  test: (state: GameState, events: GameEvent[]) => boolean
}

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  {
    id: 'first_flight',
    icon: '🛫',
    name: 'First flight',
    desc: 'Open your first route',
    test: (s) => s.airlines[0]!.routes.length >= 1,
  },
  {
    id: 'full_house',
    icon: '💺',
    name: 'Full house',
    desc: 'Fly a quarter at a 100% load factor on any route',
    test: (s) => s.airlines[0]!.routes.some((r) => r.lastCapacity > 0 && r.lastLoadFactorBp === 10000),
  },
  {
    id: 'globetrotter',
    icon: '🌍',
    name: 'Globetrotter',
    desc: 'Hold slots in 12 cities at once',
    test: (s) => slotCities(s.airlines[0]!).length >= 12,
  },
  {
    id: 'billionaire',
    icon: '💰',
    name: 'Billionaire',
    desc: 'Reach $1B net worth',
    test: (s) => netWorth(s.airlines[0]!) >= 1_000_000,
  },
  {
    id: 'concorde_club',
    icon: '🚀',
    name: 'Concorde club',
    desc: 'Put a Concorde in your fleet',
    test: (s) => s.airlines[0]!.fleet.some((a) => a.type === 'concorde'),
  },
  {
    id: 'war_winner',
    icon: '⚖️',
    name: 'Jumped the queue',
    desc: 'Take slots at an airport a rival had already declared for',
    // You saw the campaign announced and got your name on the list first.
    test: (_s, events) =>
      events.some(
        (e) =>
          e.type === 'slots_granted' &&
          e.airline === 0 &&
          events.some((r) => r.type === 'slot_requested' && r.airline !== 0 && r.city === e.city),
      ),
  },
  {
    id: 'oil_proof',
    icon: '🛢️',
    name: 'Shockproof',
    desc: 'Fly a profitable quarter through an oil shock',
    // Judged right after a quarter resolves, while the shock still burns.
    test: (s, events) =>
      events.some((e) => e.type === 'quarter_report' && e.airline === 0) &&
      s.world.events.some((e) => e.id === 'oil_shock') &&
      (s.airlines[0]!.history[s.airlines[0]!.history.length - 1]?.profit ?? 0) > 0,
  },
  {
    id: 'magnate',
    icon: '💼',
    name: 'Magnate',
    desc: 'Acquire a distressed rival',
    test: (_s, events) => events.some((e) => e.type === 'rival_acquired' && e.airline === 0),
  },
  {
    id: 'tycoon',
    icon: '🏆',
    name: 'Tycoon',
    desc: 'Win any scenario',
    test: (s) => s.phase === 'won',
  },
]

const KEY = 'loadfactor:achievements:v1'

export function loadAchievements(): Record<string, true> {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? (JSON.parse(raw) as Record<string, true>) : {}
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

// Returns the defs newly unlocked by this engine result (already persisted).
export function checkAchievements(state: GameState, events: GameEvent[]): AchievementDef[] {
  const have = loadAchievements()
  const fresh = ACHIEVEMENTS.filter((a) => !have[a.id] && a.test(state, events))
  if (fresh.length === 0) return []
  try {
    for (const a of fresh) have[a.id] = true
    localStorage.setItem(KEY, JSON.stringify(have))
  } catch {
    // no storage — session-only glory
  }
  return fresh
}
