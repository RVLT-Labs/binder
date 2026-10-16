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

/** Whether the blob is already stored on this device, so it can be read with no network. */
export async function isBlobCached(url: string): Promise<boolean> {
  const cache = await openCache()
  if (!cache) return false
  try {
    return (await cache.match(url)) !== undefined
  } catch {
    return false
  }
}

/**
 * Makes sure a blob is in the cache that fetchBlob reads, downloading it if it is not. Unlike
 * fetchBlob it waits for the copy to be stored and throws when it cannot be, so the caller knows
 * the blob really is available offline. Resolves to what it did.
 */
export async function storeBlob(url: string): Promise<'cached' | 'fetched'> {
  const cache = await openCache()
  if (!cache) throw new Error('this browser cannot store files for offline use')
  try {
    if (await cache.match(url)) return 'cached'
  } catch {
    // Treated as a miss; the put below decides whether storing works.
  }
  const res = await fetch(url, { credentials: 'include' })
  if (res.status !== 200) {
    void res.body?.cancel()
    throw new Error(`the server answered ${res.status}`)
  }
  await cache.put(url, res)
  return 'fetched'
}

/** The path (`/blobs/...`) of every blob stored on this device, from one `cache.keys()` call. */
export async function cachedBlobPaths(): Promise<Set<string>> {
  const cache = await openCache()
  if (!cache) return new Set()
  const paths = new Set<string>()
  for (const req of await cache.keys()) paths.add(new URL(req.url, 'http://localhost').pathname)
  return paths
}

/** Stores a response under `url` in the blob cache; throws when it cannot (no Cache API, full disk). */
export async function putBlobResponse(url: string, res: Response): Promise<void> {
  const cache = await openCache()
  if (!cache) throw new Error('this browser cannot store files for offline use')
  await cache.put(url, res)
}

/** Deletes every cached blob whose path starts with `pathPrefix` (e.g. one show's documents). */
export async function deleteCachedBlobs(pathPrefix: string): Promise<number> {
  const cache = await openCache()
  if (!cache) return 0
  let deleted = 0
  for (const req of await cache.keys()) {
    if (new URL(req.url, 'http://localhost').pathname.startsWith(pathPrefix)) {
      if (await cache.delete(req)) deleted++
    }
  }
  return deleted
}

/** Removes every cached blob, so the next user of this browser cannot read the last user's files. */
export async function clearBlobCache(): Promise<void> {
  try {
    await globalThis.caches?.delete(CACHE_NAME)
  } catch {
    // No Cache API, so nothing was cached.
  }
}
