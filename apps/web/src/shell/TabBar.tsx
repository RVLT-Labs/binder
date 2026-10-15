import { Ellipsis } from 'lucide-react'
import { cn, focusRing } from '@/lib/utils'
import { NavLink } from './NavLink'
import { activeNavKey, navItems } from './navItems'

/**
 * The phone's bottom bar inside a show (DESIGN §6.4): five tabs, 56 px plus the home-indicator
 * inset. The current tab is red, the rest `muted`. Exports lives under More.
 */
export function TabBar({ showId, pathname }: { showId: string; pathname: string }) {
  const current = activeNavKey(pathname)
  const tabs = navItems(showId).filter((i) => i.key !== 'exports')
  const tab = (active: boolean) =>
    cn(
      'flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold leading-none',
      active ? 'text-red' : 'text-muted',
      focusRing,
    )
  return (
    <nav
      aria-label="Show"
      className="flex h-[calc(56px+env(safe-area-inset-bottom))] shrink-0 items-stretch border-t border-line bg-paper-2 pb-[env(safe-area-inset-bottom)]"
    >
      {tabs.map((item) => {
        const Icon = item.icon
        const active = current === item.key
        return (
          <NavLink
            key={item.key}
            link={{ to: item.to, params: item.params }}
            active={active}
            className={tab(active)}
          >
            <Icon className="size-[22px]" strokeWidth={1.8} aria-hidden />
            <span>{item.label}</span>
          </NavLink>
        )
      })}
      <NavLink
        link={{ to: '/shows/$showId/more', params: { showId } }}
        active={current === 'more'}
        className={tab(current === 'more')}
      >
        <Ellipsis className="size-[22px]" strokeWidth={1.8} aria-hidden />
        <span>More</span>
      </NavLink>
    </nav>
  )
}
