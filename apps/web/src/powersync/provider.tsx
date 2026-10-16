import { PowerSyncContext } from '@powersync/react'
import type { PowerSyncDatabase } from '@powersync/web'
import { useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useEffect, useState } from 'react'
import { forgetSessionUser } from '../auth/session'
import { clearBlobCache } from '../blobs/fetchBlob'
import { clearOtherOutboxes } from '../exports/outbox'
import { clearOtherOfflinePrefs } from '../offline/keepOffline/store'
import { ApiConnector } from './connector'
import { createPowerSync } from './db'
import { installDevHooks } from './devHooks'
import { claimLocalDb, writeOwner } from './ownership'

let shared: PowerSyncDatabase | undefined
/** One database per page: it owns a worker and an OPFS file lock. */
export function getPowerSync(): PowerSyncDatabase {
  if (!shared) {
    shared = createPowerSync()
    installDevHooks(shared)
  }
  return shared
}

function messageOf(err: unknown): string {
  // DOMException is not an Error everywhere (jsdom, older WebKit), but always has a message.
  const message = (err as { message?: unknown } | null)?.message
  return typeof message === 'string' && message ? message : String(err)
}

/**
 * Provides the local database to the signed-in user's screens and connects it. Nothing renders
 * until the database is claimed for this user, so a previous user's rows are never shown. If the
 * browser cannot open local storage at all (no OPFS in a private window, a quota error, a worker that
 * fails to load), it says so instead of leaving a blank page.
 */
export function PowerSyncProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [opened] = useState<{ db: PowerSyncDatabase } | { error: string }>(() => {
    try {
      return { db: getPowerSync() }
    } catch (err) {
      return { error: messageOf(err) }
    }
  })
  const db = 'db' in opened ? opened.db : null
  const queryClient = useQueryClient()
  const [claimedFor, setClaimedFor] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => {
    if (!db) return
    let cancelled = false
    void (async () => {
      try {
        await claimLocalDb(db, userId, async () => {
          await clearBlobCache()
          // Exports another user left waiting to upload go too (see clearOtherOutboxes).
          await clearOtherOutboxes(userId)
          // And the previous user's keep-offline switches: the cache they drove was wiped above.
          await clearOtherOfflinePrefs(userId)
          // Cached history, review and version-anchor answers belong to the previous user.
          queryClient.clear()
        })
      } catch (err) {
        console.error('could not open the local database', err)
        if (!cancelled) setFailure(messageOf(err))
        return
      }
      if (cancelled) return
      setClaimedFor(userId)
      try {
        await db.connect(new ApiConnector())
      } catch (err) {
        // The app still works on local data; PowerSync reports sync trouble through its status.
        console.error('could not connect the sync service', err)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [db, userId, queryClient])

  const error = 'error' in opened ? opened.error : failure
  if (error !== null) {
    return (
      <main className="page">
        <p role="alert">
          This browser could not open Binder's local storage: {error}. Binder keeps shows on this
          device, so it needs a normal (not private) window with site storage allowed.
        </p>
      </main>
    )
  }
  if (!db || claimedFor !== userId) return null
  return <PowerSyncContext.Provider value={db}>{children}</PowerSyncContext.Provider>
}

/** After sign-out: stop syncing and delete every local row, queued upload, cached blob, and the remembered user. */
export async function clearLocalData(): Promise<void> {
  await Promise.all([getPowerSync().disconnectAndClear(), clearBlobCache()])
  writeOwner(null)
  forgetSessionUser()
}
