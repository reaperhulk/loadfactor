import { memo, useId } from 'react'
import { aircraftFamily, getAircraftType, isWidebodyAircraft } from '../data/aircraft'
// Nose points along +x, matching SVG animateMotion's automatic rotation.
export function aircraftGlyph(type: string): string {
  if (type === 'concorde') return 'M-12,-1 L-2,-2 L5,-10 L7,-10 L5,-2 L14,0 L5,2 L7,10 L5,10 L-2,2 L-12,1 L-14,5 L-16,5 L-14,0 L-16,-5 L-14,-5Z'
  if (isWidebodyAircraft(type)) return 'M-11,-2 L-2,-2 L-5,-12 L-1,-12 L5,-3 L13,-1 L15,0 L13,1 L5,3 L-1,12 L-5,12 L-2,2 L-11,2 L-14,6 L-16,6 L-14,0 L-16,-6 L-14,-6Z'
  if (type === 'cv240') return 'M-10,-1 L-2,-1 L-2,-10 L1,-10 L3,-2 L12,-1 L14,0 L12,1 L3,2 L1,10 L-2,10 L-2,1 L-10,1 L-12,5 L-14,5 L-12,0 L-14,-5 L-12,-5Z'
  return 'M-10,-1 L-2,-1 L-5,-10 L-2,-10 L4,-2 L12,-1 L14,0 L12,1 L4,2 L-2,10 L-5,10 L-2,1 L-10,1 L-13,5 L-15,5 L-13,0 L-15,-5 L-13,-5Z'
}
// Stylized fleet portraits: proportions and engine/tail arrangements identify
// the airframe. Shared paths keep a full catalog light; no filters or bitmaps.
const LENGTHS: Record<string, number> = { cv240: 154, caravelle: 185, b727: 215,
  b737_200: 180, dc8_62: 232, b747_100: 246, b747_200: 246, dc10_30: 229,
  b767: 216, concorde: 251, b757: 225, a320: 192, md11: 239, a340: 245, b777: 246 }

export const AircraftArt = memo(function AircraftArt({ type }: { type: string }) {
  const t = getAircraftType(type), id = useId()
  const wide = isWidebodyAircraft(type), supersonic = type === 'concorde', prop = type === 'cv240'
  const jumbo = type.startsWith('b747'), trijet = ['dc10_30', 'md11'].includes(type)
  const rear = type === 'caravelle' || type === 'b727', tTail = type === 'b727'
  const four = jumbo || type === 'dc8_62' || type === 'a340'
  const winglet = ['a320', 'a340', 'md11'].includes(type)
  const x = 262 - LENGTHS[type]!, h = supersonic ? 7 : wide ? 18 : 12
  const top = 54-h/2, bottom = 54+h/2, wing = x+(262-x)*.55
  const body = jumbo
    ? `M${x} 55L${x+28} 44H185L199 35H230Q242 36 250 47L260 51Q269 56 254 60L233 64H${x+29}Z`
    : supersonic
    ? `M${x} 55L${x+37} ${top}H225L269 59L245 ${bottom+1}H${x+35}Z`
    : `M${x} 55Q${x+15} ${top+2} ${x+30} ${top}H232Q245 ${top} 251 49L261 53Q268 57 254 60L234 ${bottom}H${x+30}Q${x+12} ${bottom-2} ${x} 55Z`
  const tail = `M${x+10} 53L${x+3} ${prop ? 28 : 17}H${x+16}L${x+45} 53Z`
  const windows = Array.from({length: Math.floor((225-(x+44))/6)}, (_,i) => {
    const wx = x+44+i*6, wy = top+4
    return `M${wx} ${wy}h2.5v3h-2.5Z`
  }).join(' ')
  const pod = (px: number, py: number, size = 1) => <g transform={`translate(${px} ${py}) scale(${size})`}>
    <path d="M-20-4Q-26-1-21 4H-3Q3 3 3 0Q3-4-3-4Z" fill={`url(#${id}-metal)`} stroke="#7f99a2" strokeWidth=".6" />
    <ellipse cx="1" cy="0" rx="2.1" ry="3.6" fill="#163442" />
    <path d="M-21-2H-3" stroke="#fff" strokeOpacity=".7" strokeWidth=".7" />
  </g>
  return <figure className={`aircraft-art ${wide ? 'widebody' : supersonic ? 'supersonic' : 'regional'}`} data-aircraft-type={type}>
    <svg viewBox="0 0 280 96" role="img" aria-label={`${t.name} aircraft illustration`}>
      <defs>
        <linearGradient id={`${id}-metal`} x1="0" y1="0" x2="0" y2="1" gradientUnits="objectBoundingBox">
          <stop offset="0" stopColor="#f7faf5" /><stop offset=".48" stopColor="#dce7e5" />
          <stop offset=".58" stopColor="#b4c7cb" /><stop offset="1" stopColor="#718f9b" />
        </linearGradient>
        <linearGradient id={`${id}-wing`} x1="0" y1="0" x2=".7" y2="1">
          <stop stopColor="#dee8e8" /><stop offset="1" stopColor="#658695" />
        </linearGradient>
        <clipPath id={`${id}-body`}><path d={body} /></clipPath>
        <clipPath id={`${id}-tail`}><path d={tail} /></clipPath>
      </defs>
      <path className="aircraft-apron" d="M0 81H280M30 96L91 70M124 96L149 70M219 96L207 70" />
      <ellipse className="aircraft-shadow" cx="150" cy="80" rx={(262-x)*.46} ry="3.5" />
      {/* Far wing/engine are behind the fuselage; near hardware is in front. */}
      <path d={`M${wing+22} 51L${wing-22} 34H${wing-34}L${wing-8} 55Z`} fill="#547280" stroke="#8da8b0" strokeWidth=".6" />
      {!rear && !supersonic && <g opacity=".7">{pod(wing-9, 42, wide ? 1 : .7)}{four && pod(wing-29, 37, .7)}</g>}
      <path d={tail} className="aircraft-tail" />
      <g clipPath={`url(#${id}-tail)`}><path d={`M${x} 40L${x+40} 24L${x+45} 30L${x+3} 48Z`} fill="#fff" opacity=".8" /></g>
      {tTail && <path d={`M${x+5} 20L${x-7} 24H${x+30}L${x+21} 19Z`} fill="#c9d9dc" stroke="#7898a4" strokeWidth=".6" />}
      {trijet && pod(x+29, 32, .95)}
      {tTail && pod(x+26, 37, .7)}
      <path d={body} fill={`url(#${id}-metal)`} stroke="#8aa3aa" strokeWidth=".6" />
      <g clipPath={`url(#${id}-body)`}>
        <path d={`M${x} ${top+8}H263`} className="aircraft-stripe" strokeWidth={supersonic ? 1.5 : 2.5} />
        <path d={windows} className="aircraft-window" />
        {jumbo && <path d="M204 39h3v3h-3Z M211 39h3v3h-3Z M218 39h3v3h-3Z" className="aircraft-window" />}
        <path d={`M${x+36} ${top+2}v${h-3}m${(226-x-36)/2} ${3-h}v${h-3}M228 ${top+2}v${h-3}`} className="aircraft-seam" />
      </g>
      <path d={jumbo ? 'M235 40L243 43L247 47H237Z' : supersonic ? 'M236 52L246 55H238Z' : `M238 ${top+2}L247 49L251 52H240Z`} className="aircraft-cockpit" />
      <path d={supersonic ? `M206 55L69 77L151 79L224 58Z` : `M${wing+29} 57L${wing-30} 80H${wing-49}L${wing-1} 56Z`} fill={`url(#${id}-wing)`} stroke="#b9cccf" strokeWidth=".7" />
      <path d={`M${wing+15} 60L${wing-33} 77`} className="aircraft-seam" />
      {winglet && <path d={`M${wing-49} 80l-2-9 6 7Z`} className="aircraft-tail" />}
      {!tTail && <path d={`M${x+33} 55L${x+3} 65H${x+18}L${x+52} 55Z`} fill={`url(#${id}-wing)`} stroke="#b9cccf" strokeWidth=".6" />}
      {rear ? pod(x+41, 55, .9) : supersonic
        ? <path d="M130 70h28v6h-28Z M167 66h25v6h-25Z" fill="#537380" stroke="#b9cccf" strokeWidth=".6" />
        : <>{pod(wing+3, 68, prop ? .65 : wide ? 1.15 : .85)}{four && pod(wing-23, 75, .85)}</>}
      {prop && <g className="aircraft-prop"><path d={`M${wing+5} 56v23`} /><ellipse cx={wing+5} cy="67.5" rx="1.4" ry="11.5" /><circle cx={wing+5} cy="67.5" r="1.6" /></g>}
      <text x="13" y="17">{supersonic ? 'SUPERSONIC' : prop ? 'PROPLINER' : wide ? 'WIDEBODY' : 'JETLINER'}</text>
      <path className="aircraft-datum" d="M13 23H55M13 21v4M55 21v4" />
    </svg>
    <figcaption>{aircraftFamily(type)} · {t.seats} seats</figcaption>
  </figure>
})
