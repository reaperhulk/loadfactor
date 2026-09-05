// A tiny WebAudio synth for reward moments — no samples, just enveloped
// oscillators. Muting persists; the AudioContext is created lazily on the
// first user-gesture-driven event so autoplay policies stay happy.

import type { GameEvent } from '../engine'
import { viewSeat, subscribe, getSession } from './session'

const MUTE_KEY = 'loadfactor:muted:v1'

let muted = false
try {
  muted = localStorage.getItem(MUTE_KEY) === '1'
} catch {
  // storage unavailable — default unmuted
}

export { getAudioMix, setAudioMix, audioTheme } from './audioScore'
import { muteScore, playCue, resumeScore, suspendScore, unlockScore } from './audioScore'

export function isMuted(): boolean { return muted }
export function setMuted(value: boolean): void {
  muted = value
  muteScore(value)
  if (!value) unlockScore()
  try { localStorage.setItem(MUTE_KEY, value ? '1' : '0') } catch { /* session-only preference */ }
}

function soundFor(events: GameEvent[]): string | null {
  // Loudest moment wins; one jingle per engine call.
  for (const e of events) {
    if (e.type === 'game_over') return e.result === 'won' ? 'victory' : 'defeat'
  }
  for (const e of events) {
    if (e.type === 'slots_granted' && e.airline === viewSeat()) return 'slots'
  }
  for (const e of events) {
    if (e.type === 'route_opened' && e.airline === viewSeat()) return 'route'
    if (e.type === 'aircraft_delivered' && e.airline === viewSeat()) return 'delivery'
  }
  for (const e of events) {
    // A rival opening on a pair the player serves is an act of war.
    if (e.type === 'route_opened' && e.airline !== viewSeat()) {
      const mine = getSession()?.state.airlines[viewSeat()]?.routes ?? []
      if (mine.some((r) => (r.from === e.from && r.to === e.to) || (r.from === e.to && r.to === e.from))) {
        return 'incursion'
      }
    }
  }
  for (const e of events) {
    if (e.type === 'slots_released' && e.airline === viewSeat()) return 'loss'
  }
  for (const e of events) {
    if (e.type === 'quarter_report' && e.airline === viewSeat()) return 'quarter'
  }
  return null
}

// Listen to the session and score its events. Installed once from main.tsx.
export function installSounds(): void {
  muteScore(muted)
  const activate = () => unlockScore()
  document.addEventListener('pointerdown', activate, { passive: true })
  document.addEventListener('keydown', activate)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) suspendScore()
    else if (!muted) resumeScore()
  })
  let lastEvents: GameEvent[] | null = null
  subscribe(() => {
    const session = getSession()
    if (!session || session.lastEvents === lastEvents) return
    lastEvents = session.lastEvents
    if (muted) return
    const jingle = soundFor(session.lastEvents)
    // Achievements outrank everything except the game ending itself.
    if (session.lastUnlocks.length > 0 && jingle !== 'victory' && jingle !== 'defeat') {
      playCue('achievement')
      return
    }
    if (jingle) playCue(jingle)
  })
}
