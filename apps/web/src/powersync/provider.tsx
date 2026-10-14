import { PowerSyncContext } from '@powersync/react'
import type { PowerSyncDatabase } from '@powersync/web'
import { type ReactNode, useEffect, useState } from 'react'
import { ApiConnector } from './connector'
import { createPowerSync } from './db'

const OWNER_KEY = 'binder.localDbOwner'

let shared: PowerSyncDatabase | undefined
/** One database per page: it owns a worker and an OPFS file lock. */
export function getPowerSync(): PowerSyncDatabase {
  shared ??= createPowerSync()
  return shared
}

function readOwner(): string | null {
  try {
    return localStorage.getItem(OWNER_KEY)
  } catch {
    return null
  }
}

function writeOwner(userId: string | null) {
  try {
    if (userId) localStorage.setItem(OWNER_KEY, userId)
    else localStorage.removeItem(OWNER_KEY)
  } catch {
    // Storage blocked: the clear-on-sign-out path still protects the next user.
  }
}

/**
 * Connects the local database for the signed-in user. If the local file belongs to someone else
 * (a different user signed in on this browser without signing out), it is wiped first so one
 * user's synced rows can never be shown to another.
 */
export function PowerSyncProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [db] = useState(getPowerSync)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const owner = readOwner()
      if (owner && owner !== userId) await db.disconnectAndClear()
      if (cancelled) return
      writeOwner(userId)
      await db.connect(new ApiConnector())
    })()
    return () => {
      cancelled = true
    }
  }, [db, userId])

  return <PowerSyncContext.Provider value={db}>{children}</PowerSyncContext.Provider>
}

/** Sign-out: stop syncing and delete every local row and queued upload. */
export async function clearLocalData(): Promise<void> {
  await getPowerSync().disconnectAndClear()
  writeOwner(null)
}
