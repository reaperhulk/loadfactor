import type { CareerResult } from './simulate'

export function pacingMetrics(career: CareerResult) {
  const {state,commandLog}=career
  let leader=-1,leadChanges=0, competitiveQuarters=0, quartersMeasured=0
  for(const point of career.race.filter(p=>p.turn>=8)) {
    if(leader!==-1 && point.leader!==leader) leadChanges++
    leader=point.leader; quartersMeasured++
    if(point.leadingScore>0 && point.playerScore*100>=point.leadingScore*60) competitiveQuarters++
  }
  let previous=new Set<string>(), current:string[]=[], repeated=0, decisions=0, largestQuarter=0
  const types=new Set<string>()
  for(const command of commandLog) {
    if(command.type==='end_quarter') {
      repeated+=current.filter(c=>previous.has(c)).length; decisions+=current.length
      largestQuarter=Math.max(largestQuarter,current.length); previous=new Set(current);current=[]
    } else {current.push(JSON.stringify(command));types.add(command.type)}
  }
  // Harness logs include proposed commands, some rejected by the validator.
  return {leadChanges,competitiveQuarters,quartersMeasured,proposedActions:decisions,repeatedProposals:repeated,
    proposalsPerQuarter:decisions/Math.max(1,state.turn),largestQuarter,actionTypes:types.size}
}
