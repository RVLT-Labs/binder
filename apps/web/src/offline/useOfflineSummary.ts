import { usePowerSync, useQuery } from '@powersync/react'
import { useEffect, useState } from 'react'
import { isBlobCached } from '../blobs/fetchBlob'
import { useBlobCacheEpoch } from './cacheStatus'
import { blobUrlsForShow, loadShowBlobRows } from './prefetch'

export interface OfflineSummary {
  /** Files a full offline copy of the show holds. */
  total: number
  /** Of those, how many are stored on this device now. */
  cached: number
}

/**
 * How much of the show is on this device for offline use, counted against what "Make available
 * offline" would store. Null until counted. It looks again when the stored blobs may have changed
 * and when the show's ready versions or pages do.
 */
export function useOfflineSummary(showId: string): OfflineSummary | null {
  const db = usePowerSync()
  const epoch = useBlobCacheEpoch()
  // Counts only, to know when to look again: new versions ready, new thumbnails made.
  const { data } = useQuery<{ k: number }>(
    `SELECT (SELECT count(*) FROM document_versions WHERE show_id = ? AND status = 'ready')
          + (SELECT count(*) FROM pages WHERE show_id = ? AND thumb_key IS NOT NULL) AS k`,
    [showId, showId],
  )
  const changes = data[0]?.k ?? 0
  const [summary, setSummary] = useState<OfflineSummary | null>(null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: epoch and changes say when to look again
  useEffect(() => {
    let live = true
    void (async () => {
      const urls = blobUrlsForShow(await loadShowBlobRows(db, showId))
      const hits = await Promise.all(urls.map((u) => isBlobCached(u)))
      if (live) setSummary({ total: urls.length, cached: hits.filter(Boolean).length })
    })().catch(() => {
      // Not countable (no Cache API, database closing): the card simply says nothing about it.
    })
    return () => {
      live = false
    }
  }, [db, showId, epoch, changes])

  return summary
}
