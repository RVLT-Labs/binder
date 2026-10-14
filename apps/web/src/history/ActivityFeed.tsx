import type { ActivityGroup } from '@binder/shared'
import { useQuery } from '@powersync/react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useSessionUser } from '../auth/session'
import { ARCHIVED_HINT } from '../markup/MarkupSession'
import { useDepartments } from '../markup/useDepartments'
import { useMembership } from '../markup/useMembership'
import { useOnline } from '../offline/useOnline'
import type { ShowRow } from '../powersync/schema'
import { type KindFilter, targetOfGroup, useActivity } from './api'
import { NeedsConnection } from './NeedsConnection'
import { dayHeading, formatClock, localDay } from './time'
import { useRevertAction } from './useRevertAction'

const KIND_OPTIONS: Array<{ value: KindFilter; label: string }> = [
  { value: 'all', label: 'People and agents' },
  { value: 'human', label: 'People only' },
  { value: 'agent', label: 'Agents only' },
]

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
export function ActivityFeed({ showId }: { showId: string }) {
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
  const query = useActivity(showId, { layer: layer || undefined, kind })
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
    <section className="activity" aria-labelledby={`${ids}-heading`}>
      <h1 id={`${ids}-heading`}>Activity</h1>
      <div className="activity-filters">
        <label>
          Layer
          <select value={layer} onChange={(e) => setLayer(e.target.value)}>
            <option value="">All layers</option>
            {departments.map((d) => (
              <option key={d.id} value={`department:${d.id}`}>
                {d.code}
              </option>
            ))}
            {user && <option value={`personal:${user.id}`}>Personal</option>}
          </select>
        </label>
        <label>
          Changes by
          <select value={kind} onChange={(e) => setKind(e.target.value as KindFilter)}>
            {KIND_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {whyCantRevert && (
        <p id={reasonId} className="muted">
          {whyCantRevert}
        </p>
      )}
      {!online ? (
        <NeedsConnection />
      ) : query.isPending ? (
        <p className="muted">Loading activity…</p>
      ) : query.isError ? (
        <p role="alert" className="field-error">
          Could not load activity.{' '}
          <button type="button" onClick={() => void query.refetch()}>
            Try again
          </button>
        </p>
      ) : groups.length === 0 ? (
        <p className="muted">No changes match.</p>
      ) : (
        <>
          {days.map((day) => (
            <section key={day.key} aria-label={day.heading} className="activity-day">
              <h2>{day.heading}</h2>
              <ul className="activity-list">
                {day.groups.map((group) => (
                  <li key={group.toSeq} className="activity-row" data-seq={group.toSeq}>
                    <span id={`${ids}-${group.toSeq}`} className="activity-text">
                      {group.label} {group.summary},{' '}
                      <time dateTime={group.at}>{formatClock(group.at)}</time>
                    </span>
                    <button
                      type="button"
                      disabled={whyCantRevert !== null || pending}
                      aria-describedby={
                        whyCantRevert
                          ? `${reasonId} ${ids}-${group.toSeq}`
                          : `${ids}-${group.toSeq}`
                      }
                      onClick={() => revert(targetOfGroup(group))}
                    >
                      Revert
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <div ref={end} aria-hidden="true" className="activity-end" />
          {hasNextPage && (
            <button
              type="button"
              disabled={isFetchingNextPage}
              onClick={() => void fetchNextPage()}
            >
              Load more
            </button>
          )}
        </>
      )}
      {dialog}
    </section>
  )
}
