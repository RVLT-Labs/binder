import { useRouterState } from '@tanstack/react-router'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { Notices } from '@/components/Notices'
import { cn } from '@/lib/utils'
import { recallShow, rememberShow } from './lastShow'
import { activeNavKey } from './navItems'
import { Rail } from './Rail'
import { TabBar } from './TabBar'
import { TopBar } from './TopBar'
import { TopBarSlotsContext } from './TopBarSlots'
import type { Account, Crumb } from './types'
import { useBreakpoint } from './useBreakpoint'

export type { Account, ConfirmFn, Crumb } from './types'

/**
 * The frame around every signed-in screen (DESIGN §6): a rail with a top bar and the content at
 * desktop and tablet, a top bar, the content and a tab bar at phone. It owns the safe areas and
 * the notices.
 *
 * `fullBleed` gives the content a full-height area that does not scroll itself, for a screen that
 * lays out and scrolls its own panels (the document viewer). Otherwise the content scrolls.
 */
export function AppShell({
  showId,
  crumbs,
  account,
  actions,
  primary,
  fullBleed,
  children,
}: {
  /** Inside a show: adds the show's destinations (rail items, phone tabs). */
  showId?: string
  crumbs: Crumb[]
  account: Account
  /** Secondary actions in the top bar (not drawn at phone). */
  actions?: ReactNode
  /** The one red primary action of the view. */
  primary?: ReactNode
  fullBleed?: boolean
  children: ReactNode
}) {
  const breakpoint = useBreakpoint()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const phone = breakpoint === 'phone'
  const tabBar = phone && showId !== undefined
  const [chip, setChip] = useState<HTMLElement | null>(null)
  const [actionsEl, setActionsEl] = useState<HTMLElement | null>(null)
  const slots = useMemo(() => ({ chip, actions: actionsEl }), [chip, actionsEl])
  const slotRefs = useMemo(() => ({ chip: setChip, actions: setActionsEl }), [])

  // Outside a show the rail still points at the one last opened on this device.
  useEffect(() => {
    if (showId) rememberShow(account.email, showId)
  }, [showId, account.email])
  const [lastShow] = useState(() => (showId ? undefined : recallShow(account.email)))

  // Phone: which screens are tab-level (no back button, a bigger title) and how big the title is.
  const navKey = showId ? activeNavKey(pathname) : null
  const phoneTab =
    pathname === '/'
      ? 20
      : navKey === 'cues' || navKey === 'docs' || navKey === 'activity' || navKey === 'more'
        ? 22
        : undefined

  return (
    <TopBarSlotsContext value={slots}>
      <div className="flex h-dvh w-full bg-paper text-ink">
        {!phone && (
          <Rail
            showId={showId}
            destinationsFor={showId ?? lastShow}
            iconsOnly={breakpoint === 'tablet'}
            pathname={pathname}
            account={account}
          />
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar
            crumbs={crumbs}
            phone={phone}
            showId={showId}
            account={account}
            actions={actions}
            primary={primary}
            slotRefs={slotRefs}
            phoneTab={phoneTab}
          />
          <main
            data-full-bleed={fullBleed ? 'true' : undefined}
            className={cn(
              'min-h-0 flex-1',
              fullBleed
                ? 'flex flex-col overflow-hidden'
                : 'overflow-y-auto px-4 py-3.5 md:px-8 md:py-7',
            )}
          >
            {children}
          </main>
          {tabBar && showId && <TabBar showId={showId} pathname={pathname} />}
        </div>
        <Notices aboveTabBar={tabBar} />
      </div>
    </TopBarSlotsContext>
  )
}
