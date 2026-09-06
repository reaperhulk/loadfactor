import { useEffect, useRef, type ReactNode } from 'react'
export function Dialog({ children, label, className, onClose, testId }: { children: ReactNode; label: string; className: string; onClose: () => void; testId?: string }) {
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const node = root.current
    const initial = node?.querySelector<HTMLElement>('[data-dialog-initial-focus]') ?? node?.querySelector<HTMLElement>('button:not(:disabled), input, select, textarea, [tabindex="0"]')
    initial?.focus()
    return () => { if (previous?.isConnected) previous.focus() }
  }, [])
  return <div ref={root} role="dialog" aria-modal="true" aria-label={label} className={className} data-testid={testId} onClick={(e) => { if (e.target === e.currentTarget) onClose() }} onKeyDown={(e) => {
    if (e.key === ' ' && (e.target as HTMLElement).tagName !== 'BUTTON' && testId === 'report-card') { e.preventDefault(); onClose(); return }
    if (e.key === 'Escape') { e.stopPropagation(); onClose() }
    if (e.key !== 'Tab') return
    const nodes = [...(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea, a[href], [tabindex="0"]') ?? [])].filter((n) => n.getClientRects().length > 0)
    const first = nodes[0], last = nodes.at(-1)
    if (!first) { e.preventDefault(); return }
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }}>{children}</div>
}
