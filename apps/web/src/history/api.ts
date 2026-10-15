import type { ActivityGroup, HistoryEntry, RevertResult } from '@binder/shared'
import {
  type InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import { ApiError, api } from '../api/client'
import { pushNotice } from '../components/noticeStore'
import { useOnline } from '../offline/useOnline'

export type KindFilter = 'human' | 'agent' | 'all'

export interface ActivityFilters {
  /** A layer key: `department:<id>` or `personal:<userId>`. Absent means every layer. */
  layer?: string
  kind?: KindFilter
  /** Only changes made at or after this ISO timestamp. */
  from?: string
}

export const PAGE_SIZE = 25

/** Every history query of a show hangs under this key, so one invalidation refreshes them all. */
export const historyKey = (showId: string) => ['history', showId] as const

interface HistoryPage {
  entries: HistoryEntry[]
  nextBefore: number | null
}
interface ActivityPage {
  groups: ActivityGroup[]
  nextBefore: number | null
}

function path(base: string, params: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') query.set(key, String(value))
  }
  const text = query.toString()
  return text ? `${base}?${text}` : base
}

/**
 * One row's change log, newest first, a page at a time. It runs only while the browser is online:
 * history is a server view and is unavailable offline (spec 4.12).
 */
export function useRowHistory(showId: string, rowId: string) {
  const online = useOnline()
  return useInfiniteQuery<
    HistoryPage,
    Error,
    InfiniteData<HistoryPage, number | null>,
    readonly unknown[],
    number | null
  >({
    queryKey: [...historyKey(showId), 'row', rowId],
    enabled: online,
    initialPageParam: null,
    queryFn: ({ pageParam }) =>
      api.get<HistoryPage>(
        path(`/shows/${encodeURIComponent(showId)}/history`, {
          rowId,
          limit: PAGE_SIZE,
          before: pageParam ?? undefined,
        }),
      ),
    getNextPageParam: (last) => last.nextBefore,
  })
}

/** The show's activity feed (grouped batches), newest first; more pages follow `nextBefore`. */
export function useActivity(showId: string, filters: ActivityFilters) {
  const online = useOnline()
  return useInfiniteQuery<
    ActivityPage,
    Error,
    InfiniteData<ActivityPage, number | null>,
    readonly unknown[],
    number | null
  >({
    queryKey: [
      ...historyKey(showId),
      'activity',
      filters.layer ?? '',
      filters.kind ?? 'all',
      filters.from ?? '',
    ],
    enabled: online,
    initialPageParam: null,
    queryFn: ({ pageParam }) =>
      api.get<ActivityPage>(
        path(`/shows/${encodeURIComponent(showId)}/activity`, {
          layer: filters.layer,
          // `all` is the route's default: leave it off so the URL stays short.
          kind: filters.kind === 'all' ? undefined : filters.kind,
          from: filters.from,
          limit: PAGE_SIZE,
          before: pageParam ?? undefined,
        }),
      ),
    getNextPageParam: (last) => last.nextBefore,
  })
}

/** What to revert: one change, or a whole batch by one user (an activity group). */
export type RevertTarget = { seq: number } | { batchId: string; userId: string }

/** The target of an activity group: its batch, or its one row when it has no batch. */
export function targetOfGroup(group: ActivityGroup): RevertTarget {
  return group.batchId === null
    ? { seq: group.toSeq }
    : { batchId: group.batchId, userId: group.userId }
}

export const CONFLICT_QUESTION = 'This has changed since. Revert anyway?'

/** Why a revert was refused, in words for a notice. */
export function revertErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'forbidden') return `You can't revert this change: ${err.message}`
    if (err.code === 'not_found') return `That change can't be reverted: ${err.message}`
    return `Could not revert: ${err.message}`
  }
  return `Could not revert: ${err instanceof Error ? err.message : String(err)}`
}

/**
 * Reverts a change or a batch. The server answers `conflict` when the row has changed since; then
 * `confirm(CONFLICT_QUESTION)` asks the user, and only a yes retries with `force: true`. Every other
 * refusal (`forbidden`, `not_found`, `invalid`) is a notice naming the reason and nothing else
 * happens. A success refreshes the show's history so the revert's own entry appears.
 */
export function useRevert(showId: string, confirm: (question: string) => Promise<boolean>) {
  const queryClient = useQueryClient()
  const url = `/shows/${encodeURIComponent(showId)}/revert`
  return useMutation<RevertResult | null, Error, RevertTarget>({
    mutationFn: async (target) => {
      try {
        return await api.post<RevertResult>(url, target)
      } catch (err) {
        if (!(err instanceof ApiError) || err.code !== 'conflict') throw err
        if (!(await confirm(CONFLICT_QUESTION))) return null
        return await api.post<RevertResult>(url, { ...target, force: true })
      }
    },
    onSuccess: (outcome) => {
      if (outcome && outcome.skipped.length > 0) {
        const n = outcome.skipped.length
        pushNotice({
          kind: 'info',
          message:
            outcome.reverted === 0
              ? 'Nothing to revert: it was already reverted, or the row is gone.'
              : `Reverted ${outcome.reverted}; skipped ${n} that ${n === 1 ? 'was' : 'were'} already reverted or gone.`,
        })
      }
    },
    onError: (err) => pushNotice({ kind: 'error', message: revertErrorMessage(err) }),
    // Whatever happened, what the server holds may differ from what is on screen.
    onSettled: () => queryClient.invalidateQueries({ queryKey: historyKey(showId) }),
  })
}
