import { useId } from 'react'
import { isWidebodyAircraft } from '../data/aircraft'

// End-on portraits for the runway's depth axis. The fleet/catalog portraits
// are side elevations and cannot be used for a head-on approach or departure.
export function RunwayAircraft({ type, approaching }: { type: string; approaching: boolean }) {
  const id = useId(), wide = isWidebodyAircraft(type), prop = type === 'cv240'
  const delta = type === 'concorde', rearEngines = type === 'caravelle' || type === 'b727'
  const four = type.startsWith('b747') || type === 'dc8_62' || type === 'a340' || delta
  const trijet = ['b727', 'dc10_30', 'md11'].includes(type)
  const engines = rearEngines ? [128,172] : four ? [68,106,194,232] : [101,199]
  const radius = wide ? 14 : delta ? 8 : 11
  return <svg className="runway-aircraft" data-view={approaching ? 'front' : 'rear'} viewBox="0 0 300 120" aria-hidden="true">
    <defs><linearGradient id={`${id}-metal`} x2="0" y2="1"><stop stopColor="#f5faf5" /><stop offset=".55" stopColor="#c7dbe0" /><stop offset="1" stopColor="#708d9a" /></linearGradient></defs>
    <path d="M146 60L147 14Q150 10 153 14L154 60Z" fill="var(--livery,#7ebcc7)" stroke="#d8eeea" />
    <path d="M145 45L111 39L110 42L140 51H160L190 42L189 39L155 45Z" fill="#c0d5da" />
    <path d={delta ? 'M143 62L40 75L42 80L146 77H154L258 80L260 75L157 62Z' : 'M141 65L91 61L14 49L12 53L86 73L143 78H157L214 73L288 53L286 49L209 61L159 65Z'} fill={`url(#${id}-metal)`} stroke="#a9c6cd" />
    {engines.map((x) => <g key={x}>
      <path d={`M${x-2} 67v12h4V67`} fill="#afc8cf" />
      <circle cx={x} cy={rearEngines ? 60 : 80} r={wide ? 9 : 7} fill="#b7cfd4" stroke="#e0ece9" />
      <circle cx={x} cy={rearEngines ? 60 : 80} r={wide ? 6.5 : 4.8} fill={approaching ? '#193747' : '#42576a'} />
      <circle cx={x} cy={rearEngines ? 60 : 80} r="1.7" fill="#91aab6" />
      {prop && <g stroke="#d9e8df" opacity=".7"><circle cx={x} cy="80" r="15" fill="none" /><path d={`M${x} 65v30m-13-22 26 14m-26 0 26-14`} /></g>}
    </g>)}
    {trijet && <circle cx="150" cy="38" r="6" fill="#355061" stroke="#d1e3e2" />}
    <g className="runway-gear" stroke="#d2e2df" strokeWidth="2.5"><path d="M135 78v14m30-14v14m-15-12v19" /><path d="M131 94h8m22 0h8m-23 7h8" stroke="#172b37" strokeWidth="5" /></g>
    <ellipse cx="150" cy="66" rx={radius} ry={wide ? 20 : 16} fill={`url(#${id}-metal)`} stroke="#e4efeb" />
    {approaching ? <><path d={`M${151-radius} 60l3-6h${radius*2-8}l3 6-5 2h-${radius*2-12}Z`} fill="#173b50" /><path d="M150 54v8" stroke="#c2d5d8" strokeWidth="1.5" /><path d={`M${151-radius} 71Q150 78 ${149+radius} 71`} fill="none" stroke="var(--livery,#7ebcc7)" strokeWidth="3" /></>
      : <><ellipse cx="150" cy="69" rx="5" ry="8" fill="#79939f" /><path d="M148 62V17h4v45Z" fill="var(--livery,#7ebcc7)" stroke="#d7ebe7" /></>}
    <circle cx="14" cy="51" r="2" fill={approaching ? '#9ae1b9' : '#f7a498'} /><circle cx="286" cy="51" r="2" fill={approaching ? '#f7a498' : '#9ae1b9'} />
  </svg>
}
