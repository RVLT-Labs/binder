import { blobUrl, storeBlob } from '../blobs/fetchBlob'
import type { DocumentVersionRow, PageRow } from '../powersync/schema'

export interface ShowBlobRows {
  versions: readonly Pick<DocumentVersionRow, 'id' | 'status' | 'searchable_key'>[]
  pages: readonly Pick<PageRow, 'document_version_id' | 'thumb_key' | 'words_key'>[]
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
 * Everything the viewer and search read from a show's ready versions, in the order a reader needs
 * it: each version's searchable PDF, then its pages' thumbnails and word layers. Versions still
 * processing or failed have nothing worth storing yet.
 */
export function blobUrlsForShow({ versions, pages }: ShowBlobRows): string[] {
  const urls = new Set<string>()
  for (const version of versions) {
    if (version.status !== 'ready') continue
    if (version.searchable_key) urls.add(blobUrl(version.searchable_key))
    for (const page of pages) {
      if (page.document_version_id !== version.id) continue
      if (page.thumb_key) urls.add(blobUrl(page.thumb_key))
      if (page.words_key) urls.add(blobUrl(page.words_key))
    }
  }
  return [...urls]
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

  const versions = await db.getAll<ShowBlobRows['versions'][number]>(
    'SELECT id, status, searchable_key FROM document_versions WHERE show_id = ?',
    [showId],
  )
  const pages = await db.getAll<ShowBlobRows['pages'][number]>(
    'SELECT document_version_id, thumb_key, words_key FROM pages WHERE show_id = ? ORDER BY document_version_id, "index"',
    [showId],
  )
  const urls = blobUrlsForShow({ versions, pages })

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
