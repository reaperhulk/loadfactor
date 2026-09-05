import { aircraftFamily, getAircraftType, isWidebodyAircraft } from '../data/aircraft'
// Nose points along +x, matching SVG animateMotion's automatic rotation.
export function aircraftGlyph(type: string): string {
  if (type === 'concorde') return 'M-12,-1 L-2,-2 L5,-10 L7,-10 L5,-2 L14,0 L5,2 L7,10 L5,10 L-2,2 L-12,1 L-14,5 L-16,5 L-14,0 L-16,-5 L-14,-5Z'
  if (isWidebodyAircraft(type)) return 'M-11,-2 L-2,-2 L-5,-12 L-1,-12 L5,-3 L13,-1 L15,0 L13,1 L5,3 L-1,12 L-5,12 L-2,2 L-11,2 L-14,6 L-16,6 L-14,0 L-16,-6 L-14,-6Z'
  if (type === 'cv240') return 'M-10,-1 L-2,-1 L-2,-10 L1,-10 L3,-2 L12,-1 L14,0 L12,1 L3,2 L1,10 L-2,10 L-2,1 L-10,1 L-12,5 L-14,5 L-12,0 L-14,-5 L-12,-5Z'
  return 'M-10,-1 L-2,-1 L-5,-10 L-2,-10 L4,-2 L12,-1 L14,0 L12,1 L4,2 L-2,10 L-5,10 L-2,1 L-10,1 L-13,5 L-15,5 L-13,0 L-15,-5 L-13,-5Z'
}
export function AircraftArt({ type }: { type: string }) {
  const t = getAircraftType(type)
  const wide = isWidebodyAircraft(type), supersonic = type === 'concorde', prop = type === 'cv240'
  return <figure className={`aircraft-art ${wide ? 'widebody' : supersonic ? 'supersonic' : 'regional'}`}>
    <svg viewBox="0 0 280 96" role="img" aria-label={`${t.name} aircraft illustration`}>
      <path className="aircraft-shadow" d="M25 76Q140 59 259 76Q138 84 25 76Z" />
      <path className="aircraft-metal" d={supersonic ? 'M22 53L73 48L212 48L266 57L211 62L61 61Z' : wide ? 'M24 51L58 41L225 41Q246 42 259 56L240 64L57 64L25 59Z' : 'M26 50L65 45L227 45Q247 46 261 57L238 64L64 64L27 58Z'} />
      {type.startsWith('b747') && <path className="aircraft-metal" d="M172 43L185 34H224Q235 36 243 47Z" />}
      <path className="aircraft-stripe" d="M40 55H253L240 59H44Z" />
      <path className="aircraft-tail" d="M31 54L20 16L43 16L77 54Z" />
      <path className="aircraft-wing" d={supersonic ? 'M99 59L60 88L169 70L206 57Z' : 'M123 57L83 87L120 87L185 57Z'} />
      <path className="aircraft-tailplane" d="M49 55L25 70L49 70L87 55Z" />
      <path className="aircraft-cockpit" d="M225 45L241 48L248 53H230Z" />
      {Array.from({ length: wide ? 17 : 12 }, (_, i) => <rect key={i} className="aircraft-window" x={77+i*(wide?8:11)} y={wide?47:49} width="3" height="3" rx="1" />)}
      <path className="aircraft-engine" d={wide ? 'M126 71h30v8h-30Z M165 63h24v7h-24Z' : 'M122 70h24v8h-24Z'} />
      {prop && <path className="aircraft-prop" d="M140 59V89M136 73H144" />}
      <text x="260" y="89" textAnchor="end">{supersonic ? 'SUPERSONIC' : wide ? 'WIDEBODY' : prop ? 'PROPLINER' : 'JETLINER'}</text>
    </svg>
    <figcaption>{aircraftFamily(type)} · {t.seats} seats</figcaption>
  </figure>
}
