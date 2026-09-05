import { useState } from 'react'
import { audioTheme, getAudioMix, setAudioMix } from './sounds'
import type { AudioMix } from './audioScore'
export function AudioSettings() {
  const [mix, setMix] = useState(getAudioMix)
  return <details className="audio-settings" data-testid="audio-settings"><summary>Sound mix</summary>
    <p>{audioTheme()}</p>
    {(['music', 'ambience', 'effects'] as (keyof AudioMix)[]).map((channel) => <label key={channel}>{channel} <input type="range" aria-label={`${channel} volume`} min="0" max="100" value={Math.round(mix[channel] * 100)} onChange={(e) => {
      setAudioMix(channel, Number(e.target.value) / 100); setMix(getAudioMix())
    }} /><output>{Math.round(mix[channel] * 100)}%</output></label>)}
    <p className="dim">Music follows your era and financial pressure. Sound pauses when this tab is hidden.</p>
  </details>
}
