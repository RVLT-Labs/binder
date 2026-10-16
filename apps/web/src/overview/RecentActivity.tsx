import type { ActivityGroup } from '@binder/shared'
import { Link } from '@tanstack/react-router'
import { useId } from 'react'
import { SectionHeading } from '@/components/SectionHeading'
import { PersonAvatar } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import { cn, focusRing } from '@/lib/utils'
import { useActivity } from '../history/api'
import { NeedsConnection } from '../history/NeedsConnection'
import { formatClock } from '../history/time'
import { useOnline } from '../offline/useOnline'

/** How many of the newest changes the overview shows. */
const LATEST = 3

/** "Jayden via Claude Code" as the person and, for an agent, what they used. */
function split(label: string): { who: string; via: string | null } {
  const at = label.indexOf(' via ')
  return at < 0 ? { who: label, via: null } : { who: label.slice(0, at), via: label.slice(at + 5) }
}

/** One change group: avatar, who (and through what) did what, and when, in mono. */
export function ActivityLine({ group }: { group: ActivityGroup }) {
  const { who, via } = split(group.label)
  return (
    <li className="flex items-center gap-3 py-3 text-[14px]">
      <PersonAvatar name={who} className="size-8" />
      <span className="min-w-0 flex-1 text-ink-2">
        <span className="font-semibold text-ink">{who}</span>
        {via && (
          <>
            {' '}
            via <span className="text-purple">{via}</span>
          </>
        )}{' '}
        {group.summary}
      </span>
      <time dateTime={group.at} className="shrink-0 font-mono text-[13px] tabular-nums text-faint">
        {formatClock(group.at)}
      </time>
    </li>
  )
}

/**
 * The newest few changes in the show (DESIGN §8 ActivityRow), from the activity feed. History is a
 * server view, so offline there is the same "needs a connection" line the rest of history shows.
 */
export function RecentActivity({ showId, className }: { showId: string; className?: string }) {
  const heading = useId()
  const online = useOnline()
  const query = useActivity(showId, { kind: 'all' })
  const groups = (query.data?.pages.flatMap((p) => p.groups) ?? []).slice(0, LATEST)
  return (
    <section aria-labelledby={heading} className={cn('flex flex-col', className)}>
      <SectionHeading id={heading}>Recent activity</SectionHeading>
      {!online ? (
        <div className="py-3">
          <NeedsConnection />
        </div>
      ) : query.isPending ? (
        <div className="flex flex-col gap-3 py-3" aria-hidden>
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : query.isError ? (
        <p role="alert" className="m-0 py-3 text-[13px] text-muted">
          Could not load activity.
        </p>
      ) : groups.length === 0 ? (
        <p className="m-0 py-3 text-[13px] text-muted">Nothing has changed yet.</p>
      ) : (
        <>
          <ul className="m-0 list-none divide-y divide-line p-0">
            {groups.map((g) => (
              <ActivityLine key={g.toSeq} group={g} />
            ))}
          </ul>
          <Link
            to="/shows/$showId/activity"
            params={{ showId }}
            className={cn(
              'self-start rounded-sm py-2 text-[13px] font-semibold text-ink-2 underline underline-offset-4',
              focusRing,
            )}
          >
            All activity
          </Link>
        </>
      )}
    </section>
  )
}
