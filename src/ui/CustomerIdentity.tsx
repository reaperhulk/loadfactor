import type { Airline } from '../engine'
export function CustomerIdentity({airline,compact=false}:{airline:Airline;compact?:boolean}) {
  const preference=airline.customerPreference
  if (!preference) return null
  return <section className="customer-identity" data-testid={`customer-identity-${airline.id}`}><h3>Earned customer preference</h3><dl className="decision-metrics">{(['business','leisure','budget'] as const).map(segment=><div key={segment}><dt>{segment}</dt><dd className={preference[segment]>=10000?'pos':'neg'}>{preference[segment]>=10000?'+':''}{((preference[segment]-10000)/100).toFixed(1)}%</dd></div>)}</dl>{!compact && <p className="hint">Appeal compared with an unfamiliar airline. Business travelers remember frequent, dependable full service; budget travelers remember low fares. Leisure travelers value both. Only carried passengers build this identity. It changes gradually over several quarters; missed flights erode it.</p>}</section>
}
