export type IconName =
  | 'balance'
  | 'duel'
  | 'globe'
  | 'lens'
  | 'mute'
  | 'play'
  | 'reset'
  | 'rivals'
  | 'share'
  | 'sun'
  | 'undo'
  | 'volume'
  | 'zoomIn'
  | 'zoomOut'

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    focusable: false,
    className: 'icon',
  }

  switch (name) {
    case 'zoomIn':
    case 'zoomOut':
      return (
        <svg {...common}>
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="m15.5 15.5 5 5M7.5 10.5h6" />
          {name === 'zoomIn' && <path d="M10.5 7.5v6" />}
        </svg>
      )
    case 'reset':
      return (
        <svg {...common}>
          <path d="M8 3H3v5M3.8 7.5A9 9 0 1 1 4 17" />
        </svg>
      )
    case 'globe':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3c2.6 2.5 4 5.5 4 9s-1.4 6.5-4 9c-2.6-2.5-4-5.5-4-9s1.4-6.5 4-9Z" />
        </svg>
      )
    case 'rivals':
    case 'duel':
      return (
        <svg {...common}>
          <path d="m4 4 16 16M20 4 4 20M6 3 3 6l4 1M18 3l3 3-4 1M6 21l-3-3 4-1M18 21l3-3-4-1" />
        </svg>
      )
    case 'lens':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" stroke="none" opacity=".55" />
        </svg>
      )
    case 'sun':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3.5" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      )
    case 'volume':
    case 'mute':
      return (
        <svg {...common}>
          <path d="M4 9h4l5-4v14l-5-4H4Z" />
          {name === 'volume' ? (
            <path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8 8 0 0 1 0 12" />
          ) : (
            <path d="m17 9 5 5M22 9l-5 5" />
          )}
        </svg>
      )
    case 'undo':
      return (
        <svg {...common}>
          <path d="M9 7 4 12l5 5M5 12h8a6 6 0 0 1 6 6" />
        </svg>
      )
    case 'share':
      return (
        <svg {...common}>
          <circle cx="18" cy="5" r="2.5" />
          <circle cx="6" cy="12" r="2.5" />
          <circle cx="18" cy="19" r="2.5" />
          <path d="m8.2 10.8 7.6-4.5M8.2 13.2l7.6 4.5" />
        </svg>
      )
    case 'balance':
      return (
        <svg {...common}>
          <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
          <circle cx="16" cy="7" r="2" />
          <circle cx="8" cy="17" r="2" />
        </svg>
      )
    case 'play':
      return (
        <svg {...common}>
          <path d="m8 5 11 7-11 7Z" fill="currentColor" />
        </svg>
      )
  }
}
