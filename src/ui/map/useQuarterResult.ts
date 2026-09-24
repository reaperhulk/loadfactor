// The quarter's result, told on the map: notice a quarter resolving, wait
// for the report to close, then hold each route's profit trend for a moment.

import { useEffect, useMemo, useState } from 'react'
import type { Airline, GameState } from '../../engine'
import { QUARTER_RESULT_MS, quarterTrends } from './quarterResult'

export function useQuarterResult({
  state,
  player,
  active,
  announceQuarter,
}: {
  state: GameState
  player: Airline
  active: boolean
  announceQuarter: boolean
}) {
  // The quarter's result, on the map. A turn that advanced by one is noted
  // while rendering; the flash waits until the report (or any other modal)
  // has closed and the map is on screen, then holds for a few seconds.
  const [seenTurn, setSeenTurn] = useState(state.turn)
  const [pendingResult, setPendingResult] = useState<number | null>(null)
  const [shownResult, setShownResult] = useState<number | null>(null)
  if (state.turn !== seenTurn) {
    setSeenTurn(state.turn)
    setPendingResult(announceQuarter && state.turn === seenTurn + 1 ? state.turn : null)
    setShownResult(null)
  }
  useEffect(() => {
    if (pendingResult === null) return
    let timer = 0
    const poll = (): void => {
      if (active && !document.hidden && document.querySelector('dialog[open]') === null) {
        setPendingResult(null)
        setShownResult(pendingResult)
        return
      }
      timer = window.setTimeout(poll, 250)
    }
    timer = window.setTimeout(poll, 250)
    return () => clearTimeout(timer)
  }, [pendingResult, active])
  useEffect(() => {
    if (shownResult === null) return
    const timer = window.setTimeout(() => setShownResult(null), QUARTER_RESULT_MS)
    return () => clearTimeout(timer)
  }, [shownResult])
  const quarterResult = useMemo(
    () => (shownResult === null ? null : quarterTrends(player.routes, shownResult)),
    [shownResult, player],
  )
  return quarterResult
}
