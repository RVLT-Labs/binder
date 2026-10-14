import { beforeEach, expect, test, vi } from 'vitest'
import { claimLocalDb, deviceId, type LocalDb, writeOwner } from './ownership'

const OWNER_KEY = 'binder.localDbOwner'

function fakeDb(rowsIn: string[] = []) {
  const db = {
    getAll: vi.fn(async (sql: string) =>
      rowsIn.some((table) => sql.includes(`"${table}"`)) ? [{ x: 1 }] : [],
    ),
    disconnectAndClear: vi.fn(async () => {}),
  }
  return db as typeof db & LocalDb
}

beforeEach(() => localStorage.clear())

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
