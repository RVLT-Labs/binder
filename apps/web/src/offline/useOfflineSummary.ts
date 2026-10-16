import { usePowerSync, useQuery } from '@powersync/react'
import { useEffect, useRef, useState } from 'react'
import { isBlobCached } from '../blobs/fetchBlob'
import { useBlobCacheEpoch } from './cacheStatus'
import { blobUrlsForShow, loadShowBlobRows } from './prefetch'

export interface OfflineSummary {
  /** Files a full offline copy of the show holds. */
  total: number
  /** Of those, how many are stored on this device now. */
  cached: number
}

/** How long after the last change to wait before counting again. */
export const RESCAN_DELAY_MS = 500

/**
 * The counting trigger: how many of the show's versions are ready. `blobUrlsForShow` takes only
 * ready versions' files, so pages appearing on a version still processing change nothing.
 */
export const READY_VERSIONS_SQL =
  "SELECT count(*) AS k FROM document_versions WHERE show_id = ? AND status = 'ready'"

/**
 * How much of the show is on this device for offline use, counted against what "Make available
 * offline" would store. Null until counted. It counts again when the stored blobs may have changed
 * and when a version becomes ready, waiting for changes to settle (a scan checks every blob URL).
 */
export function useOfflineSummary(showId: string): OfflineSummary | null {
  const db = usePowerSync()
  const epoch = useBlobCacheEpoch()
  const { data } = useQuery<{ k: number }>(READY_VERSIONS_SQL, [showId])
  const ready = data[0]?.k ?? 0
  const [summary, setSummary] = useState<OfflineSummary | null>(null)
  const counted = useRef(false)

  // biome-ignore lint/correctness/useExhaustiveDependencies: epoch and ready say when to count again
  useEffect(() => {
    let live = true
    const scan = async () => {
      const urls = blobUrlsForShow(await loadShowBlobRows(db, showId))
      const hits = await Promise.all(urls.map((u) => isBlobCached(u)))
      if (live) {
        counted.current = true
        setSummary({ total: urls.length, cached: hits.filter(Boolean).length })
      }
    }
    // The first count is at once; later ones wait for a burst of changes to end.
    const timer = setTimeout(
      () => {
        scan().catch(() => {
          // Not countable (no Cache API, database closing): the card simply says nothing about it.
        })
      },
      counted.current ? RESCAN_DELAY_MS : 0,
    )
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [db, showId, epoch, ready])

  return summary
}
