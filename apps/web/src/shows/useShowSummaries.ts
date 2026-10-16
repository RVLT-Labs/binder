import { useQuery } from '@powersync/react'
import { useMemo } from 'react'
import { useSessionUser } from '../auth/session'
import { REVIEW_COUNT_EXPR } from '../revisions/useReviewCount'

export interface ShowSummary {
  /** The show's documents in order, each with its current version number. */
  documents: { title: string; version: number }[]
  /** Items waiting for review across those documents (cues and annotations not `ok`). */
  toReview: number
}

/**
 * One row per document that has a current version, with that version's number and the items
 * waiting for review on it. Parameter: the user id (the review count leaves out other people's
 * personal annotations).
 */
const SUMMARY_SQL = `
  SELECT d.show_id AS show_id, d.title AS title, v.version_number AS version,
         ${REVIEW_COUNT_EXPR} AS review
  FROM documents d JOIN document_versions v ON v.id = d.current_version_id
  ORDER BY d.show_id, d.sort_order, d.created_at, d.id`

/** What each show card says about its documents, from the local database (so it works offline). */
export function useShowSummaries(): ReadonlyMap<string, ShowSummary> {
  const { data: user } = useSessionUser()
  const { data } = useQuery<{
    show_id: string
    title: string | null
    version: number | null
    review: number
  }>(SUMMARY_SQL, [user?.id ?? ''])
  return useMemo(() => {
    const out = new Map<string, ShowSummary>()
    for (const row of data) {
      const summary = out.get(row.show_id) ?? { documents: [], toReview: 0 }
      summary.documents.push({ title: row.title ?? '', version: Number(row.version ?? 0) })
      summary.toReview += Number(row.review ?? 0)
      out.set(row.show_id, summary)
    }
    return out
  }, [data])
}

/**
 * The newest `updated_at` over a show's cues, annotations, documents and versions: when the show
 * last changed as far as this device knows. The show row's own `updated_at` only moves when the
 * show itself is edited, so this is the more truthful local answer.
 */
const LAST_ACTIVITY_SQL = `
  SELECT show_id, max(updated_at) AS at FROM (
    SELECT show_id, updated_at FROM cues
    UNION ALL SELECT show_id, updated_at FROM annotations
    UNION ALL SELECT show_id, updated_at FROM documents
    UNION ALL SELECT show_id, updated_at FROM document_versions
  ) GROUP BY show_id`

/** What the query is while nothing needs it: no tables, so nothing is watched and no write re-runs it. */
export const NO_ACTIVITY_SQL = 'SELECT NULL AS show_id, NULL AS at WHERE 0'

/**
 * Per show id, when it last changed on this device (the card's "Updated ..." fallback; works
 * offline). The scan reads four tables and re-runs on every write to any of them, so it runs only
 * while `needed`: that is, while the server's last-change answer is missing (offline, or not in yet).
 */
export function useLocalLastActivity(needed: boolean): ReadonlyMap<string, string> {
  const { data } = useQuery<{ show_id: string; at: string | null }>(
    needed ? LAST_ACTIVITY_SQL : NO_ACTIVITY_SQL,
  )
  return useMemo(() => {
    const out = new Map<string, string>()
    for (const row of data) if (row.at) out.set(row.show_id, row.at)
    return out
  }, [data])
}
