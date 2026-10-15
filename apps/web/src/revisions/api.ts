import type { Anchor, ReanchorReview } from '@binder/shared'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { ApiError, api } from '../api/client'
import { pushNotice } from '../components/noticeStore'
import { useOnline } from '../offline/useOnline'

export type ReviewTable = 'cues' | 'annotations'
export type ReviewAction = 'accept' | 'revert' | 'reanchor'

/** Every review query of a document hangs under this key, so one invalidation refreshes it. */
export const reviewKey = (documentId: string) => ['review', documentId] as const

/**
 * The document's re-anchoring review (a server view, since the "before" positions live in the change
 * log). Only while online and `enabled`; `refreshOn` changes (the local count moving) refetch it, so
 * another member accepting an item shows here without a reload.
 */
export function useReview(documentId: string, enabled: boolean, refreshOn: number) {
  const online = useOnline()
  return useQuery<ReanchorReview>({
    queryKey: [...reviewKey(documentId), refreshOn],
    enabled: online && enabled,
    queryFn: () => api.get<ReanchorReview>(`/documents/${encodeURIComponent(documentId)}/review`),
    staleTime: 0,
    // The panel keeps showing the last list while a changed count fetches the next.
    placeholderData: keepPreviousData,
  })
}

/** Why the server refused a review action, in words for a notice. */
export function reviewErrorMessage(action: ReviewAction, err: unknown): string {
  const verb = action === 'accept' ? 'accept' : action === 'revert' ? 'revert' : 're-anchor'
  if (err instanceof ApiError) {
    if (err.code === 'forbidden') return `You can't ${verb} this item: ${err.message}`
    if (err.code === 'not_found') return `That item can't be changed: ${err.message}`
    return `Could not ${verb} this item: ${err.message}`
  }
  return `Could not ${verb} this item: ${err instanceof Error ? err.message : String(err)}`
}

/** Accept, revert or re-anchor one review item. A refusal becomes a notice naming the server's reason. */
export function useResolveItem(documentId: string) {
  const queryClient = useQueryClient()
  return useMutation<
    { anchor: Anchor },
    Error,
    { table: ReviewTable; rowId: string; action: ReviewAction }
  >({
    mutationFn: (input) =>
      api.post<{ anchor: Anchor }>(`/documents/${encodeURIComponent(documentId)}/review`, input),
    onError: (err, input) =>
      pushNotice({ kind: 'error', message: reviewErrorMessage(input.action, err) }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: reviewKey(documentId) }),
  })
}

export interface VersionAnchors {
  /** `<table>:<rowId>` to the anchor the row had on the version. */
  anchors: ReadonlyMap<string, Anchor> | null
  /** True while the server's answer is on its way. */
  loading: boolean
}

/**
 * Where each cue and annotation was on a version that is not current (`GET /versions/:id/anchors`).
 * Offline, or if the server cannot answer, `anchors` is null and the caller draws local rows only.
 */
export function useVersionAnchors(versionId: string, enabled: boolean): VersionAnchors {
  const online = useOnline()
  const { data, isLoading } = useQuery({
    queryKey: ['version-anchors', versionId],
    enabled: online && enabled,
    queryFn: () =>
      api.get<{ anchors: Array<{ table: ReviewTable; rowId: string; anchor: Anchor }> }>(
        `/versions/${encodeURIComponent(versionId)}/anchors`,
      ),
    // A version's anchors change when rows are revised or edited; a short life keeps it honest.
    staleTime: 10_000,
  })
  const anchors = useMemo(
    () =>
      data ? new Map(data.anchors.map((a) => [`${a.table}:${a.rowId}`, a.anchor] as const)) : null,
    [data],
  )
  return { anchors, loading: online && enabled && isLoading }
}
