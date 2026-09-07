import { useEffect, useId, useSyncExternalStore } from 'react'
import type { Command } from '../engine'

// UI-only drafts are deliberately absent from the engine and its saves. Keep
// the review honest when a mounted inspector/workbench holds unapplied edits.
const drafts = new Map<string, number>()
let commands: Command[] = []
const listeners = new Set<() => void>()
const notify = () => { for (const listener of listeners) listener() }
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
const count = () => commands.length + [...drafts.values()].reduce((sum, n) => sum+n, 0)
export function commandKey(command: Command): string {
  const entity = command.type === 'open_route' ? [command.from, command.to].sort().join('-') : 'routeId' in command ? command.routeId : 'aircraftId' in command ? command.aircraftId : 'city' in command ? command.city : ''
  return `${command.type}:${entity}`
}
export function mergePlanningCommands(current: readonly Command[], next: readonly Command[]): Command[] {
  const merged = new Map(current.map(c => [commandKey(c), c]))
  for (const c of next) if (c.type !== 'end_quarter') merged.set(commandKey(c), c)
  return [...merged.values()]
}
export const getPlanningCommands = () => commands
export function stagePlanningCommands(next: readonly Command[]) { commands = mergePlanningCommands(commands, next); notify() }
export function removePlanningCommand(key: string) { commands = commands.filter(c => commandKey(c) !== key); notify() }
export function clearPlanningDraft() { commands = []; notify() }
export function usePlanningCommands() { return useSyncExternalStore(subscribe, getPlanningCommands) }
export function usePlanningDraftNotice(changes: number) {
  const id = useId()
  useEffect(() => {
    drafts.set(id,changes); notify()
    return () => { drafts.delete(id); notify() }
  },[id,changes])
}
export function usePlanningDraftCount() { return useSyncExternalStore(subscribe,count) }
