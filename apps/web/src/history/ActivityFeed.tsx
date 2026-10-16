import type { ActivityGroup } from '@binder/shared'
import { useQuery } from '@powersync/react'
import { Link } from '@tanstack/react-router'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useSessionUser } from '../auth/session'
import { ARCHIVED_HINT } from '../markup/MarkupSession'
import { useDepartments } from '../markup/useDepartments'
import { useMembership } from '../markup/useMembership'
import { useOnline } from '../offline/useOnline'
import type { ShowRow } from '../powersync/schema'
import { ActivityFilters } from './ActivityFilters'
import { ActivityRow } from './ActivityRow'
import { type KindFilter, useActivity } from './api'
import { NeedsConnection } from './NeedsConnection'
import { dayHeading, formatWhen, localDay } from './time'
import { useRevertAction } from './useRevertAction'

interface Day {
  key: string
  heading: string
  groups: ActivityGroup[]
}

function byDay(groups: ActivityGroup[]): Day[] {
  const days: Day[] = []
  for (const group of groups) {
    const key = localDay(group.at)
    const last = days[days.length - 1]
    if (last?.key === key) last.groups.push(group)
    else days.push({ key, heading: dayHeading(group.at), groups: [group] })
  }
  return days
}

/**
 * The show's activity: what each person or agent changed, a batch at a time, newest first, with a
 * "Revert" on each. Older changes load as the end of the list scrolls into view.
 */
export function ActivityFeed({ showId, from }: { showId: string; from?: string }) {
  const online = useOnline()
  const { data: user } = useSessionUser()
  const membership = useMembership(showId)
  const departments = useDepartments(showId)
  const { data: shows } = useQuery<Pick<ShowRow, 'status'>>(
    'SELECT status FROM shows WHERE id = ?',
    [showId],
  )
  const [layer, setLayer] = useState('')
  const [kind, setKind] = useState<KindFilter>('all')
  const query = useActivity(showId, { layer: layer || undefined, kind, from })
  const { revert, pending, dialog } = useRevertAction(showId)
  const ids = useId()
  const reasonId = `${ids}-reason`

  const groups = useMemo(() => query.data?.pages.flatMap((p) => p.groups) ?? [], [query.data])
  const days = useMemo(() => byDay(groups), [groups])

  // Viewers and an archived show cannot revert; for an editor the server decides by the row's layer.
  const whyCantRevert =
    shows[0]?.status === 'archived'
      ? ARCHIVED_HINT
      : membership?.role === 'viewer'
        ? "Viewers can't revert changes."
        : null

  // More groups load as the end of the list scrolls into view.
  const end = useRef<HTMLDivElement>(null)
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query
  useEffect(() => {
    const el = end.current
    if (!el || !hasNextPage || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((hits) => {
      if (hits.some((h) => h.isIntersecting) && !isFetchingNextPage) void fetchNextPage()
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  return (
    <section
      className="activity mr-auto flex w-full max-w-[916px] flex-col md:-mt-2.5"
      aria-labelledby={`${ids}-heading`}
    >
      <h1 id={`${ids}-heading`} className="sr-only">
        Activity
      </h1>
      {from && (
        <p className="m-0 mb-3 text-[13px] text-muted">
          Changes since {formatWhen(from)}.{' '}
          <Link
            to="/shows/$showId/activity"
            params={{ showId }}
            search={{}}
            className="font-semibold text-blue hover:underline"
          >
            Show all
          </Link>
        </p>
      )}
      {/* the filters (the mockup's `.filters`); on a phone they stay put under the title */}
      <div className="activity-filters z-[3] max-md:sticky max-md:-top-3.5 mb-2.5 flex flex-wrap items-center gap-2 max-md:-mx-4 max-md:-mt-3.5 max-md:mb-2 max-md:border-b max-md:border-line max-md:bg-paper max-md:px-4 max-md:pt-2.5 max-md:pb-2">
        <ActivityFilters
          departments={departments.map((d) => ({ id: d.id, code: d.code ?? '', colour: d.colour }))}
          userId={user?.id}
          layer={layer}
          kind={kind}
          onLayerChange={setLayer}
          onKindChange={setKind}
        />
        {days[0] && (
          <span
            aria-hidden
            className="text-[12px] text-muted md:ml-auto max-md:order-1 max-md:mr-auto"
          >
            {days[0].heading}
          </span>
        )}
      </div>
      {whyCantRevert && (
        <p id={reasonId} className="m-0 mb-2 text-[12.5px] text-muted">
          {whyCantRevert}
        </p>
      )}
      {!online ? (
        <NeedsConnection />
      ) : query.isPending ? (
        <p className="m-0 text-[13px] text-muted">Loading activity…</p>
      ) : query.isError ? (
        <p role="alert" className="m-0 text-[13px] text-t-out">
          Could not load activity.{' '}
          <button
            type="button"
            className="font-semibold underline max-md:min-h-11"
            onClick={() => void query.refetch()}
          >
            Try again
          </button>
        </p>
      ) : groups.length === 0 ? (
        <p className="m-0 text-[13px] text-muted">No changes match.</p>
      ) : (
        <>
          {days.map((day, i) => (
            <section key={day.key} aria-label={day.heading} className="activity-day">
              {/* the first day's heading is drawn in the filter row; later days get their own line */}
              <h2
                className={cn(
                  'm-0 text-[12px] font-normal text-muted',
                  i === 0 ? 'sr-only' : 'mt-5 mb-1 max-md:mt-4 max-md:mb-2',
                )}
              >
                {day.heading}
              </h2>
              <ul className="activity-list m-0 flex list-none flex-col p-0 max-md:gap-2 max-md:pt-2.5">
                {day.groups.map((group) => (
                  <ActivityRow
                    key={group.toSeq}
                    group={group}
                    textId={`${ids}-${group.toSeq}`}
                    disabled={whyCantRevert !== null || pending}
                    describedBy={
                      whyCantRevert ? `${reasonId} ${ids}-${group.toSeq}` : `${ids}-${group.toSeq}`
                    }
                    onRevert={revert}
                  />
                ))}
              </ul>
            </section>
          ))}
          <div ref={end} aria-hidden="true" className="activity-end h-px" />
          {hasNextPage && (
            <Button
              type="button"
              variant="line"
              className="mt-3 self-start"
              disabled={isFetchingNextPage}
              onClick={() => void fetchNextPage()}
            >
              Load more
            </Button>
          )}
          <p className="m-0 mt-4 rounded-[10px] border border-dashed border-line-2 px-3 py-2.5 text-[12.5px] text-muted max-md:rounded-[14px] max-md:border-2 max-md:border-solid max-md:border-line max-md:bg-paper-2 max-md:p-3.5">
            Personal layers never appear here.
            <span className="max-md:hidden">
              {' '}
              Your own personal notes show in your row history only.
            </span>
          </p>
        </>
      )}
      {dialog}
    </section>
  )
}
