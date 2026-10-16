import { createFileRoute, Link, type LinkOptions } from '@tanstack/react-router'
import { useId } from 'react'
import {
  ChevronRightIcon,
  ExportsIcon,
  type IconComponent,
  KeyIcon,
  PeopleIcon,
  SettingsIcon,
  ShowsIcon,
} from '@/components/icons'
import { PersonAvatar } from '@/components/ui/avatar'
import { cn, focusRing } from '@/lib/utils'
import { OfflineButton } from '../offline/OfflineButton'
import { useOfflineSummary } from '../offline/useOfflineSummary'
import { OfflineLine } from '../overview/OfflineCard'
import { useAccount } from '../shell/useAccount'
import { useConfirm } from '../shell/useConfirm'

export const Route = createFileRoute('/shows/$showId/more')({ component: MorePage })

// The mockup's `.card`: radius 14, a 2px outline, the card shadow.
const card = 'rounded-[var(--r)] border-2 border-line-2 bg-card shadow-card'

function Row({
  icon: Icon,
  label,
  link,
}: {
  icon: IconComponent
  label: string
  link: LinkOptions
}) {
  return (
    <li>
      <Link
        {...link}
        className={cn(
          'flex min-h-14 items-center gap-3 py-2 pr-2 pl-3.5 text-[15px] font-semibold text-ink',
          focusRing,
        )}
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] border-2 border-line-2 bg-paper-2 text-ink-2">
          <Icon className="size-[18px]" aria-hidden />
        </span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <ChevronRightIcon className="size-5 shrink-0 text-faint" aria-hidden />
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
  const offlineHeading = useId()
  const offline = useOfflineSummary(showId)
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-3">
      <h1 className="sr-only">More</h1>
      <ul
        aria-label="More destinations"
        className={cn(card, 'm-0 list-none divide-y divide-line p-0')}
      >
        <Row
          icon={ExportsIcon}
          label="Exports"
          link={{ to: '/shows/$showId/exports', params: { showId } }}
        />
        <Row
          icon={SettingsIcon}
          label="Settings"
          link={{ to: '/shows/$showId/settings', params: { showId } }}
        />
        <Row
          icon={PeopleIcon}
          label="Members"
          link={{ to: '/shows/$showId/settings', params: { showId }, hash: 'members' }}
        />
        <Row icon={KeyIcon} label="Personal access tokens" link={{ to: '/settings/tokens' }} />
        <Row icon={ShowsIcon} label="Shows" link={{ to: '/' }} />
      </ul>
      <section aria-labelledby={offlineHeading} className={cn(card, 'flex flex-col gap-3 p-3.5')}>
        <div className="flex flex-col gap-[3px]">
          <h2 id={offlineHeading} className="t-over">
            Offline
          </h2>
          {offline && (
            <p className="m-0 text-[13px] leading-[1.5] text-muted">
              <OfflineLine summary={offline} />
            </p>
          )}
        </div>
        <div className="flex min-h-11 items-center border-t border-line pt-2.5">
          <OfflineButton showId={showId} />
        </div>
      </section>
      <section aria-label="Account" className={cn(card, 'flex items-center gap-3 px-3.5 py-3')}>
        <PersonAvatar name={who} className="size-9" />
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
            'inline-flex min-h-11 items-center rounded-sm text-[14px] font-semibold text-ink-2 underline decoration-line-2 underline-offset-[3px]',
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
