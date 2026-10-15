import { Archive } from 'lucide-react'
import { BinderMark } from '@/brand/BinderMark'
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

const ITEM = cn(
  'flex flex-col items-center justify-center gap-0.5 rounded-[10px] text-[11px] font-semibold leading-none transition-colors',
  focusRing,
)

/**
 * The left rail (DESIGN §6.2): the mark, the show's destinations, then Shows and the account at the
 * foot. At tablet it is icons only (52 px); the labels stay as visually hidden text so each link
 * keeps its name. Outside a show there are no destinations, only the foot.
 */
export function Rail({
  showId,
  iconsOnly,
  pathname,
  account,
}: {
  showId?: string
  iconsOnly: boolean
  pathname: string
  account: Account
}) {
  const current = showId ? activeNavKey(pathname) : null
  return (
    <nav
      aria-label="Binder"
      className={cn(
        'flex shrink-0 flex-col items-center border-r border-line bg-paper-2 py-3',
        iconsOnly ? 'w-[52px]' : 'w-14',
      )}
    >
      <NavLink
        link={{ to: '/' }}
        active={false}
        label="Binder"
        className={cn('flex size-11 items-center justify-center rounded-[10px]', focusRing)}
      >
        <BinderMark className="size-7" />
      </NavLink>
      {showId && (
        <div className="mt-4 flex flex-col items-center gap-1">
          {navItems(showId).map((item) => {
            const Icon = item.icon
            const active = current === item.key
            return (
              <NavLink
                key={item.key}
                link={{ to: item.to, params: item.params }}
                active={active}
                title={iconsOnly ? item.label : undefined}
                className={cn(
                  ITEM,
                  iconsOnly ? 'size-11' : 'h-11 w-12',
                  active ? ACTIVE[item.hue] : 'text-muted hover:text-ink',
                )}
              >
                <Icon className="size-[18px]" strokeWidth={1.8} aria-hidden />
                <span className={iconsOnly ? 'sr-only' : undefined}>{item.label}</span>
              </NavLink>
            )
          })}
        </div>
      )}
      <div className="mt-auto flex flex-col items-center gap-1">
        <NavLink
          link={{ to: '/' }}
          active={pathname === '/'}
          title={iconsOnly ? 'Shows' : undefined}
          className={cn(
            ITEM,
            iconsOnly ? 'size-11' : 'h-11 w-12',
            pathname === '/' ? 'text-ink' : 'text-muted hover:text-ink',
          )}
        >
          <Archive className="size-[18px]" strokeWidth={1.8} aria-hidden />
          <span className={iconsOnly ? 'sr-only' : undefined}>Shows</span>
        </NavLink>
        <AccountMenu account={account} showId={showId} side="right" />
      </div>
    </nav>
  )
}
