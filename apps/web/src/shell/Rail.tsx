import { BinderMark } from '@/brand/BinderMark'
import { ShowsIcon } from '@/components/icons'
import { cn, focusRing } from '@/lib/utils'
import { AccountMenu } from './AccountMenu'
import { NavLink } from './NavLink'
import { activeNavKey, type NavHue, navItems } from './navItems'
import type { Account } from './types'

/** The hue's soft fill and colour for the current item. Whole class names, so Tailwind sees them. */
const ACTIVE: Record<NavHue, string> = {
  blue: 'bg-blue-soft text-blue shadow-card',
  amber: 'bg-amber-soft text-amber shadow-card',
  teal: 'bg-teal-soft text-teal shadow-card',
  purple: 'bg-purple-soft text-purple shadow-card',
  green: 'bg-green-soft text-green shadow-card',
}

// The mockup's `.rail-item`: 44 x 44, radius 12, a 2 px top pad and a 2 px gap. (Its label is 10 px;
// 11 px is the floor.)
const ITEM = cn(
  'flex size-11 flex-col items-center justify-center gap-0.5 rounded-[12px] pt-0.5 text-[11px] font-semibold leading-none transition-colors',
  focusRing,
)

/**
 * The left rail (DESIGN §6.2): the mark, the show's destinations, then Shows and the account at the
 * foot. At tablet it is icons only (52 px); the labels stay as visually hidden text so each link
 * keeps its name. Outside a show the destinations point at the show last opened on this device
 * (`destinationsFor`), muted and none current; with no such show there are none.
 */
export function Rail({
  showId,
  destinationsFor = showId,
  iconsOnly,
  pathname,
  account,
}: {
  /** The show the page is in, if any. */
  showId?: string
  /** Whose destinations to draw: the current show, else the last one opened. */
  destinationsFor?: string
  iconsOnly: boolean
  pathname: string
  account: Account
}) {
  const current = showId ? activeNavKey(pathname) : null
  return (
    <nav
      aria-label="Binder"
      className={cn(
        'flex shrink-0 flex-col items-center gap-1 border-r border-line bg-paper-2 py-2.5',
        iconsOnly ? 'w-[52px]' : 'w-14',
      )}
    >
      <NavLink
        link={{ to: '/' }}
        active={false}
        label="Binder"
        // A 28 px mark with the mockup's 10 px below it; the link's hit area is 44 px tall (and stays
        // clear of the window's top-left corner, where tests and people click to mean "nowhere").
        className={cn(
          "relative mb-2.5 size-7 rounded-[8px] after:absolute after:-inset-x-1 after:-inset-y-2 after:content-['']",
          focusRing,
        )}
      >
        <BinderMark className="size-7 drop-shadow-[0_2px_0_var(--red-700)]" />
      </NavLink>
      {destinationsFor && (
        <div className="flex flex-col items-center gap-1">
          {navItems(destinationsFor).map((item) => {
            const Icon = item.icon
            const active = current === item.key
            return (
              <NavLink
                key={item.key}
                link={{ to: item.to, params: item.params }}
                active={active}
                title={iconsOnly ? item.label : undefined}
                className={cn(ITEM, active ? ACTIVE[item.hue] : 'text-muted hover:text-ink')}
              >
                <Icon className={iconsOnly ? 'size-5' : 'size-[18px]'} aria-hidden />
                <span className={iconsOnly ? 'sr-only' : undefined}>{item.label}</span>
              </NavLink>
            )
          })}
        </div>
      )}
      <div className="mt-auto flex flex-col items-center gap-1.5">
        <NavLink
          link={{ to: '/' }}
          active={pathname === '/'}
          title={iconsOnly ? 'Shows' : undefined}
          // Muted even when current: the mockup draws no current treatment for it.
          className={cn(ITEM, 'text-muted hover:text-ink')}
        >
          <ShowsIcon className={iconsOnly ? 'size-5' : 'size-[18px]'} aria-hidden />
          <span className={iconsOnly ? 'sr-only' : undefined}>Shows</span>
        </NavLink>
        <AccountMenu account={account} showId={showId} side="right" />
      </div>
    </nav>
  )
}
