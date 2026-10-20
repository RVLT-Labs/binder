import { beforeEach, expect, test, vi } from 'vitest'
import { activateLocalUser, guardLocalDatabase } from '../auth/localWork'
import { claimLocalDb, deviceId, type LocalDb, writeOwner } from './ownership'

const OWNER_KEY = 'binder.localDbOwner'

function fakeDb(rowsIn: string[] = [], clientId = 'same-live-database') {
  const db = {
    waitForReady: vi.fn(async () => {}),
    getClientId: vi.fn(async () => clientId),
    getAll: vi.fn(async (sql: string) =>
      rowsIn.some((table) => sql.includes(`"${table}"`)) ? [{ x: 1 }] : [],
    ),
    disconnectAndClear: vi.fn(async () => {}),
  }
  return db as typeof db & LocalDb
}

beforeEach(() => localStorage.clear())

test('awaits SDK initialization before querying the persistent identity or claiming ownership', async () => {
  let initialize!: () => void
  let ready = false
  const initialization = new Promise<void>((resolve) => {
    initialize = () => {
      ready = true
      resolve()
    }
  })
  // Installed SDK boundary: construction starts initialization; getAll waits for it,
  // but getClientId queries bucket storage directly, before ps_kv exists if not ready.
  const db = {
    ...fakeDb(),
    waitForReady: vi.fn(() => initialization),
    getClientId: vi.fn(async () => {
      if (!ready) throw new Error('powersync_client_id: no such table: ps_kv')
      return 'initialized-file'
    }),
    getAll: vi.fn(async () => {
      await initialization
      return []
    }),
  }
  const clearForeign = vi.fn(async () => {})
  const claiming = claimLocalDb(db, 'u1', clearForeign)
  // Attach rejection handling immediately so RED does not produce an unhandled rejection.
  const outcome = claiming.then(
    () => null,
    (error: unknown) => error,
  )
  try {
    await Promise.resolve()
    expect(db.getClientId).not.toHaveBeenCalled()
    expect(db.getAll).not.toHaveBeenCalled()
    expect(clearForeign).not.toHaveBeenCalled()
    expect(localStorage.length).toBe(0)
  } finally {
    initialize()
    await outcome
  }
  expect(await outcome).toBeNull()
  expect(db.getClientId).toHaveBeenCalledOnce()
  expect(localStorage.getItem('binder.localDbClient')).toBe('initialized-file')
  expect(localStorage.getItem(OWNER_KEY)).toBe('u1')
  expect(db.disconnectAndClear).not.toHaveBeenCalled()
})

test('propagates initialization failure without querying identity or changing ownership', async () => {
  const db = fakeDb()
  const error = new Error('SQLite initialization failed')
  db.waitForReady.mockRejectedValue(error)
  const clearForeign = vi.fn(async () => {})
  await expect(claimLocalDb(db, 'u1', clearForeign)).rejects.toBe(error)
  expect(db.getClientId).not.toHaveBeenCalled()
  expect(db.getAll).not.toHaveBeenCalled()
  expect(clearForeign).not.toHaveBeenCalled()
  expect(localStorage.length).toBe(0)
})

test('keeps the database when it belongs to the signed-in user', async () => {
  localStorage.setItem(OWNER_KEY, 'u1')
  const db = fakeDb(['shows'])
  await claimLocalDb(db, 'u1')
  expect(db.disconnectAndClear).not.toHaveBeenCalled()
  expect(localStorage.getItem(OWNER_KEY)).toBe('u1')
})

test('wipes a database owned by another user', async () => {
  localStorage.setItem(OWNER_KEY, 'u2')
  const db = fakeDb(['shows'])
  await claimLocalDb(db, 'u1')
  expect(db.disconnectAndClear).toHaveBeenCalledOnce()
  expect(localStorage.getItem(OWNER_KEY)).toBe('u1')
})

test('treats rows without an ownership marker as foreign and wipes them', async () => {
  const db = fakeDb(['show_memberships'])
  await claimLocalDb(db, 'u1')
  expect(db.disconnectAndClear).toHaveBeenCalledOnce()
  expect(localStorage.getItem(OWNER_KEY)).toBe('u1')
})

test('treats a queued upload without a marker as foreign', async () => {
  const db = fakeDb(['ps_crud'])
  await claimLocalDb(db, 'u1')
  expect(db.disconnectAndClear).toHaveBeenCalledOnce()
})

test('claims an empty database without wiping it', async () => {
  const db = fakeDb()
  await claimLocalDb(db, 'u1')
  expect(db.disconnectAndClear).not.toHaveBeenCalled()
  expect(localStorage.getItem(OWNER_KEY)).toBe('u1')
})

test('clears caches left by another user when the owner changes', async () => {
  localStorage.setItem(OWNER_KEY, 'u2')
  const clearForeign = vi.fn(async () => {})
  await claimLocalDb(fakeDb(), 'u1', clearForeign)
  expect(clearForeign).toHaveBeenCalledOnce()
})

test('clears caches when no owner is recorded, even with no rows', async () => {
  const clearForeign = vi.fn(async () => {})
  await claimLocalDb(fakeDb(), 'u1', clearForeign)
  expect(clearForeign).toHaveBeenCalledOnce()
})

test('keeps caches for the same owner', async () => {
  localStorage.setItem(OWNER_KEY, 'u1')
  const clearForeign = vi.fn(async () => {})
  await claimLocalDb(fakeDb(['shows']), 'u1', clearForeign)
  expect(clearForeign).not.toHaveBeenCalled()
})

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

test('a claim mints a device id that the same owner keeps across reloads', async () => {
  await claimLocalDb(fakeDb(), 'u1')
  const first = deviceId()
  expect(first).toMatch(UUID)
  await claimLocalDb(fakeDb(['shows']), 'u1')
  expect(deviceId()).toBe(first)
})

test('a new owner (the database wiped) gets a new device id', async () => {
  await claimLocalDb(fakeDb(), 'u1')
  const first = deviceId()
  await claimLocalDb(fakeDb(['shows']), 'u2')
  expect(deviceId()).not.toBe(first)
  expect(deviceId()).toMatch(UUID)
})

test('sign-out forgets the device id, so signing in again starts a new one', async () => {
  await claimLocalDb(fakeDb(), 'u1')
  const first = deviceId()
  writeOwner(null)
  await claimLocalDb(fakeDb(), 'u1')
  expect(deviceId()).not.toBe(first)
})

test('the device id still works, and stays stable, when storage is blocked', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new DOMException('blocked', 'SecurityError')
  })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('blocked', 'SecurityError')
  })
  await claimLocalDb(fakeDb(), 'u1')
  const id = deviceId()
  expect(id).toMatch(UUID)
  expect(deviceId()).toBe(id)
})

test('claiming an empty database mints a new device id, so a recreated database never reuses batch ids', async () => {
  // Same owner and a remembered device id, but the database itself is new (its transaction counter
  // restarts at 1): the old id would repeat batch ids the server has already applied.
  await claimLocalDb(fakeDb(['shows']), 'u1')
  const first = deviceId()
  await claimLocalDb(fakeDb([], 'recreated-database'), 'u1')
  expect(deviceId()).not.toBe(first)
  expect(deviceId()).toMatch(UUID)
})

test('R4 two empty same-owner claims keep the first facade editable after initial sync', async () => {
  const rows: string[] = []
  const first = {
    ...fakeDb(rows),
    execute: vi.fn(async () => 'saved'),
  }
  await claimLocalDb(first, 'u1')
  activateLocalUser('u1')
  const facade = guardLocalDatabase(first, 'u1')
  const originalTicket = deviceId()
  await claimLocalDb(fakeDb(), 'u1') // second tab, same live SQLite file, still waiting for sync
  rows.push('shows')
  await expect(facade.execute()).resolves.toBe('saved')
  expect(deviceId()).toBe(originalTicket)
  await claimLocalDb(fakeDb(['shows']), 'u2')
  await expect(facade.execute()).rejects.toThrow(/session has changed/)
  expect(first.execute).toHaveBeenCalledOnce()
})
