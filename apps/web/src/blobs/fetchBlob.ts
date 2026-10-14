const CACHE_NAME = 'blobs-v1'

/** The URL the API serves a blob key at. */
export function blobUrl(key: string): string {
  return `/blobs/${key.split('/').map(encodeURIComponent).join('/')}`
}

async function openCache(): Promise<Cache | null> {
  try {
    return (await globalThis.caches?.open(CACHE_NAME)) ?? null
  } catch {
    // Private windows and insecure contexts refuse the Cache API; the network still works.
    return null
  }
}

/**
 * Cache-first fetch for blobs. Blob keys embed the version id, so the bytes behind a URL never
 * change and a cached copy never goes stale. Only 200 responses are cached.
 */
export async function fetchBlob(url: string): Promise<Response> {
  const cache = await openCache()
  if (cache) {
    try {
      const hit = await cache.match(url)
      if (hit) return hit
    } catch {
      // Fall through to the network.
    }
  }
  const res = await fetch(url, { credentials: 'include' })
  if (cache && res.status === 200) {
    // Not awaited: the caller reads the body while the copy is stored. A full disk only costs a refetch.
    void (async () => {
      try {
        await cache.put(url, res.clone())
      } catch {}
    })()
  }
  return res
}

/** Removes every cached blob, so the next user of this browser cannot read the last user's files. */
export async function clearBlobCache(): Promise<void> {
  try {
    await globalThis.caches?.delete(CACHE_NAME)
  } catch {
    // No Cache API, so nothing was cached.
  }
}
