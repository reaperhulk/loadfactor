import { useEffect, useState } from 'react'

// Isolated subscriber: measuring frames never rerenders the game or map.
// Samples and heap references are bounded; hidden tabs stop the sampler.
export function FrameDiagnostics() {
  const [stats,setStats]=useState({fps:0,p95:0,long:0,heap:0})
  useEffect(()=>{
    const samples:number[]=[]
    let request=0,last=0,report=0
    const frame=(now:number)=>{
      if(last) {samples.push(now-last);if(samples.length>120)samples.shift()}
      last=now
      if(now-report>=1000 && samples.length) {
        const sorted=[...samples].sort((a,b)=>a-b), memory=(performance as Performance & {memory?:{usedJSHeapSize:number}}).memory
        setStats({fps:Math.round(1000/(samples.reduce((n,v)=>n+v,0)/samples.length)),p95:sorted[Math.ceil(sorted.length*.95)-1]!,long:samples.filter(n=>n>50).length,heap:memory?.usedJSHeapSize??0})
        report=now
      }
      request=requestAnimationFrame(frame)
    }
    const visibility=()=>{cancelAnimationFrame(request);last=0;samples.length=0;if(!document.hidden)request=requestAnimationFrame(frame)}
    visibility();document.addEventListener('visibilitychange',visibility)
    return ()=>{cancelAnimationFrame(request);document.removeEventListener('visibilitychange',visibility)}
  },[])
  return <output className="performance-diagnostics" data-testid="frame-diagnostics" aria-live="off" title="Recent frame intervals on this device. Includes display refresh and browser scheduling. Heap is approximate when the browser exposes it.">{stats.fps?`${stats.fps} fps · frame p95 ${stats.p95.toFixed(1)} ms · ${stats.long} over 50 ms`:'Measuring frames…'}{stats.heap>0 && ` · JS ${(stats.heap/1048576).toFixed(0)} MB`}</output>
}
