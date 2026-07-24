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
