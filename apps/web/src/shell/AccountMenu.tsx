import { Link } from '@tanstack/react-router'
import { KeyRound, LogOut, Settings } from 'lucide-react'
import { PersonAvatar } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn, focusRing } from '@/lib/utils'
import type { Account } from './types'
import { useConfirm } from './useConfirm'

/** The primitive owns coarse targets; only a fine desktop pointer gets compact rows. */
const ITEM = 'min-h-11 md:[@media(pointer:fine)]:min-h-8'

/**
 * The person's avatar and, under it, who they are signed in as, their show's settings, the access
 * tokens and Sign out. Sign out asks in the page, never through the browser's `confirm`.
 */
export function AccountMenu({
  account,
  showId,
  side = 'right',
  className,
}: {
  account: Account
  /** Adds the show's Settings when inside one. */
  showId?: string
  /** Which side of the avatar the menu opens on: right from the rail, below from the top bar. */
  side?: 'right' | 'bottom'
  className?: string
}) {
  const { confirm, dialog } = useConfirm('Sign out of Binder?', 'Sign out')
  const who = account.name || account.email
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Account menu"
            className={cn(
              'flex size-11 items-center justify-center rounded-full',
              focusRing,
              className,
            )}
          >
            {/* 32 px on a phone, the mockup's 26 px from 768 up; the button around it stays 44 px. */}
            <PersonAvatar name={who} className="size-8 md:size-[26px]" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side={side} align="end" className="min-w-56">
          <DropdownMenuLabel className="font-mono text-[12px] font-normal text-muted">
            {account.email}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {showId && (
            <DropdownMenuItem asChild className={ITEM}>
              <Link to="/shows/$showId/settings" params={{ showId }}>
                <Settings className="size-4" aria-hidden />
                Settings
              </Link>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem asChild className={ITEM}>
            <Link to="/settings/tokens">
              <KeyRound className="size-4" aria-hidden />
              Personal access tokens
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem className={ITEM} onSelect={() => void account.signOut(confirm)}>
            <LogOut className="size-4" aria-hidden />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {dialog}
    </>
  )
}
