// A tiny WebAudio synth for reward moments — no samples, just enveloped
// oscillators. Muting persists; the AudioContext is created lazily on the
// first user-gesture-driven event so autoplay policies stay happy.

import type { GameEvent } from '../engine'
import { subscribe, getSession } from './session'

const MUTE_KEY = 'loadfactor:muted:v1'

let muted = false
try {
  muted = localStorage.getItem(MUTE_KEY) === '1'
} catch {
  // storage unavailable — default unmuted
}

let ctx: AudioContext | null = null

function audio(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null
  if (!ctx) ctx = new AudioContext()
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

export function isMuted(): boolean {
  return muted
}

export function setMuted(value: boolean): void {
  muted = value
  try {
    localStorage.setItem(MUTE_KEY, value ? '1' : '0')
  } catch {
    // session-only preference
  }
}

// One enveloped note. time is relative to "now".
function note(freq: number, time: number, duration: number, gainPeak = 0.08, type: OscillatorType = 'sine'): void {
  const c = audio()
  if (!c) return
  const osc = c.createOscillator()
  const gain = c.createGain()
  osc.type = type
  osc.frequency.value = freq
  const t0 = c.currentTime + time
  gain.gain.setValueAtTime(0, t0)
  gain.gain.linearRampToValueAtTime(gainPeak, t0 + 0.015)
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration)
  osc.connect(gain).connect(c.destination)
  osc.start(t0)
  osc.stop(t0 + duration + 0.05)
}

const JINGLES: Record<string, () => void> = {
  route: () => {
    note(523, 0, 0.18)
    note(784, 0.09, 0.25)
  },
  delivery: () => {
    note(392, 0, 0.15, 0.06, 'triangle')
    note(523, 0.08, 0.2, 0.06, 'triangle')
  },
  slots: () => {
    note(523, 0, 0.12)
    note(659, 0.07, 0.12)
    note(784, 0.14, 0.22)
  },
  quarter: () => {
    note(330, 0, 0.08, 0.04, 'triangle')
  },
  victory: () => {
    note(523, 0, 0.2)
    note(659, 0.12, 0.2)
    note(784, 0.24, 0.2)
    note(1047, 0.36, 0.45, 0.1)
  },
  defeat: () => {
    note(220, 0, 0.4, 0.07, 'sawtooth')
    note(208, 0.25, 0.6, 0.06, 'sawtooth')
  },
}

function soundFor(events: GameEvent[]): string | null {
  // Loudest moment wins; one jingle per engine call.
  for (const e of events) {
    if (e.type === 'game_over') return e.result === 'won' ? 'victory' : 'defeat'
  }
  for (const e of events) {
    if (e.type === 'slots_granted' && e.airline === 0) return 'slots'
  }
  for (const e of events) {
    if (e.type === 'route_opened' && e.airline === 0) return 'route'
    if (e.type === 'aircraft_delivered' && e.airline === 0) return 'delivery'
  }
  for (const e of events) {
    if (e.type === 'quarter_report' && e.airline === 0) return 'quarter'
  }
  return null
}

// Listen to the session and score its events. Installed once from main.tsx.
export function installSounds(): void {
  let lastEvents: GameEvent[] | null = null
  subscribe(() => {
    const session = getSession()
    if (!session || session.lastEvents === lastEvents) return
    lastEvents = session.lastEvents
    if (muted) return
    const jingle = soundFor(session.lastEvents)
    if (jingle) JINGLES[jingle]?.()
  })
}
