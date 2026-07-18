// Number roll-up: header money values tick toward their new totals after a
// quarter resolves, making good quarters feel earned. Snaps in a single frame
// under prefers-reduced-motion.

import { useEffect, useRef, useState } from 'react'

const DURATION_MS = 650

export function useCountUp(target: number): number {
  const [shown, setShown] = useState(target)
  const shownRef = useRef(target) // last painted value, updated only in rAF

  useEffect(() => {
    const from = shownRef.current
    if (from === target) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const start = performance.now()
    let raf = 0
    const tick = (now: number): void => {
      const t = reduced ? 1 : Math.min(1, (now - start) / DURATION_MS)
      const eased = 1 - (1 - t) ** 3
      const value = Math.round(from + (target - from) * eased)
      shownRef.current = value
      setShown(value)
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target])

  return shown
}
