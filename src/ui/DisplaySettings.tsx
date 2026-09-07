import { setDisplayPreferences, useDisplayPreferences, type DisplayPreferences } from './display'
export function DisplaySettings() {
  const preferences = useDisplayPreferences()
  return <details className="display-settings" data-testid="display-settings"><summary>Display</summary>
    <label>Text size <select aria-label="text size" value={preferences.text} onChange={(e) => setDisplayPreferences({ text: Number(e.target.value) })}><option value="100">Standard</option><option value="112">Large</option><option value="125">Larger</option></select></label>
    <label>Motion <select aria-label="motion preference" value={preferences.motion} onChange={(e) => setDisplayPreferences({ motion: e.target.value as DisplayPreferences['motion'] })}><option value="system">Follow device preference</option><option value="reduced">Reduced motion</option><option value="full">Full motion</option></select></label>
    <label>Map traffic <select aria-label="map traffic density" value={preferences.traffic} onChange={(e) => setDisplayPreferences({ traffic: e.target.value as DisplayPreferences['traffic'] })}><option value="normal">Normal</option><option value="low">Low</option></select></label>
    <label><input type="checkbox" aria-label="Delivery and route animations" checked={preferences.celebrations} onChange={(e) => setDisplayPreferences({ celebrations: e.target.checked })} /> Delivery and route animations</label>
    <label><input type="checkbox" aria-label="Concise quiet quarters" checked={preferences.quietReports} onChange={e=>setDisplayPreferences({quietReports:e.target.checked})} /> Concise quiet quarters</label>
    <p className="hint">Routine results stay on the Desk. New decisions, disruptions, losses and large changes still open a full report.</p>
    <label><input type="checkbox" aria-label="Map performance diagnostics" checked={preferences.diagnostics} onChange={e=>setDisplayPreferences({diagnostics:e.target.checked})} /> Map performance diagnostics</label>
  </details>
}
