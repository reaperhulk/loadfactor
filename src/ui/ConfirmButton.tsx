// Two-step button for destructive actions: the first click arms it (label
// flips to the confirm text), the second within the window fires. Arming
// decays on its own — no modal, no way to destroy something with one slip.

import { useEffect, useRef, useState } from 'react'

export function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  className,
  ...rest
}: {
  label: string
  confirmLabel: string
  onConfirm: () => void
  className?: string
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'className' | 'children'>) {
  const [armed, setArmed] = useState(false)
  const timer = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current)
    },
    [],
  )
  return (
    <button
      {...rest}
      className={`${className ?? ''}${armed ? ' confirm-armed' : ''}`}
      onClick={() => {
        if (armed) {
          setArmed(false)
          if (timer.current !== null) clearTimeout(timer.current)
          onConfirm()
          return
        }
        setArmed(true)
        timer.current = window.setTimeout(() => setArmed(false), 3000)
      }}
    >
      {armed ? confirmLabel : label}
    </button>
  )
}
