import { beforeEach, expect, test, vi } from 'vitest'
import { claimLocalDb, type LocalDb } from './ownership'

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
