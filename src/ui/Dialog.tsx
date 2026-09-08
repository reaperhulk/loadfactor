import { useEffect, useRef, type ReactNode } from 'react'

const FOCUSABLE = 'button, input, select, textarea, summary, a[href], [tabindex]'
const INTERACTIVE = 'button, input, select, textarea, summary, a[href], [role=button], [contenteditable=true]'
function focusable(node: HTMLElement) {
  return [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(el =>
    el.tabIndex >= 0 && !el.matches(':disabled') && !el.closest('[inert]') && el.getClientRects().length > 0,
  )
}

export function Dialog({ children, label, className, onClose, testId }: { children: ReactNode; label: string; className: string; onClose: () => void; testId?: string }) {
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const node = root.current!
    // Exclude the covered workspace from keyboard and screen-reader navigation.
    // Walk ancestors too, so this works for dialogs inside retained pages.
    const covered: { node: HTMLElement; inert: boolean }[] = []
    for (let branch: HTMLElement = node; branch.parentElement; branch = branch.parentElement) {
      for (const sibling of branch.parentElement.children) {
        if (sibling !== branch && sibling instanceof HTMLElement) {
          covered.push({ node:sibling, inert:sibling.inert }); sibling.inert = true
        }
      }
    }
    const initial = node.querySelector<HTMLElement>('[data-dialog-initial-focus]') ?? focusable(node)[0] ?? node
    initial.focus({preventScroll:true})
    return () => {
      for (const item of covered) item.node.inert = item.inert
      if (previous?.isConnected && !previous.closest('[inert]')) previous.focus({preventScroll:true})
    }
  }, [])
  return <div ref={root} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} className={className} data-testid={testId} onClick={(e) => { if (e.target === e.currentTarget) onClose() }} onKeyDown={(e) => {
    if (e.key === ' ' && !(e.target as HTMLElement).closest(INTERACTIVE) && testId === 'report-card') { e.preventDefault(); onClose(); return }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return }
    if (e.key !== 'Tab') return
    const nodes = focusable(root.current!), first = nodes[0], last = nodes.at(-1)
    if (!first) { e.preventDefault(); root.current?.focus(); return }
    // The report headline intentionally starts with tabindex=-1. Its first
    // Shift+Tab must stay in the dialog instead of escaping into the workspace.
    if (!nodes.includes(document.activeElement as HTMLElement)) { e.preventDefault(); (e.shiftKey ? last : first)?.focus() }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }}>{children}</div>
}
