import type { ReactNode } from 'react'
import { BackIcon } from '@/components/icons'
import { SyncStatus } from '@/components/SyncStatus'
import { cn, focusRing } from '@/lib/utils'
import { PaletteButton } from '../palette/CommandPalette'
import { AccountMenu } from './AccountMenu'
import { NavLink } from './NavLink'
import type { Account, Crumb } from './types'

/**
 * The top bar. Desktop and tablet (44 px): breadcrumbs on the left, then sync state, the secondary
 * actions and the one red primary on the right. Phone (56 px): a back chevron to the parent crumb
 * (with its name when it is a tab or the shows list), the current crumb as the title, sync, the one
 * primary and the avatar menu. A tab-level screen (Shows, Cues, Documents, Activity, More) has no
 * back button, 16 px of left padding and a bigger title (`phoneTab`: 20 px for Shows, 22 for the rest).
 */
export function TopBar({
  crumbs,
  phone,
  showId,
  account,
  actions,
  primary,
  slotRefs,
  phoneTab,
  phoneTitleSize,
}: {
  crumbs: Crumb[]
  phone: boolean
  /** The phone title size of a tab-level screen; absent on a drill-in. */
  phoneTab?: 20 | 22
  /** A smaller phone title for a drill-in whose title is a long name (the show's own page: 16). */
  phoneTitleSize?: 16
  showId?: string
  account: Account
  actions?: ReactNode
  primary?: ReactNode
  /** Where a screen's own top bar controls are drawn (see TopBarSlots). Not at phone. */
  slotRefs?: {
    chip: (el: HTMLElement | null) => void
    actions: (el: HTMLElement | null) => void
    phone: (el: HTMLElement | null) => void
  }
}) {
  if (phone) {
    const title = crumbs.at(-1)
    const parent = crumbs.at(-2)
    return (
      <header
        className={cn(
          'group/bar flex h-14 shrink-0 items-center gap-1.5 border-b border-line bg-paper pr-2.5',
          phoneTab || !parent?.link ? 'pl-4' : 'pl-1',
        )}
      >
        {!phoneTab && parent?.link && (
          <NavLink
            link={parent.link}
            active={false}
            label={parent.label}
            className={cn(
              'flex h-11 min-w-11 shrink-0 items-center py-0 pr-1.5 pl-0.5 text-[15px] font-semibold text-ink-2',
              focusRing,
            )}
          >
            <BackIcon className="size-6" />
            {parent.backLabel && <span aria-hidden>{parent.label}</span>}
          </NavLink>
        )}
        <span
          className={cn(
            'min-w-0 flex-1 truncate font-display font-extrabold leading-[1.1] tracking-[-.02em] text-ink',
            phoneTab === 22
              ? 'text-[22px]'
              : phoneTab === 20
                ? 'text-[20px]'
                : phoneTitleSize === 16
                  ? 'text-[16px]'
                  : 'text-[19px]',
          )}
        >
          {title?.phoneLabel ?? title?.label}
        </span>
        {/* A screen can draw its own controls here (the script: page position and menu, see
            TopBarSlots); while it has put something in, the sync state, primary and avatar make
            way for it. A screen that has not (its loading, empty or error states) keeps them. */}
        {/* No ⌘K on a touch screen: inside a show the palette opens from here. */}
        {showId && <PaletteButton />}
        <div ref={slotRefs?.phone} data-phone-slot className="contents" />
        <div className="flex items-center gap-1.5 group-has-[[data-phone-slot]:not(:empty)]/bar:hidden">
          <SyncStatus />
          {primary}
          <AccountMenu account={account} showId={showId} side="bottom" />
        </div>
      </header>
    )
  }

  const shown = crumbs.filter((c) => !c.phoneOnly)
  return (
    <header className="flex h-11 shrink-0 items-center gap-3.5 border-b border-line bg-paper px-3.5">
      <nav aria-label="Breadcrumb" className="min-w-0">
        <ol className="flex items-center gap-1.5 text-[13px]">
          {shown.map((crumb, i) => {
            const last = i === shown.length - 1
            return (
              // By position: a document can share its show's title, and the trail never reorders.
              // biome-ignore lint/suspicious/noArrayIndexKey: labels can repeat
              <li key={i} className="flex min-w-0 items-center gap-1.5">
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
                      last ? 'font-semibold text-ink' : 'text-muted',
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
      <div ref={slotRefs?.chip} className="contents" />
      <div className="ml-auto flex items-center gap-3">
        <SyncStatus />
        {actions}
        {/* A screen's own controls (see TopBarSlots) sit after the shell's, before the primary. */}
        <div ref={slotRefs?.actions} className="contents" />
        {primary}
      </div>
    </header>
  )
}
