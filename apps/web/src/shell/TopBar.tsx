import { ChevronLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { SyncStatus } from '@/components/SyncStatus'
import { cn, focusRing } from '@/lib/utils'
import { AccountMenu } from './AccountMenu'
import { NavLink } from './NavLink'
import type { Account, Crumb } from './types'

/**
 * The top bar. Desktop and tablet (44 px): breadcrumbs on the left, then sync state, the secondary
 * actions and the one red primary on the right. Phone (56 px): a back chevron to the parent crumb,
 * the current crumb as the title, sync, the one primary and the avatar menu.
 */
export function TopBar({
  crumbs,
  phone,
  showId,
  account,
  actions,
  primary,
}: {
  crumbs: Crumb[]
  phone: boolean
  showId?: string
  account: Account
  actions?: ReactNode
  primary?: ReactNode
}) {
  if (phone) {
    const title = crumbs.at(-1)
    const parent = crumbs.at(-2)
    return (
      <header className="flex h-14 shrink-0 items-center gap-1 border-b border-line bg-paper pr-1 pl-1">
        {parent?.link ? (
          <NavLink
            link={parent.link}
            active={false}
            label={parent.label}
            className={cn(
              'flex size-11 shrink-0 items-center justify-center text-ink-2',
              focusRing,
            )}
          >
            <ChevronLeft className="size-6" strokeWidth={1.8} aria-hidden />
          </NavLink>
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate font-display text-[18px] font-extrabold text-ink">
          {title?.label}
        </span>
        <SyncStatus />
        {primary}
        <AccountMenu account={account} showId={showId} side="bottom" />
      </header>
    )
  }

  const shown = crumbs.filter((c) => !c.phoneOnly)
  return (
    <header className="flex h-11 shrink-0 items-center gap-3 border-b border-line bg-paper px-4">
      <nav aria-label="Breadcrumb" className="min-w-0">
        <ol className="flex items-center gap-1.5 text-[13px]">
          {shown.map((crumb, i) => {
            const last = i === shown.length - 1
            return (
              <li key={crumb.label} className="flex min-w-0 items-center gap-1.5">
                {i > 0 && (
                  <span aria-hidden className="text-faint">
                    /
                  </span>
                )}
                {crumb.link && !last ? (
                  <NavLink
                    link={crumb.link}
                    active={false}
                    className={cn(
                      'max-w-[28ch] truncate rounded-sm text-muted hover:text-ink',
                      focusRing,
                    )}
                  >
                    {crumb.label}
                  </NavLink>
                ) : (
                  <span
                    aria-current={last ? 'page' : undefined}
                    className={cn(
                      'max-w-[40ch] truncate',
                      last ? 'font-bold text-ink' : 'text-muted',
                    )}
                  >
                    {crumb.label}
                  </span>
                )}
              </li>
            )
          })}
        </ol>
      </nav>
      <div className="ml-auto flex items-center gap-3">
        <SyncStatus />
        {actions}
        {primary}
      </div>
    </header>
  )
}
