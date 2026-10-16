import { useQuery } from '@powersync/react'
import { useMemo } from 'react'
import { blobUrl } from '../blobs/fetchBlob'
import { useCachedUrls } from '../offline/cacheStatus'
import { useReviewCounts } from '../revisions/useReviewCount'
import {
  buildDocumentEntries,
  type DocumentEntry,
  type DocumentSource,
  type PageProgress,
  type VersionSource,
} from './documentEntries'

const DOCUMENTS_SQL =
  'SELECT id, title, kind, current_version_id FROM documents WHERE show_id = ? ORDER BY sort_order, created_at, id'
const VERSIONS_SQL =
  'SELECT id, document_id, version_number, label, status, error, page_count, searchable_key FROM document_versions WHERE show_id = ?'
const PAGES_SQL = `
  SELECT document_version_id AS version_id, count(*) AS total,
         sum(CASE WHEN status = 'ready' THEN 1 ELSE 0 END) AS ready
  FROM pages WHERE show_id = ? GROUP BY document_version_id`
const THUMBS_SQL =
  'SELECT document_version_id AS version_id, thumb_key FROM pages WHERE show_id = ? AND "index" = 0 AND thumb_key IS NOT NULL'
const CUES_SQL = `
  SELECT json_extract(anchor, '$.documentVersionId') AS version_id, count(*) AS n
  FROM cues WHERE show_id = ? AND anchor IS NOT NULL GROUP BY 1`

export interface DocumentsData {
  loading: boolean
  entries: DocumentEntry[]
  /** First-page thumbnail blob key per version id. */
  thumbs: ReadonlyMap<string, string>
  /** Versions whose searchable PDF is stored on this device. */
  cachedVersions: ReadonlySet<string>
  /** Items to review per document id. */
  reviewCounts: ReadonlyMap<string, number>
}

/** A show's documents as the screens draw them, all from the local database and the blob cache. */
export function useDocumentEntries(showId: string): DocumentsData {
  const { data: documents, isLoading } = useQuery<DocumentSource>(DOCUMENTS_SQL, [showId])
  const { data: versions } = useQuery<VersionSource>(VERSIONS_SQL, [showId])
  const { data: pageRows } = useQuery<{ version_id: string; total: number; ready: number }>(
    PAGES_SQL,
    [showId],
  )
  const { data: thumbRows } = useQuery<{ version_id: string; thumb_key: string }>(THUMBS_SQL, [
    showId,
  ])
  const { data: cueRows } = useQuery<{ version_id: string | null; n: number }>(CUES_SQL, [showId])
  const reviewCounts = useReviewCounts(showId)

  const entries = useMemo(() => {
    const pages = new Map<string, PageProgress>(
      pageRows.map((r) => [r.version_id, { ready: Number(r.ready), total: Number(r.total) }]),
    )
    const cuesByVersion = new Map<string, number>(
      cueRows.filter((r) => r.version_id).map((r) => [r.version_id as string, Number(r.n)]),
    )
    return buildDocumentEntries(documents, versions, { pages, cuesByVersion })
  }, [documents, versions, pageRows, cueRows])

  const thumbs = useMemo(
    () => new Map(thumbRows.map((r) => [r.version_id, r.thumb_key])),
    [thumbRows],
  )

  // A version counts as cached when its searchable PDF is: that is what the viewer opens first.
  const pdfUrls = useMemo(
    () =>
      versions
        .filter((v) => v.status === 'ready' && v.searchable_key)
        .map((v) => [v.id, blobUrl(v.searchable_key as string)] as const),
    [versions],
  )
  const cachedUrls = useCachedUrls(useMemo(() => pdfUrls.map(([, url]) => url), [pdfUrls]))
  const cachedVersions = useMemo(
    () => new Set(pdfUrls.filter(([, url]) => cachedUrls.has(url)).map(([id]) => id)),
    [pdfUrls, cachedUrls],
  )

  return { loading: isLoading, entries, thumbs, cachedVersions, reviewCounts }
}
