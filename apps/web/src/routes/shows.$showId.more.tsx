import { createFileRoute, Link, type LinkOptions } from '@tanstack/react-router'
import {
  Archive,
  ChevronRight,
  Download,
  KeyRound,
  type LucideIcon,
  Settings,
  Users,
} from 'lucide-react'
import { PersonAvatar } from '@/components/ui/avatar'
import { cn, focusRing } from '@/lib/utils'
import { OfflineButton } from '../offline/OfflineButton'
import { useAccount } from '../shell/useAccount'
import { useConfirm } from '../shell/useConfirm'

export const Route = createFileRoute('/shows/$showId/more')({ component: MorePage })

const card = 'rounded-[var(--r)] border-2 border-line-2 bg-card shadow-card'

function Row({ icon: Icon, label, link }: { icon: LucideIcon; label: string; link: LinkOptions }) {
  return (
    <li>
      <Link
        {...link}
        className={cn(
          'flex min-h-14 items-center gap-3 px-3 text-[15px] font-semibold text-ink',
          focusRing,
        )}
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] border-2 border-line-2 text-ink-2">
          <Icon className="size-[18px]" strokeWidth={1.8} aria-hidden />
        </span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <ChevronRight className="size-5 shrink-0 text-muted" aria-hidden />
      </Link>
    </li>
  )
}

/**
 * The phone's fifth tab (DESIGN §7): what has no tab of its own. Exports, Settings, Members, the
 * access tokens and the shows list, then the offline copy and the account.
 */
function MorePage() {
  const { showId } = Route.useParams()
  const account = useAccount()
  const { confirm, dialog } = useConfirm('Sign out of Binder?', 'Sign out')
  const who = account.name || account.email
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <h1 className="sr-only">More</h1>
      <ul
        aria-label="More destinations"
        className={cn(card, 'm-0 list-none divide-y divide-line p-0')}
      >
        <Row
          icon={Download}
          label="Exports"
          link={{ to: '/shows/$showId/exports', params: { showId } }}
        />
        <Row
          icon={Settings}
          label="Settings"
          link={{ to: '/shows/$showId/settings', params: { showId } }}
        />
        <Row
          icon={Users}
          label="Members"
          link={{ to: '/shows/$showId/settings', params: { showId }, hash: 'members' }}
        />
        <Row icon={KeyRound} label="Personal access tokens" link={{ to: '/settings/tokens' }} />
        <Row icon={Archive} label="Shows" link={{ to: '/' }} />
      </ul>
      <section aria-label="Offline" className={cn(card, 'p-4')}>
        <OfflineButton showId={showId} />
      </section>
      <section aria-label="Account" className={cn(card, 'flex items-center gap-3 p-3')}>
        <PersonAvatar name={who} className="size-10" />
        <div className="min-w-0 flex-1">
          <p className="m-0 truncate text-[15px] font-semibold text-ink">
            {account.name || 'Signed in'}
          </p>
          <p className="m-0 truncate font-mono text-[12px] text-muted">{account.email}</p>
        </div>
        <button
          type="button"
          onClick={() => void account.signOut(confirm)}
          className={cn(
            'min-h-11 rounded-full px-3 text-[14px] font-semibold text-ink underline underline-offset-4',
            focusRing,
          )}
        >
          Sign out
        </button>
      </section>
      {dialog}
    </div>
  )
}
