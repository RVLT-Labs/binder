import { PowerSyncContext, useQuery } from '@powersync/react'
import { type LockContext, PowerSyncDatabase } from '@powersync/web'
import { act, render, screen, waitFor } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { activateLocalUser, guardLocalDatabase } from '../auth/localWork'

test('R2 installed PowerSync receivers, transactions, query/watch and useQuery retain their lifetimes', async () => {
  localStorage.setItem('binder.localDbOwner', 'A')
  localStorage.setItem('binder.localDbDevice', 'original')
  activateLocalUser('A')
  const real = Object.create(PowerSyncDatabase.prototype)
  const tx = {
    commit: vi.fn(async () => {}),
    execute: vi.fn(async () => ({ rows: { _array: [] } })),
  }
  const adapter = {
    getAll: vi.fn(async function (this: unknown) {
      expect(this).toBe(adapter)
      return [{ title: 'A private show' }]
    }),
    writeTransaction: async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx),
  }
  real.ready = true
  real._isReadyPromise = Promise.resolve()
  real._database = adapter
  real.registerListener = vi.fn(() => vi.fn())
  real.resolveTables = vi.fn(async () => ['shows'])
  real.onChangeWithCallback = vi.fn((handler, options) => {
    if (options?.triggerImmediate) void handler.onChange({ tables: ['shows'] })
    return vi.fn()
  })
  const db = guardLocalDatabase(real as PowerSyncDatabase, 'A')
  expect(await db.getAll('SELECT title FROM shows')).toEqual([{ title: 'A private show' }])
  let retained!: LockContext
  await db.writeTransaction(async (transaction) => {
    retained = transaction
    await transaction.execute('SELECT 1')
  })
  expect(tx.execute.mock.contexts[0]).toBe(tx)
  expect(tx.commit.mock.contexts[0]).toBe(tx)
  await expect(retained.execute('SELECT 1')).rejects.toThrow(/callback has ended/)
  const watched = db.query<{ title: string }>({ sql: 'SELECT title FROM shows' }).watch()
  await waitFor(() => expect(watched.state.data).toEqual([{ title: 'A private show' }]))
  function Screen() {
    const result = useQuery<{ title: string }>('SELECT title FROM shows')
    return <p>{result.data[0]?.title}</p>
  }
  render(
    <PowerSyncContext.Provider value={db}>
      <Screen />
    </PowerSyncContext.Provider>,
  )
  await screen.findByText('A private show')
  act(() => {
    localStorage.setItem('binder.localDbOwner', 'B')
    localStorage.setItem('binder.localDbDevice', 'replacement')
    window.dispatchEvent(new StorageEvent('storage', { key: 'binder.localDbDevice' }))
  })
  expect(watched.closed).toBe(true)
  await expect(db.getAll('SELECT title FROM shows')).rejects.toThrow(/session has changed/)
})
