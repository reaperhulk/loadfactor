// One sortable-column header for every comparison table: identical look and
// toggle semantics, one implementation instead of a per-table copy (the
// routes and fleet tables had drifted into two).

import type { ReactElement } from 'react'

export function sortHeaderFactory<K extends string>(opts: {
  current: K
  asc: boolean
  setKey: (k: K) => void
  setAsc: (asc: boolean) => void
  defaultAscFor: (k: K) => boolean
  testPrefix: string
}): (key: K, label: string, title?: string) => ReactElement {
  return (key, label, title) => (
    <th title={title}>
      <button
        className={`link-btn sort-btn${opts.current === key ? ' active' : ''}`}
        data-testid={`${opts.testPrefix}${key}`}
        onClick={() => {
          if (opts.current === key) opts.setAsc(!opts.asc)
          else {
            opts.setKey(key)
            opts.setAsc(opts.defaultAscFor(key))
          }
        }}
      >
        {label}
        {opts.current === key ? (opts.asc ? ' ▲' : ' ▼') : ''}
      </button>
    </th>
  )
}
