import { PowerSyncContext, useStatus } from '@powersync/react'
import { PowerSyncDatabase } from '@powersync/web'
import { render } from '@testing-library/react'
import { useLayoutEffect } from 'react'
import { expect, test, vi } from 'vitest'
import { activateLocalUser, disposeLocalDatabase, guardLocalDatabase } from '../auth/localWork'

test.each(['dispose', 'account transition'] as const)(
  'installed useStatus passive registration is inert after %s, with stale capabilities still rejected',
  async (transition) => {
    localStorage.setItem('binder.localDbOwner', 'A')
    localStorage.setItem('binder.localDbClaim', 'status-original')
    activateLocalUser('A')
    const real = Object.create(PowerSyncDatabase.prototype) as PowerSyncDatabase
    const close = vi.fn()
    const register = vi.fn((..._args: Parameters<PowerSyncDatabase['registerListener']>) => close)
    real.registerListener = register
    real.getAll = vi.fn(async () => [])
    real.execute = vi.fn()
    const db = guardLocalDatabase(real, 'A')
    const changed = vi.fn()
    const cleanup = db.registerListener({ statusChanged: changed })
    const retained = register.mock.calls[0]?.[0]
    function Screen() {
      useStatus()
      // Layout effects run before the installed hook's passive registration, as can
      // revocation during teardown/reconnection of a still-committed consumer.
      useLayoutEffect(() => {
        if (transition === 'dispose') disposeLocalDatabase(db)
        else {
          localStorage.setItem('binder.localDbOwner', 'B')
          localStorage.setItem('binder.localDbClaim', 'status-replacement')
          activateLocalUser('B')
        }
      }, [])
      return null
    }
    const view = render(
      <PowerSyncContext.Provider value={db}>
        <Screen />
      </PowerSyncContext.Provider>,
    )
    expect(register).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
    retained?.statusChanged?.(real.currentStatus)
    expect(changed).not.toHaveBeenCalled()
    await expect(db.getAll('SELECT private_rows')).rejects.toThrow(/session has changed/)
    await expect(db.execute('DELETE FROM private_rows')).rejects.toThrow(/session has changed/)
    expect(real.getAll).not.toHaveBeenCalled()
    expect(real.execute).not.toHaveBeenCalled()
    view.unmount()
    cleanup()
  },
)
