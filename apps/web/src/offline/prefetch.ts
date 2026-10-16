import { blobUrl, storeBlob } from '../blobs/fetchBlob'
import type { DocumentVersionRow, PageRow } from '../powersync/schema'

export interface ShowBlobRows {
  versions: readonly (Pick<DocumentVersionRow, 'id' | 'status' | 'searchable_key'> &
    Partial<Pick<DocumentVersionRow, 'document_id' | 'version_number'>>)[]
  pages: readonly Pick<PageRow, 'document_version_id' | 'thumb_key' | 'words_key'>[]
  /** Each document's current version, which is stored before its older ones. */
  documents?: readonly { id: string; current_version_id: string | null }[]
}

/** The part of the local database prefetching reads. */
export interface ShowDb {
  getAll<T>(sql: string, parameters?: unknown[]): Promise<T[]>
}

export interface PrefetchProgress {
  done: number
  total: number
}

export interface PrefetchResult {
  /** Blobs now stored for offline use, counting those that already were. */
  fetched: number
  /** URLs that could not be stored. */
  failed: string[]
}

/** How many blobs download at once: enough to hide latency, few enough to leave the API usable. */
const CONCURRENCY = 6

/**
 * The order a document's versions are stored in, so a dropped connection or a full disk leaves the
 * most useful ones cached: the current version, then the one before it, then the rest from newest
 * to oldest. Rows without version numbers keep their given order.
 */
function versionOrder<T extends { id: string; version_number?: number | null }>(
  versions: readonly T[],
  currentId: string | null | undefined,
): T[] {
  const newestFirst = [...versions].sort(
    (a, b) => (b.version_number ?? 0) - (a.version_number ?? 0),
  )
  const current = newestFirst.find((v) => v.id === currentId)
  const below = current
    ? newestFirst.find((v) => (v.version_number ?? 0) < (current.version_number ?? 0))
    : undefined
  return [
    ...(current ? [current] : []),
    ...(below ? [below] : []),
    ...newestFirst.filter((v) => v !== current && v !== below),
  ]
}

/**
 * Everything the viewer, search, review and compare read from a show's ready versions, document by
 * document: each version's searchable PDF, then its pages' thumbnails and word layers in page order.
 * Versions still processing or failed have nothing worth storing yet. Every URL appears once.
 */
export function blobUrlsForShow({ versions, pages, documents = [] }: ShowBlobRows): string[] {
  const urls = new Set<string>()
  const currentOf = new Map(documents.map((d) => [d.id, d.current_version_id]))
  const byDocument = new Map<string, (typeof versions)[number][]>()
  for (const version of versions) {
    if (version.status !== 'ready') continue
    const key = version.document_id ?? ''
    byDocument.set(key, [...(byDocument.get(key) ?? []), version])
  }
  for (const [documentId, group] of byDocument) {
    for (const version of versionOrder(group, currentOf.get(documentId))) {
      if (version.searchable_key) urls.add(blobUrl(version.searchable_key))
      for (const page of pages) {
        if (page.document_version_id !== version.id) continue
        if (page.thumb_key) urls.add(blobUrl(page.thumb_key))
        if (page.words_key) urls.add(blobUrl(page.words_key))
      }
    }
  }
  return [...urls]
}

/** The rows `blobUrlsForShow` needs, read from the local database. */
export async function loadShowBlobRows(
  db: ShowDb,
  showId: string,
): Promise<Required<ShowBlobRows>> {
  const versions = await db.getAll<ShowBlobRows['versions'][number]>(
    'SELECT id, document_id, version_number, status, searchable_key FROM document_versions WHERE show_id = ? ORDER BY document_id, version_number',
    [showId],
  )
  const documents = await db.getAll<NonNullable<ShowBlobRows['documents']>[number]>(
    'SELECT id, current_version_id FROM documents WHERE show_id = ? ORDER BY sort_order, created_at, id',
    [showId],
  )
  const pages = await db.getAll<ShowBlobRows['pages'][number]>(
    'SELECT document_version_id, thumb_key, words_key FROM pages WHERE show_id = ? ORDER BY document_version_id, "index"',
    [showId],
  )
  return { versions, documents, pages }
}

/**
 * Stores a show's ready documents for offline use: asks the browser to keep the storage, then
 * downloads every blob into the cache fetchBlob reads. One blob failing never stops the rest; the
 * failures come back as a list. `onProgress` is called with 0 done and again after each blob.
 */
export async function prefetchShow(
  db: ShowDb,
  showId: string,
  onProgress: (progress: PrefetchProgress) => void,
): Promise<PrefetchResult> {
  try {
    // Without this the browser may evict the cache under storage pressure. Denial is not fatal.
    await navigator.storage?.persist?.()
  } catch {}

  const urls = blobUrlsForShow(await loadShowBlobRows(db, showId))

  const failed: string[] = []
  let done = 0
  onProgress({ done, total: urls.length })
  let next = 0
  async function worker() {
    while (next < urls.length) {
      const url = urls[next++]
      try {
        await storeBlob(url)
      } catch {
        failed.push(url)
      }
      onProgress({ done: ++done, total: urls.length })
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, urls.length) }, worker))
  return { fetched: urls.length - failed.length, failed }
}
