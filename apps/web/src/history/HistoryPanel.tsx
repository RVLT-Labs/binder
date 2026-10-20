import { actorLabel } from '@binder/core'
import type { HistoryEntry } from '@binder/shared'
import { useQuery, useStatus } from '@powersync/react'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useId, useMemo, useRef } from 'react'
import { PersonAvatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { useMarkupSession } from '../markup/MarkupSession'
import { type DepartmentRow, useDepartments } from '../markup/useDepartments'
import { useOnline } from '../offline/useOnline'
import { historyKey, useRowHistory } from './api'
import { type ChangeContext, formatChange } from './formatChange'
import { NeedsConnection } from './NeedsConnection'
import { formatWhen } from './time'
import { useRevertAction } from './useRevertAction'

export interface HistoryPanelProps {
  showId: string
  table: 'cues' | 'annotations'
  rowId: string
  /** Changes whenever the row does (its `updated_at`): the open list refreshes behind it. */
  rowStamp: string | null
  /** Why the user may not revert changes to this row now, or null when they may. */
  whyCantRevert: string | null
  /** The cue's number now, to fill what a log row leaves out (it holds only changed columns). */
  currentNumber?: { major: number; minor: number }
  /** The row's own department: the fallback for entries that name no department layer. */
  departmentId: string | null
  /** Show only the latest this many changes and no "Show older changes" (the cue list's Cue tab). */
  limit?: number
}

/**
 * The panel's History tab for one row: its change log with who changed what and when, and "Revert
 * this change" on each entry (the mockup's `.hist-row`). Offline it says history needs a connection.
 */
export function HistoryPanel(props: HistoryPanelProps) {
  const online = useOnline()
  return (
    <section className="history flex flex-col" aria-label="History">
      {online ? <HistoryList {...props} /> : <NeedsConnection />}
    </section>
  )
}

/** The cue's history, with the rights check of the markup session. */
export function CueHistory({ cueId }: { cueId: string }) {
  const session = useMarkupSession()
  const { data } = useQuery<{
    department_id: string | null
    major: number
    minor: number
    updated_at: string | null
  }>('SELECT department_id, major, minor, updated_at FROM cues WHERE id = ?', [cueId])
  const row = data[0]
  if (!row) return null
  return (
    <HistoryPanel
      showId={session.showId}
      table="cues"
      rowId={cueId}
      rowStamp={row.updated_at}
      whyCantRevert={session.whyCantEdit(row)}
      currentNumber={{ major: row.major, minor: row.minor }}
      departmentId={row.department_id}
    />
  )
}

/** The annotation's history, with the rights check of the markup session. */
export function AnnotationHistory({ annotationId }: { annotationId: string }) {
  const session = useMarkupSession()
  const { data } = useQuery<{
    layer_kind: string | null
    layer_id: string | null
    updated_at: string | null
  }>('SELECT layer_kind, layer_id, updated_at FROM annotations WHERE id = ?', [annotationId])
  const row = data[0]
  if (!row) return null
  return (
    <HistoryPanel
      showId={session.showId}
      table="annotations"
      rowId={annotationId}
      rowStamp={row.updated_at}
      whyCantRevert={session.whyCantEditAnnotation(row)}
      departmentId={row.layer_kind === 'department' ? row.layer_id : null}
    />
  )
}

/**
 * Each entry's number as it stood after that change. A log row holds only the columns that changed,
 * so walking back from the cue's number now recovers a major that a minor-only edit did not carry.
 */
function numbersAfter(
  entries: HistoryEntry[],
  now: { major: number; minor: number } | undefined,
): Array<{ major: number; minor: number } | undefined> {
  const out: Array<{ major: number; minor: number } | undefined> = []
  let state = now
  for (const e of entries) {
    out.push(state)
    const before = e.before
    if (state && before) {
      state = {
        major: typeof before.major === 'number' ? before.major : state.major,
        minor: typeof before.minor === 'number' ? before.minor : state.minor,
      }
    }
  }
  return out
}

function HistoryList({
  showId,
  table,
  rowId,
  rowStamp,
  whyCantRevert,
  currentNumber,
  departmentId,
  limit,
}: HistoryPanelProps) {
  const query = useRowHistory(showId, rowId)
  const departments = useDepartments(showId)
  const { revert, pending, dialog } = useRevertAction(showId)
  const reasonId = useId()

  // Refresh when the row changes or an upload finishes: the server's log is written on upload.
  const queryClient = useQueryClient()
  const uploading = useStatus().dataFlowStatus?.uploading ?? false
  const seen = useRef({ rowStamp, uploading })
  useEffect(() => {
    if (seen.current.rowStamp === rowStamp && seen.current.uploading === uploading) return
    seen.current = { rowStamp, uploading }
    void queryClient.invalidateQueries({ queryKey: [...historyKey(showId), 'row', rowId] })
  }, [rowStamp, uploading, queryClient, showId, rowId])

  const entries = useMemo(() => {
    const all = query.data?.pages.flatMap((p) => p.entries) ?? []
    return limit === undefined ? all : all.slice(0, limit)
  }, [query.data, limit])
  const numbers = useMemo(
    () => (table === 'cues' ? numbersAfter(entries, currentNumber) : []),
    [table, entries, currentNumber],
  )
  const departmentOf = (entry: HistoryEntry): DepartmentRow | undefined =>
    departments.find((d) => entry.layer === `department:${d.id}`) ??
    departments.find((d) => d.id === departmentId)

  function contextFor(entry: HistoryEntry, index: number): ChangeContext {
    const department = departmentOf(entry)
    return {
      departmentCode: department?.code ?? null,
      numberFormat: department?.number_format === 'point' ? 'point' : 'decimal',
      numberAfter: numbers[index],
      layerName: (kind, id) =>
        kind === 'department' ? (departments.find((d) => d.id === id)?.code ?? null) : null,
    }
  }

  if (query.isPending) return <p className="m-0 text-[12.5px] text-muted">Loading history…</p>
  if (query.isError) {
    return (
      <p role="alert" className="m-0 text-[12.5px] text-t-out">
        Could not load history.{' '}
        <button
          type="button"
          className="font-semibold underline"
          onClick={() => void query.refetch()}
        >
          Try again
        </button>
      </p>
    )
  }
  if (entries.length === 0) {
    return <p className="m-0 text-[12.5px] text-muted">No changes recorded yet.</p>
  }

  return (
    <>
      {whyCantRevert && (
        <p id={reasonId} className="m-0 mb-2 text-[12.5px] text-muted">
          {whyCantRevert}
        </p>
      )}
      <ol className="history-list m-0 grid list-none gap-0 p-0" aria-label="Changes">
        {entries.map((entry, index) => {
          const actor = actorLabel(entry.userName, entry.agent)
          return (
            <li
              key={entry.seq}
              className="history-entry grid grid-cols-[22px_1fr_auto] items-start gap-2 border-t border-line py-2 text-[12.5px] first:border-t-0"
              data-seq={entry.seq}
            >
              <PersonAvatar
                name={entry.userName ?? 'Binder'}
                className="size-[22px] text-[9px] [&>span]:text-[9px]"
              />
              <div className="min-w-0">
                <p className="history-meta m-0">
                  <strong className="font-semibold text-ink">{actor}</strong>{' '}
                  <span className="history-lines text-ink-2">
                    {formatChange(entry, contextFor(entry, index)).join('; ')}
                  </span>
                </p>
                <button
                  type="button"
                  className="mt-0.5 rounded-[6px] text-[11.5px] font-medium text-blue hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red disabled:cursor-not-allowed disabled:opacity-45 disabled:no-underline max-md:min-h-11"
                  disabled={whyCantRevert !== null || pending}
                  aria-describedby={whyCantRevert ? reasonId : undefined}
                  onClick={() => revert({ seq: entry.seq })}
                >
                  Revert this change
                </button>
              </div>
              <time
                dateTime={entry.serverTs}
                className="font-mono text-[11px] text-muted tabular-nums"
              >
                {formatWhen(entry.serverTs)}
              </time>
            </li>
          )
        })}
      </ol>
      {query.hasNextPage && limit === undefined && (
        <Button
          type="button"
          variant="line"
          size="sm"
          className="mt-2 self-start"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          Show older changes
        </Button>
      )}
      {dialog}
    </>
  )
}
