import { PowerSyncContext, useQuery } from '@powersync/react'
import { PowerSyncDatabase } from '@powersync/web'
import { render } from '@testing-library/react'
import { useLayoutEffect } from 'react'
import { expect, test, vi } from 'vitest'
import { activateLocalUser, disposeLocalDatabase, guardLocalDatabase } from '../auth/localWork'

test.each(['dispose', 'account transition'] as const)(
  'installed useQuery passive setup is closed after %s without accessing the SDK',
  async (transition) => {
    localStorage.setItem('binder.localDbOwner', 'A')
    localStorage.setItem('binder.localDbClaim', 'query-original')
    activateLocalUser('A')
    const real = Object.create(PowerSyncDatabase.prototype) as PowerSyncDatabase
    const customQuery = vi.spyOn(real, 'customQuery')
    real.getAll = vi.fn(async () => [])
    real.execute = vi.fn()
    const db = guardLocalDatabase(real, 'A')
    const retained = db.query({ sql: 'SELECT private_rows' })
    function Screen() {
      const result = useQuery('SELECT private_rows')
      useLayoutEffect(() => {
        if (transition === 'dispose') disposeLocalDatabase(db)
        else {
          localStorage.setItem('binder.localDbOwner', 'B')
          localStorage.setItem('binder.localDbClaim', 'query-replacement')
          activateLocalUser('B')
        }
      }, [])
      return <p>{result.data.length}</p>
    }
    customQuery.mockClear()
    const view = render(
      <PowerSyncContext.Provider value={db}>
        <Screen />
      </PowerSyncContext.Provider>,
    )
    for (const watched of [
      retained.watch(),
      retained.differentialWatch({
        rowComparator: { keyBy: (row) => String(row), compareBy: (row) => String(row) },
      }),
    ]) {
      expect(watched.closed).toBe(true)
      expect(watched.state.data).toEqual([])
      const changed = vi.fn()
      watched.registerListener({ onData: changed })()
      await watched.updateSettings({
        query: {
          compile: () => ({ sql: 'SELECT private_rows', parameters: [] }),
          execute: vi.fn(async () => []),
        },
      })
      await watched.close()
      expect(changed).not.toHaveBeenCalled()
    }
    expect(customQuery).not.toHaveBeenCalled()
    await expect(db.getAll('SELECT private_rows')).rejects.toThrow(/session has changed/)
    await expect(db.execute('DELETE FROM private_rows')).rejects.toThrow(/session has changed/)
    expect(real.getAll).not.toHaveBeenCalled()
    expect(real.execute).not.toHaveBeenCalled()
    view.unmount()
  },
)
