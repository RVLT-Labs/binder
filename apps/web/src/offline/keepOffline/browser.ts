import { cachedBlobPaths, deleteCachedBlobs, putBlobResponse } from '../../blobs/fetchBlob'
import { loadShowBlobRows, type ShowDb } from '../prefetch'
import type { RunnerDeps } from './runner'
import { dropOfflinePref } from './store'

interface NetworkInformationLike {
  saveData?: boolean
}

/** The real dependencies of the runner: the local database, the Cache API, the storage estimate, Web Locks. */
export function browserRunnerDeps(opts: {
  db: ShowDb
  userId: string
  onStored?: () => void
}): RunnerDeps {
  return {
    loadRows: (showId) => loadShowBlobRows(opts.db, showId),
    cachedUrls: cachedBlobPaths,
    fetchBlob: (url, signal) => fetch(url, { credentials: 'include', signal }),
    putBlob: putBlobResponse,
    deleteShowBlobs: (showId) =>
      deleteCachedBlobs(`/blobs/shows/${encodeURIComponent(showId)}/documents/`),
    dropPreference: (showId) => dropOfflinePref(opts.userId, showId),
    estimate: async () => navigator.storage?.estimate?.(),
    isOnline: () => navigator.onLine,
    saveData: () =>
      (navigator as Navigator & { connection?: NetworkInformationLike }).connection?.saveData ===
      true,
    locks: navigator.locks as RunnerDeps['locks'],
    onStored: opts.onStored,
  }
}
