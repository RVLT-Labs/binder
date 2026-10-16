import { useQuery } from '@powersync/react'
import { useMemo } from 'react'
import { useSessionUser } from '../auth/session'

/** Cues and annotations on a document's current version whose status is not `ok`; `d` is the document. */
const REVIEW_COUNT_EXPR = `(
    (SELECT COUNT(*) FROM cues c
      WHERE c.show_id = d.show_id
        AND json_extract(c.anchor, '$.documentVersionId') = d.current_version_id
        AND json_extract(c.anchor, '$.status') <> 'ok')
    +
    (SELECT COUNT(*) FROM annotations a
      WHERE a.show_id = d.show_id
        AND json_extract(a.anchor, '$.documentVersionId') = d.current_version_id
        AND json_extract(a.anchor, '$.status') <> 'ok'
        AND (a.layer_kind <> 'personal' OR a.layer_id = ?))
  )`

/**
 * Cues and annotations on the document's current version whose status is not `ok`, from the local
 * database. Another member's personal annotation never syncs here; the clause keeps it out of the
 * count if one ever did. Parameters: the user id, then the document id.
 */
export const REVIEW_COUNT_SQL = `
  SELECT ${REVIEW_COUNT_EXPR} AS n
  FROM documents d WHERE d.id = ? AND d.current_version_id IS NOT NULL`

/** The same count for every document of a show. Parameters: the user id, then the show id. */
export const REVIEW_COUNTS_SQL = `
  SELECT d.id AS document_id, ${REVIEW_COUNT_EXPR} AS n
  FROM documents d WHERE d.show_id = ? AND d.current_version_id IS NOT NULL`

/** How many items of the document's current version are waiting for review; live as statuses change. */
export function useReviewCount(documentId: string): number {
  const { data: user } = useSessionUser()
  const { data } = useQuery<{ n: number }>(REVIEW_COUNT_SQL, [user?.id ?? '', documentId])
  return data[0]?.n ?? 0
}

/** Items waiting for review per document of the show (documents with none are absent). */
export function useReviewCounts(showId: string): ReadonlyMap<string, number> {
  const { data: user } = useSessionUser()
  const { data } = useQuery<{ document_id: string; n: number }>(REVIEW_COUNTS_SQL, [
    user?.id ?? '',
    showId,
  ])
  return useMemo(
    () => new Map(data.filter((r) => r.n > 0).map((r) => [r.document_id, r.n])),
    [data],
  )
}
