import type { Airline } from '../engine'
import { signedPct, tone } from './format'

// Each segment says who it is and what earns their loyalty, so a bare
// "−0.4%" is never left to interpretation.
const SEGMENTS = [
  { key: 'business', label: 'Business travelers', builds: 'frequent, dependable full service' },
  { key: 'leisure', label: 'Leisure travelers', builds: 'fair fares and good service' },
  { key: 'budget', label: 'Budget travelers', builds: 'low fares' },
] as const

export function CustomerIdentity({ airline, compact = false }: { airline: Airline; compact?: boolean }) {
  const preference = airline.customerPreference
  if (!preference) return null
  return (
    <section className="customer-identity" data-testid={`customer-identity-${airline.id}`}>
      <h3>Earned customer preference</h3>
      <p className="customer-identity-lede">Appeal by passenger segment, compared with an unfamiliar airline (0.0%). Above zero wins share where you compete.</p>
      <dl className="customer-identity-list">
        {SEGMENTS.map(({ key, label, builds }) => (
          <div key={key} data-testid={`preference-${key}`}>
            <dt>{label}<small>Remember {builds}</small></dt>
            <dd className={tone(preference[key] - 10000)}>{signedPct(preference[key] - 10000, 1)}</dd>
          </div>
        ))}
      </dl>
      {!compact && <p className="hint">Only carried passengers build this identity. It changes gradually over several quarters; missed flights erode it.</p>}
    </section>
  )
}
