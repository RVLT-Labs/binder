import { newId } from '@binder/shared'
import type { PowerSyncDatabase } from '@powersync/web'
import { AppSchema } from './schema'

export type LocalDb = Pick<
  PowerSyncDatabase,
  'waitForReady' | 'getAll' | 'getClientId' | 'disconnectAndClear'
>

const OWNER_KEY = 'binder.localDbOwner'
/** Upload namespace: stable for queued retries while this owner's SQLite file is retained. */
const DEVICE_KEY = 'binder.localDbDevice'
/** UI/cache claim may be revoked without changing queued uploads' replay identity. */
const CLAIM_KEY = 'binder.localDbClaim'
/** PowerSync's persistent file identity distinguishes an empty live file from a recreated one. */
const CLIENT_KEY = 'binder.localDbClient'

/** The device id when storage is blocked, so it is at least stable for this page's lifetime. */
let memoryDeviceId: string | null = null

function readDevice(): string | null {
  try {
    return localStorage.getItem(DEVICE_KEY)
  } catch {
    return null
  }
}

function writeDevice(id: string | null): void {
  memoryDeviceId = id
  try {
    if (id) localStorage.setItem(DEVICE_KEY, id)
    else localStorage.removeItem(DEVICE_KEY)
  } catch {
    // Storage blocked: the in-memory id serves this page.
  }
}

/**
 * This local database's id, a UUIDv7 minted when it is claimed for a new owner (and after sign-out),
 * reused until the next claim of a new owner or recreated database. Upload batch ids are
 * `${deviceId()}-${transactionId}`: PowerSync's transaction counter restarts whenever the database is
 * wiped or recreated, and the device id changes with it, so one user's batch ids never repeat across
 * devices, sign-ins, or databases (the server skips a repeated batch id as a replay).
 */
export function deviceId(): string {
  const id = readDevice() ?? memoryDeviceId ?? newId()
  if (id !== memoryDeviceId) writeDevice(id)
  return id
}

export function readOwner(): string | null {
  try {
    return localStorage.getItem(OWNER_KEY)
  } catch {
    return null
  }
}

export function writeOwner(userId: string | null): void {
  // Signing out (null) ends this claim: the next one mints a new device id.
  if (userId === null) writeDevice(null)
  try {
    if (userId) localStorage.setItem(OWNER_KEY, userId)
    else {
      localStorage.removeItem(OWNER_KEY)
      localStorage.removeItem(CLAIM_KEY)
    }
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
 * on a shared machine one user's rows never appear for the next. `clearForeignCaches` runs whenever
 * the recorded owner is not this user, for caches that hold no rows to detect (cached blobs) and for
 * the previous user's export outbox: their queued PDFs can hold their personal layer, and this user
 * must neither see nor upload them. The download already happened on their turn; only the
 * still-unrecorded ExportRecord is lost.
 */
export async function claimLocalDb(
  db: LocalDb,
  userId: string,
  clearForeignCaches?: () => Promise<void>,
): Promise<void> {
  // Unlike getAll(), getClientId() does not await the SDK's schema initialization.
  await db.waitForReady()
  const owner = readOwner()
  const clientId = await db.getClientId()
  if (!clientId) throw new Error('Could not verify the local database identity.')
  let previousClient: string | null = null
  try {
    previousClient = localStorage.getItem(CLIENT_KEY)
  } catch {}
  if (owner !== userId) await clearForeignCaches?.()
  const empty = !(await hasLocalRows(db))
  if (owner !== userId && (owner !== null || !empty)) {
    await db.disconnectAndClear()
  }
  // getClientId() persists through clearing, but changes when the SQLite file is deleted.
  // Another empty tab before initial sync therefore keeps the verified claim. A recreated file
  // rotates its upload namespace. Upgrade a legacy nonempty file without orphaning queued retries;
  // a legacy empty file has no retry to preserve and gets a fresh namespace once.
  const recreated = previousClient !== clientId && (previousClient !== null || empty)
  const newDevice = owner !== userId || recreated || readDevice() === null
  if (newDevice) writeDevice(newId())
  try {
    localStorage.setItem(CLIENT_KEY, clientId)
    if (newDevice || localStorage.getItem(CLAIM_KEY) === null)
      localStorage.setItem(CLAIM_KEY, newId())
  } catch {}
  writeOwner(userId)
}
