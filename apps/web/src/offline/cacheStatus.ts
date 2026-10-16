import { useEffect, useState, useSyncExternalStore } from 'react'
import { isBlobCached } from '../blobs/fetchBlob'

/**
 * Which blobs are stored on this device. The Cache API cannot be watched, so whoever stores blobs
 * (the "Make available offline" button) says so with `blobCacheChanged()` and readers look again.
 */
let epoch = 0
const listeners = new Set<() => void>()

export function blobCacheChanged(): void {
  epoch++
  for (const l of listeners) l()
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** A number that changes whenever the stored blobs may have. */
export function useBlobCacheEpoch(): number {
  return useSyncExternalStore(subscribe, () => epoch)
}

/** Which of these blob URLs (`blobUrl(key)`) are stored for offline use: a Set of the ones that are. */
export function useCachedUrls(urls: readonly string[]): ReadonlySet<string> {
  const version = useBlobCacheEpoch()
  const [cached, setCached] = useState<ReadonlySet<string>>(new Set())
  // A string signature, so a new array with the same URLs does not look again.
  const signature = urls.join('\u0000')
  // biome-ignore lint/correctness/useExhaustiveDependencies: signature stands for urls
  useEffect(() => {
    let live = true
    void Promise.all(urls.map(async (u) => ((await isBlobCached(u)) ? u : null))).then((hits) => {
      if (live) setCached(new Set(hits.filter((u): u is string => u !== null)))
    })
    return () => {
      live = false
    }
  }, [signature, version])
  return cached
}
