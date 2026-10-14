import type { PowerSyncDatabase } from '@powersync/web'
import { AppSchema } from './schema'

export type LocalDb = Pick<PowerSyncDatabase, 'getAll' | 'disconnectAndClear'>

const OWNER_KEY = 'binder.localDbOwner'

function readOwner(): string | null {
  try {
    return localStorage.getItem(OWNER_KEY)
  } catch {
    return null
  }
}

export function writeOwner(userId: string | null): void {
  try {
    if (userId) localStorage.setItem(OWNER_KEY, userId)
    else localStorage.removeItem(OWNER_KEY)
  } catch {
    // Storage blocked: claimLocalDb then finds no marker and wipes any rows, which is safe.
  }
}

async function hasLocalRows(db: LocalDb): Promise<boolean> {
  // Synced rows, plus ps_crud: writes queued by whoever used this browser before.
  for (const table of [...AppSchema.tables.map((t) => t.name), 'ps_crud']) {
    if ((await db.getAll(`SELECT 1 FROM "${table}" LIMIT 1`)).length > 0) return true
  }
  return false
}

/**
 * Makes the local database the signed-in user's before it is shown or synced. A database marked
 * as another user's, or holding rows with no marker at all (storage partly cleared), is wiped, so
 * on a shared machine one user's rows never appear for the next.
 */
export async function claimLocalDb(db: LocalDb, userId: string): Promise<void> {
  const owner = readOwner()
  if (owner !== userId && (owner !== null || (await hasLocalRows(db)))) {
    await db.disconnectAndClear()
  }
  writeOwner(userId)
}
