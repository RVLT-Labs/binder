import { beforeEach, expect, test, vi } from 'vitest'
import { runCueSheetExport } from '../exports/runCueSheetExport'
import type { ExportDb } from '../exports/runPrintExport'
import {
  activateLocalUser,
  countLocalUploadsForSignOut,
  disposeLocalDatabase,
  endLocalSession,
  guardLocalDatabase,
  quiesceLocalWork,
} from './localWork'

beforeEach(() => {
  localStorage.setItem('binder.localDbOwner', 'account-A')
  localStorage.setItem('binder.localDbDevice', 'ticket-A')
  activateLocalUser('account-A')
})

test('R2 actual cue sheet export rejects the original facade after another account claims it', async () => {
  const getAll = vi.fn(async (sql: string) => {
    if (sql.includes('FROM shows')) return [{ title: 'B private show', settings: null }]
    if (sql.includes('FROM departments')) return [{ id: 'department-B', code: 'SND' }]
    return []
  })
  const db = guardLocalDatabase({ getAll } as ExportDb, 'account-A')
  localStorage.setItem('binder.localDbOwner', 'account-B')
  localStorage.setItem('binder.localDbDevice', 'ticket-B')
  const download = vi.fn()
  const enqueue = vi.fn(async () => {})
  await expect(
    runCueSheetExport(
      db,
      { userId: 'account-A', showId: 'show-B', scope: { role: 'viewer', departments: [] } },
      { departmentId: 'department-B', format: 'csv' },
      { download, enqueue },
    ),
  ).rejects.toThrow(/session has changed/)
  expect(getAll).not.toHaveBeenCalled()
  expect(download).not.toHaveBeenCalled()
  expect(enqueue).not.toHaveBeenCalled()
})

test('R2 reads reject stale ownership, including results pending during the transition', async () => {
  let finish!: (rows: string[]) => void
  const getAll = vi.fn(
    () =>
      new Promise<string[]>((resolve) => {
        finish = resolve
      }),
  )
  const db = guardLocalDatabase({ getAll }, 'account-A')
  const pending = db.getAll()
  localStorage.setItem('binder.localDbOwner', 'account-B')
  localStorage.setItem('binder.localDbDevice', 'ticket-B')
  finish(['B private row'])
  await expect(pending).rejects.toThrow(/session has changed/)
  await expect(db.getAll()).rejects.toThrow(/session has changed/)
  expect(getAll).toHaveBeenCalledOnce()
})

test('R2 an export already generating cannot download or queue after its provider is disposed', async () => {
  const db = guardLocalDatabase(
    {
      async getAll<T>(sql: string): Promise<T[]> {
        return (
          sql.includes('FROM shows')
            ? [{ title: 'A show', settings: null }]
            : sql.includes('FROM departments')
              ? [{ id: 'd', code: 'LX' }]
              : []
        ) as T[]
      },
    },
    'account-A',
  )
  const download = vi.fn()
  const enqueue = vi.fn(async () => {})
  await expect(
    runCueSheetExport(
      db,
      { userId: 'account-A', showId: 's', scope: { role: 'viewer', departments: [] } },
      { departmentId: 'd', format: 'csv' },
      {
        download,
        enqueue,
        now: () => {
          disposeLocalDatabase(db)
          return new Date()
        },
      },
    ),
  ).rejects.toThrow(/session has changed/)
  expect(download).not.toHaveBeenCalled()
  expect(enqueue).not.toHaveBeenCalled()
})

test('R2 the sign-out counter requires exclusive exclusion and the original or own-revoked claim', async () => {
  const get = vi.fn(async <T>() => ({ n: 1 }) as T)
  const db = guardLocalDatabase({ get }, 'account-A')
  await expect(countLocalUploadsForSignOut(db, 'account-A')).rejects.toThrow(
    /owner could not be verified/,
  )
  expect(get).not.toHaveBeenCalled()
  const release = await quiesceLocalWork()
  try {
    expect(await countLocalUploadsForSignOut(db, 'account-A')).toBe(1)
    disposeLocalDatabase(db)
    endLocalSession()
    expect(await countLocalUploadsForSignOut(db, 'account-A')).toBe(1)
    await expect(db.get()).rejects.toThrow(/session has changed/)
    localStorage.setItem('binder.localDbOwner', 'account-B')
    localStorage.setItem('binder.localDbDevice', 'ticket-B')
    await expect(countLocalUploadsForSignOut(db, 'account-A')).rejects.toThrow(
      /owner could not be verified/,
    )
    expect(get).toHaveBeenCalledTimes(2)
  } finally {
    await release()
  }
})

test('R2 remaining PowerSync read methods reject stale results without changing synchronous return types', async () => {
  let finish!: (value: string[]) => void
  const mutex = { lock: 'same object' }
  const raw = {
    getCrudBatch: vi.fn(
      () =>
        new Promise<string[]>((resolve) => {
          finish = resolve
        }),
    ),
    createMutex() {
      expect(this).toBe(raw)
      return mutex
    },
  }
  const db = guardLocalDatabase(raw, 'account-A')
  expect(db.createMutex()).toBe(mutex)
  const pending = db.getCrudBatch()
  localStorage.setItem('binder.localDbOwner', 'account-B')
  finish(['B private CRUD'])
  await expect(pending).rejects.toThrow(/session has changed/)
  await expect(db.getCrudBatch()).rejects.toThrow(/session has changed/)
  expect(raw.getCrudBatch).toHaveBeenCalledOnce()
})

test('R2 CRUD async iterators check the original claim before yielding each result', async () => {
  let finish!: () => void
  const waiting = new Promise<void>((resolve) => {
    finish = resolve
  })
  const db = guardLocalDatabase(
    {
      async *getCrudTransactions() {
        await waiting
        yield 'B private CRUD'
      },
    },
    'account-A',
  )
  const iterator = db.getCrudTransactions()[Symbol.asyncIterator]()
  const pending = iterator.next()
  localStorage.setItem('binder.localDbOwner', 'account-B')
  finish()
  await expect(pending).rejects.toThrow(/session has changed/)
})
