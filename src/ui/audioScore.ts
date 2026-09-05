// Original generative score: 96-bar arrangements, five era palettes, separate
// buses, a bounded scheduler and gesture-only AudioContext creation. No assets
// or network request are needed to make the terminal feel alive.
import { getScenario } from '../data/scenarios'
import { getSession, viewSeat } from './session'
export interface AudioMix { music: number; ambience: number; effects: number }
const MIX_KEY = 'loadfactor:audio-mix:v1'
let mix: AudioMix = { music: 0.28, ambience: 0.18, effects: 0.7 }
try {
  const saved = JSON.parse(localStorage.getItem(MIX_KEY) ?? '{}') as Partial<AudioMix>
  for (const key of ['music', 'ambience', 'effects'] as const) if (typeof saved[key] === 'number' && Number.isFinite(saved[key])) mix[key] = Math.min(1, Math.max(0, saved[key]!))
} catch { /* use the authored mix */ }
let context: AudioContext | null = null
let master: GainNode | null = null
let duck: GainNode | null = null
let buses: Record<keyof AudioMix, GainNode> | null = null
let transport: ReturnType<typeof setInterval> | null = null
let nextBeat = 0, beat = 0, voices = 0, era = 0
let muted = false
let noise: AudioBuffer | null = null
let lastEffect = -Infinity, variant = 0
export function getAudioMix(): AudioMix { return mix }
export function setAudioMix(channel: keyof AudioMix, value: number): void {
  mix = { ...mix, [channel]: Math.min(1, Math.max(0, value)) }
  try { localStorage.setItem(MIX_KEY, JSON.stringify(mix)) } catch { /* session preference */ }
  if (context && buses) buses[channel].gain.setTargetAtTime(mix[channel], context.currentTime, 0.12)
}
export function muteScore(value: boolean): void {
  muted = value
  if (!context || !master) return
  master.gain.setTargetAtTime(value ? 0 : 0.65, context.currentTime, 0.03)
  if (!value && !document.hidden) void context.resume().catch(() => {})
  if (value) setTimeout(() => { if (muted) suspendScore() }, 60)
}
const PALETTES = [
  { name: 'Departure Lounge · vibraphone & brushed rhythm', bpm: 84, root: 48, tone: 'sine' },
  { name: 'Night Terminal · electric keys & warm bass', bpm: 88, root: 45, tone: 'triangle' },
  { name: 'Departure Board · analog arpeggios', bpm: 108, root: 48, tone: 'triangle' },
  { name: 'Open Horizons · spacious keys & downtempo', bpm: 92, root: 50, tone: 'sine' },
  { name: 'Red Eye · restrained electronic pulse', bpm: 104, root: 45, tone: 'triangle' },
] as const
function desiredEra(): number {
  const s = getSession()?.state
  const year = s ? getScenario(s.scenario).startYear + Math.floor(s.turn / 4) : 1960
  return year < 1970 ? 0 : year < 1985 ? 1 : year < 1995 ? 2 : year < 2005 ? 3 : 4
}
export function audioTheme(): string { return PALETTES[desiredEra()]!.name }
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12)
const CHORDS = [[0, 4, 7, 11], [9, 12, 16, 19], [2, 5, 9, 12], [7, 11, 14, 17], [5, 9, 12, 16], [4, 7, 11, 14], [2, 5, 9, 12], [7, 11, 14, 17]]
const MELODIES = [[7, 11, 12, 16, 14, 11, 9, 7], [4, 7, 11, 9, 7, 4, 2, 0], [12, 16, 19, 16, 14, 12, 11, 7], [9, 7, 4, 2, 4, 7, 11, 12]]
function tone(freq: number, at: number, duration: number, peak: number, type: OscillatorType, channel: keyof AudioMix): void {
  if (!context || !buses || voices >= 72 || mix[channel] === 0) return
  const c = context, oscillator = c.createOscillator(), envelope = c.createGain()
  voices++
  oscillator.type = type; oscillator.frequency.value = freq
  envelope.gain.setValueAtTime(0, at)
  envelope.gain.linearRampToValueAtTime(peak, at + Math.min(0.03, duration / 4))
  envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration)
  oscillator.connect(envelope).connect(buses[channel])
  oscillator.start(at); oscillator.stop(at + duration + 0.02)
  oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect(); voices = Math.max(0, voices - 1) }
}
function air(at: number, duration: number, gain: number, cutoff: number): void {
  if (!context || !buses || !noise || mix.ambience === 0) return
  const source = context.createBufferSource(), filter = context.createBiquadFilter(), envelope = context.createGain()
  source.buffer = noise; source.loop = true
  filter.type = 'lowpass'; filter.frequency.value = cutoff
  envelope.gain.setValueAtTime(0, at)
  envelope.gain.linearRampToValueAtTime(gain, at + duration / 3)
  envelope.gain.linearRampToValueAtTime(0, at + duration)
  source.connect(filter).connect(envelope).connect(buses.ambience)
  source.start(at); source.stop(at + duration)
  source.onended = () => { source.disconnect(); filter.disconnect(); envelope.disconnect() }
}
function schedule(): void {
  if (!context || document.hidden || context.state !== 'running' || muted) return
  if (nextBeat < context.currentTime - 0.5) nextBeat = context.currentTime + 0.05
  while (nextBeat < context.currentTime + 0.3) {
    if (beat % 16 === 0) {
      const nextEra = desiredEra()
      if (nextEra !== era && buses) {
        buses.music.gain.setTargetAtTime(0, nextBeat, 0.12)
        buses.music.gain.setTargetAtTime(mix.music, nextBeat + 0.4, 0.6)
        era = nextEra
      }
    }
    const palette = PALETTES[era]!, step = 60 / palette.bpm
    const section = Math.floor(beat / 32) % 12, bar = Math.floor(beat / 4)
    const chord = CHORDS[(Math.floor(bar / 2) + Math.floor(section / 4)) % CHORDS.length]!
    const state = getSession()?.state, airline = state?.airlines[viewSeat()]
    const tense = Boolean(airline && (airline.cash < (airline.history.at(-1)?.costs ?? 0) || (airline.history.at(-1)?.profit ?? 0) < 0))
    const root = palette.root + (tense ? -3 : 0)
    if (beat % 8 === 0) for (const note of chord.slice(0, 3)) tone(hz(root + note + 12), nextBeat, step * 5, 0.035, 'sine', 'music')
    if (beat % 2 === 0) tone(hz(root + (beat % 4 === 0 ? chord[0]! : chord[2]!) - 12), nextBeat, step * 1.3, 0.09, 'triangle', 'music')
    // A breathing phrase every fourth section prevents a relentless melody.
    if (section % 4 !== 3 && (beat % 2 === 0 || era === 2 || era === 4)) {
      const melody = MELODIES[(section + Math.floor(bar / 8)) % MELODIES.length]!
      const n = melody[Math.floor(beat / (era === 2 ? 1 : 2)) % melody.length]!
      tone(hz(root + n + 24), nextBeat + (beat % 2 ? step * 0.08 : 0), step * (era === 0 ? 1.5 : 0.8), 0.045, palette.tone, 'music')
      if (era === 0) tone(hz(root + n + 36), nextBeat, step * 0.4, 0.008, 'sine', 'music')
    }
    if (era >= 2 && beat % 4 === 0) tone(55, nextBeat, 0.14, 0.12, 'sine', 'music')
    if (tense && beat % 2 === 1) tone(hz(root - 12), nextBeat, 0.15, 0.045, 'triangle', 'music')
    if (beat % 32 === 0) air(nextBeat, step * 24, 0.13, 260)
    if (beat % 16 === 8) { tone(720, nextBeat, 0.018, 0.045, 'triangle', 'ambience'); tone(510, nextBeat + 0.04, 0.018, 0.03, 'triangle', 'ambience') }
    nextBeat += step; beat = (beat + 1) % 384
  }
}
export function unlockScore(): void {
  if (typeof AudioContext === 'undefined' || document.hidden || muted) return
  if (!context) {
    context = new AudioContext()
    master = context.createGain(); master.gain.value = muted ? 0 : 0.65
    const compressor = context.createDynamicsCompressor()
    compressor.threshold.value = -16; compressor.ratio.value = 5
    master.connect(compressor).connect(context.destination)
    duck = context.createGain(); duck.connect(master)
    buses = { music: context.createGain(), ambience: context.createGain(), effects: context.createGain() }
    for (const key of ['music', 'ambience', 'effects'] as const) { buses[key].gain.value = mix[key]; buses[key].connect(key === 'music' ? duck : master) }
    // A soft, filtered echo gives the keys space without muddying alerts.
    const delay = context.createDelay(1), echo = context.createGain(), filter = context.createBiquadFilter()
    delay.delayTime.value = 0.28; echo.gain.value = 0.16; filter.frequency.value = 2000
    buses.music.connect(delay).connect(filter).connect(echo).connect(duck)
    noise = context.createBuffer(1, context.sampleRate * 2, context.sampleRate)
    const samples = noise.getChannelData(0); let seed = 271828, previous = 0
    for (let i = 0; i < samples.length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; previous = 0.94 * previous + 0.06 * ((seed >>> 0) / 2147483648 - 1); samples[i] = previous }
    era = desiredEra(); nextBeat = context.currentTime + 0.05
    transport = setInterval(schedule, 150)
  }
  if (!transport) transport = setInterval(schedule, 150)
  if (!muted) void context.resume().then(schedule).catch(() => {})
}
export function suspendScore(): void {
  if (transport) clearInterval(transport)
  transport = null
  if (context) void context.suspend().catch(() => {})
}
export function disposeScore(): void {
  if (transport) clearInterval(transport)
  transport = null
  if (context) void context.close().catch(() => {})
  context = null; master = null; buses = null; duck = null; noise = null; voices = 0
}
const CUES: Record<string, number[]> = { route: [72, 79], delivery: [67, 72, 76], slots: [72, 76, 79], quarter: [64], victory: [72, 76, 79, 84], defeat: [57, 53, 48], achievement: [76, 81, 88], incursion: [55, 50], loss: [62, 59] }
export function playCue(name: string): void {
  if (!context || context.state !== 'running' || muted || document.hidden) return
  const priority = name === 'victory' || name === 'defeat' || name === 'achievement'
  if (!priority && context.currentTime - lastEffect < 0.35) return
  lastEffect = context.currentTime
  const notes = CUES[name] ?? CUES.quarter!
  const shift = priority ? 0 : [0, 2, 0, -2][variant++ % 4]!
  if (duck) { duck.gain.cancelScheduledValues(context.currentTime); duck.gain.setTargetAtTime(0.4, context.currentTime, 0.04); duck.gain.setTargetAtTime(1, context.currentTime + 0.6, 0.3) }
  notes.forEach((n, i) => tone(hz(n + shift), context!.currentTime + i * 0.1, priority ? 0.55 : 0.24, 0.12, name === 'incursion' ? 'triangle' : 'sine', 'effects'))
}

export function resumeScore(): void {
  if (context && !muted && !document.hidden) {
    if (!transport) transport = setInterval(schedule, 150)
    void context.resume().then(schedule).catch(() => {})
  }
}
