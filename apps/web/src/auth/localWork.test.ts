import { expect, test, vi } from 'vitest'

test('B13 a failed Web Lock acquisition releases the local write pause', async () => {
  vi.resetModules()
  const { quiesceLocalWork, runLocalWork } = await import('./localWork')
  vi.stubGlobal('navigator', {
    locks: {
      request: vi.fn(async () => {
        throw new Error('Lock unavailable')
      }),
    },
  })
  await expect(quiesceLocalWork()).rejects.toThrow('Lock unavailable')
  vi.stubGlobal('navigator', {})
  await expect(runLocalWork(async () => 'preserved')).resolves.toBe('preserved')
})

test('B13 local writes drain before confirmation, reject while paused, and reject a stale account facade', async () => {
  vi.resetModules()
  const { activateLocalUser, guardLocalDatabase, quiesceLocalWork } = await import('./localWork')
  localStorage.setItem('binder.localDbOwner', 'disposable-one')
  localStorage.setItem('binder.localDbDevice', 'test-ticket')
  activateLocalUser('disposable-one')
  let finish = () => {}
  const underlying = {
    execute: vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    ),
  }
  const old = guardLocalDatabase(underlying, 'disposable-one')
  const write = old.execute()
  let acquired = false
  const draining = quiesceLocalWork().then((release) => {
    acquired = true
    return release
  })
  await Promise.resolve()
  expect(acquired).toBe(false)
  await expect(old.execute()).rejects.toThrow(/paused/)
  finish()
  await write
  const release = await draining
  release()
  localStorage.setItem('binder.localDbOwner', 'disposable-two')
  activateLocalUser('disposable-two')
  await expect(old.execute()).rejects.toThrow(/session has changed/)
  expect(underlying.execute).toHaveBeenCalledOnce()
})
