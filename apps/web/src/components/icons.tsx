import type { SVGProps } from 'react'

/**
 * Binder's icon set: the mockups' own paths (docs/superpowers/design/binder-ui-2026-10/_parts.py
 * `ICON` and `screens2_mobile.py` `MBI`), 1.8 stroke, round caps, drawn on a 24 px grid. They take
 * the same props lucide's do (`className` for the size, `strokeWidth`), so a call site swaps one for
 * the other. Decorative unless the caller gives an `aria-label`.
 */
export type IconProps = SVGProps<SVGSVGElement>
export type IconComponent = ((props: IconProps) => React.JSX.Element) & { displayName?: string }

function icon(name: string, children: React.ReactNode): IconComponent {
  const Icon: IconComponent = ({ strokeWidth = 1.8, ...props }) => (
    // biome-ignore lint/a11y/noSvgWithoutTitle: decorative (aria-hidden) unless the caller names it
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      {children}
    </svg>
  )
  Icon.displayName = `Icon(${name})`
  return Icon
}

// destinations
export const ScriptIcon = icon(
  'script',
  <>
    <path d="M6 3h9l4 4v14H6z" />
    <path d="M14 3v5h5" />
    <path d="M9 12h7M9 16h7" />
  </>,
)
export const CuesIcon = icon(
  'cues',
  <>
    <path d="M4 7h16M4 12h10M4 17h13" />
    <circle cx="19" cy="16.5" r="2.5" />
  </>,
)
export const DocsIcon = icon(
  'docs',
  <>
    <rect x="4" y="4" width="16" height="16" rx="2" />
    <path d="M8 9h8M8 13h8M8 17h5" />
  </>,
)
export const ActivityIcon = icon('activity', <path d="M3 12h4l3-7 4 14 3-7h4" />)
export const ExportsIcon = icon(
  'exports',
  <>
    <path d="M12 4v11M7 10l5 5 5-5" />
    <path d="M4 19h16" />
  </>,
)
export const ShowsIcon = icon(
  'shows',
  <>
    <path d="M4 5h16v3H4zM5 8v10h14V8" />
    <path d="M9 8v10M15 8v10" />
  </>,
)
// Three dots: filled, so they read as dots rather than the tiny rings a stroked r=1.6 circle draws.
export const MoreIcon = icon(
  'more',
  <g fill="currentColor">
    <circle cx="6" cy="12" r="1.6" />
    <circle cx="12" cy="12" r="1.6" />
    <circle cx="18" cy="12" r="1.6" />
  </g>,
)

// tools (the script screen's strip)
export const SelectIcon = icon('select', <path d="M5 4l14 7-6 2-2 6z" />)
export const CueTagIcon = icon(
  'cue',
  <>
    <rect x="3" y="8" width="12" height="8" rx="2" />
    <path d="M15 12h6" />
  </>,
)
export const NoteIcon = icon('note', <path d="M4 5h16v11H9l-5 4z" />)
export const RectIcon = icon('rect', <rect x="4" y="5" width="16" height="14" rx="1.5" />)
export const ArrowIcon = icon('arrow', <path d="M5 19L19 5M11 5h8v8" />)
export const StampIcon = icon(
  'stamp',
  <>
    <path d="M8 11V7a4 4 0 018 0v4" />
    <path d="M4 11h16v4H4z" />
    <path d="M6 15v4h12v-4" />
  </>,
)
export const HighlightIcon = icon(
  'hilite',
  <>
    <path d="M4 20h16" />
    <path d="M7 16l9-9 2 2-9 9H7z" />
  </>,
)
export const EyeIcon = icon(
  'eye',
  <>
    <path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </>,
)
export const EyeOffIcon = icon(
  'eye-off',
  <path d="M3 3l18 18M10 6a10 10 0 0111 6 11 11 0 01-3 3.5M6.5 7.5A11 11 0 002 12s4 6 10 6a9 9 0 003-.5" />,
)
export const LockIcon = icon(
  'lock',
  <>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V8a4 4 0 018 0v3" />
  </>,
)
export const UnlockIcon = icon(
  'unlock',
  <>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V8a4 4 0 017-2.6" />
  </>,
)
export const SearchIcon = icon(
  'search',
  <>
    <circle cx="11" cy="11" r="6" />
    <path d="M20 20l-4.5-4.5" />
  </>,
)
export const UndoIcon = icon(
  'undo',
  <>
    <path d="M9 14L4 9l5-5" />
    <path d="M4 9h11a5 5 0 010 10h-3" />
  </>,
)
export const RedoIcon = icon(
  'redo',
  <>
    <path d="M15 14l5-5-5-5" />
    <path d="M20 9H9a5 5 0 000 10h3" />
  </>,
)
export const PrintIcon = icon(
  'print',
  <>
    <path d="M7 8V3h10v5" />
    <rect x="4" y="8" width="16" height="9" rx="2" />
    <path d="M7 14h10v7H7z" />
  </>,
)
export const WifiOffIcon = icon(
  'wifi-off',
  <>
    <path d="M3 3l18 18" />
    <path d="M8.5 16.5a5 5 0 017 0M5 13a10 10 0 016-3M2 9.5a15 15 0 015.5-3.2M12 20h.01M16.5 13a10 10 0 00-2-1.5M22 9.5A15 15 0 0012 6" />
  </>,
)

// phone and list chrome
export const BackIcon = icon('back', <path d="M15 5l-7 7 7 7" />)
export const ChevronRightIcon = icon('chev', <path d="M9 5l7 7-7 7" />)
export const ChevronDownIcon = icon('down', <path d="M6 9l6 6 6-6" />)
export const CheckIcon = icon('check', <path d="M5 12.5l4.5 4.5L19 7.5" />)
export const PlusIcon = icon('plus', <path d="M12 5v14M5 12h14" />)
export const CopyIcon = icon(
  'copy',
  <>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V6a2 2 0 012-2h9" />
  </>,
)
export const CloseIcon = icon('x', <path d="M6 6l12 12M18 6L6 18" />)
export const SettingsIcon = icon(
  'gear',
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />
  </>,
)
export const PeopleIcon = icon(
  'people',
  <>
    <circle cx="9" cy="9" r="3" />
    <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
    <circle cx="17" cy="9.5" r="2.4" />
    <path d="M17 14.2c2.4 0 4 1.8 4 4.3" />
  </>,
)
export const KeyIcon = icon(
  'key',
  <>
    <circle cx="8" cy="15" r="4" />
    <path d="M11 12l9-9M16 7l3 3" />
  </>,
)
