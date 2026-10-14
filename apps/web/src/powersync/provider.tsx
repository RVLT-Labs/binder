import { PowerSyncContext } from '@powersync/react'
import type { PowerSyncDatabase } from '@powersync/web'
import { type ReactNode, useEffect, useState } from 'react'
import { forgetSessionUser } from '../auth/session'
import { clearBlobCache } from '../blobs/fetchBlob'
import { ApiConnector } from './connector'
import { createPowerSync } from './db'
import { claimLocalDb, writeOwner } from './ownership'

let shared: PowerSyncDatabase | undefined
/** One database per page: it owns a worker and an OPFS file lock. */
export function getPowerSync(): PowerSyncDatabase {
  shared ??= createPowerSync()
  return shared
}

/**
 * Provides the local database to the signed-in user's screens and connects it. Nothing renders
 * until the database is claimed for this user, so a previous user's rows are never shown.
 */
export function PowerSyncProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [db] = useState(getPowerSync)
  const [claimedFor, setClaimedFor] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      await claimLocalDb(db, userId, clearBlobCache)
      if (cancelled) return
      setClaimedFor(userId)
      await db.connect(new ApiConnector())
    })()
    return () => {
      cancelled = true
    }
  }, [db, userId])

  if (claimedFor !== userId) return null
  return <PowerSyncContext.Provider value={db}>{children}</PowerSyncContext.Provider>
}

/** After sign-out: stop syncing and delete every local row, queued upload, cached blob, and the remembered user. */
export async function clearLocalData(): Promise<void> {
  await Promise.all([getPowerSync().disconnectAndClear(), clearBlobCache()])
  writeOwner(null)
  forgetSessionUser()
}
