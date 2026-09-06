import { useEffect, useId, useSyncExternalStore } from 'react'

// UI-only drafts are deliberately absent from the engine and its saves. Keep
// the review honest when a mounted inspector/workbench holds unapplied edits.
const drafts = new Map<string, number>()
const listeners = new Set<() => void>()
const notify = () => { for (const listener of listeners) listener() }
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
const count = () => [...drafts.values()].reduce((sum, n) => sum+n, 0)
export function usePlanningDraftNotice(changes: number) {
  const id = useId()
  useEffect(() => {
    drafts.set(id,changes); notify()
    return () => { drafts.delete(id); notify() }
  },[id,changes])
}
export function usePlanningDraftCount() { return useSyncExternalStore(subscribe,count) }
