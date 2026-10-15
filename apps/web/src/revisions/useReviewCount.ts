import { useQuery } from '@powersync/react'
import { useSessionUser } from '../auth/session'

/**
 * Cues and annotations on the document's current version whose status is not `ok`, from the local
 * database. Another member's personal annotation never syncs here; the clause keeps it out of the
 * count if one ever did. Parameters: the user id, then the document id.
 */
export const REVIEW_COUNT_SQL = `
  SELECT (
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
  ) AS n
  FROM documents d WHERE d.id = ? AND d.current_version_id IS NOT NULL`

/** How many items of the document's current version are waiting for review; live as statuses change. */
export function useReviewCount(documentId: string): number {
  const { data: user } = useSessionUser()
  const { data } = useQuery<{ n: number }>(REVIEW_COUNT_SQL, [user?.id ?? '', documentId])
  return data[0]?.n ?? 0
}
