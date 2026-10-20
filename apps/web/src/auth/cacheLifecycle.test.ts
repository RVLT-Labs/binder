import { expect, test, vi } from 'vitest'
import { webLocks } from '../test/webLocks'

test.each([false, true])(
  'R3 delayed other-tab keep-offline response cannot repopulate after sign-out (storage event: %s)',
  async (notify) => {
    const locks = webLocks()
    vi.stubGlobal('navigator', { locks })
    localStorage.setItem('binder.localDbOwner', 'A')
    localStorage.setItem('binder.localDbDevice', 'ticket-A')
    vi.resetModules()
    const tabB = await import('./localWork')
    tabB.activateLocalUser('A')
    const { createKeepOfflineRunner } = await import('../offline/keepOffline/runner')
    const cache = new Map<string, Response>()
    const { putBlobResponse } = await import('../blobs/fetchBlob')
    vi.stubGlobal('caches', {
      open: async () => ({
        put: async (url: string, response: Response) => {
          cache.set(url, response)
        },
      }),
    })
    let finish!: (response: Response) => void
    let markStarted!: () => void
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    const runner = createKeepOfflineRunner({
      loadRows: async () => ({
        versions: [{ id: 'v', status: 'ready', searchable_key: 'shows/private-A/document.pdf' }],
        pages: [],
      }),
      cachedUrls: async () => new Set(),
      fetchBlob: async () => {
        markStarted()
        return new Promise<Response>((resolve) => {
          finish = resolve
        })
      },
      putBlob: putBlobResponse,
      deleteShowBlobs: async () => {},
      dropPreference: async () => {},
      estimate: async () => undefined,
      isOnline: () => true,
      saveData: () => false,
      locks,
    })
    runner.update({ enabled: ['private-A'], localShows: null })
    await started
    // Separate module state models tab A's distinct owner/generation and active set.
    vi.resetModules()
    const tabA = await import('./localWork')
    tabA.activateLocalUser('A')
    const { signOutAndClear } = await import('./signOut')
    const server = vi.fn(async () => ({ error: null }))
    await signOutAndClear({
      signOut: server,
      pendingUploads: async () => 0,
      pendingExports: async () => 0,
      confirm: () => true,
      stopOfflineRunner: async () => {},
      stopExportRunner: async () => {},
      clearOutbox: async () => {},
      clearOfflinePrefs: async () => {},
      clearLocalData: async () => {
        cache.clear()
        localStorage.removeItem('binder.localDbDevice')
      },
      clearCache: () => {},
      toLogin: async () => {},
    })
    expect(server).toHaveBeenCalledOnce()
    expect(cache.size).toBe(0)
    if (notify) {
      window.dispatchEvent(new StorageEvent('storage', { key: 'binder.localDbDevice' }))
      // Actual stop/await completes without waiting for a fetch that ignores AbortSignal.
      await runner.whenIdle()
    }
    finish(new Response('disposable private bytes'))
    await runner.whenIdle()
    expect([...cache.keys()]).toEqual([])
    await runner.stop()
  },
)

test('R3 a runner resumed during a temporary sign-out pause can recover after cancellation', async () => {
  vi.resetModules()
  localStorage.setItem('binder.localDbOwner', 'A')
  localStorage.setItem('binder.localDbDevice', 'ticket-A')
  const local = await import('./localWork')
  local.activateLocalUser('A')
  const { createKeepOfflineRunner } = await import('../offline/keepOffline/runner')
  const put = vi.fn(async () => {})
  const runner = createKeepOfflineRunner({
    loadRows: async () => ({
      versions: [{ id: 'v', status: 'ready', searchable_key: 'shows/A/document.pdf' }],
      pages: [],
    }),
    cachedUrls: async () => new Set(),
    fetchBlob: async () => new Response('bytes'),
    putBlob: put,
    deleteShowBlobs: async () => {},
    dropPreference: async () => {},
    estimate: async () => undefined,
    isOnline: () => true,
    saveData: () => false,
  })
  const release = await local.quiesceLocalWork()
  runner.update({ enabled: ['A'], localShows: null })
  await runner.whenIdle()
  expect(put).not.toHaveBeenCalled()
  await release()
  runner.resume()
  await runner.whenIdle()
  expect(put).toHaveBeenCalledOnce()
  await runner.stop()
})

test.each(['fetchBlob', 'storeBlob'] as const)(
  'R3 delayed %s keeps the original claim through its network wait',
  async (method) => {
    vi.resetModules()
    localStorage.setItem('binder.localDbOwner', 'A')
    localStorage.setItem('binder.localDbDevice', 'ticket-A')
    const local = await import('./localWork')
    local.activateLocalUser('A')
    const blobs = await import('../blobs/fetchBlob')
    const put = vi.fn(async () => {})
    vi.stubGlobal('caches', { open: async () => ({ match: async () => undefined, put }) })
    let finish!: (response: Response) => void
    let markStarted!: () => void
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    vi.stubGlobal('fetch', async () => {
      markStarted()
      return new Promise<Response>((resolve) => {
        finish = resolve
      })
    })
    const pending = blobs[method]('/blobs/disposable-private.pdf')
    await started
    const release = await local.quiesceLocalWork()
    local.endLocalSession()
    release()
    // Even after this tab activates a replacement account, the pending response belongs to A.
    localStorage.setItem('binder.localDbOwner', 'B')
    localStorage.setItem('binder.localDbDevice', 'ticket-B')
    local.activateLocalUser('B')
    finish(new Response('A bytes'))
    await expect(pending).rejects.toThrow(/session has changed/)
    expect(put).not.toHaveBeenCalled()
  },
)

test('R3 a queued exclusive lock cannot deadlock a nested cache copy inside an export', async () => {
  vi.resetModules()
  localStorage.setItem('binder.localDbOwner', 'A')
  localStorage.setItem('binder.localDbDevice', 'ticket-A')
  const local = await import('./localWork')
  local.activateLocalUser('A')
  let exclusive!: Promise<unknown>
  const cache = local.captureLocalCacheWork()
  const copy = vi.fn(async () => {})
  await local.runLocalWork(async () => {
    exclusive = navigator.locks.request('binder-local-data', { mode: 'exclusive' }, async () => {})
    await expect(cache.commit(copy)).rejects.toThrow(/busy/)
  }, 'A')
  await exclusive
  expect(copy).not.toHaveBeenCalled()
})

test('R3 server failure preserves the original claim and allows a delayed cache producer to recover', async () => {
  vi.resetModules()
  localStorage.setItem('binder.localDbOwner', 'A')
  localStorage.setItem('binder.localDbDevice', 'ticket-A')
  const local = await import('./localWork')
  local.activateLocalUser('A')
  const producer = local.captureLocalCacheWork()
  const { signOutAndClear } = await import('./signOut')
  const clear = vi.fn(async () => {})
  await signOutAndClear({
    signOut: async () => ({ error: { message: 'offline' } }),
    pendingUploads: async () => 0,
    pendingExports: async () => 0,
    confirm: () => true,
    stopOfflineRunner: clear,
    stopExportRunner: clear,
    clearOutbox: clear,
    clearOfflinePrefs: clear,
    clearLocalData: clear,
    clearCache: clear,
    toLogin: clear,
  })
  expect(clear).not.toHaveBeenCalled()
  expect(localStorage.getItem('binder.localDbDevice')).toBe('ticket-A')
  await expect(producer.commit(async () => 'preserved')).resolves.toBe('preserved')
})

test('R3 an export already draining can finish reading its PDF while new cache commits are paused', async () => {
  vi.resetModules()
  localStorage.setItem('binder.localDbOwner', 'A')
  localStorage.setItem('binder.localDbDevice', 'ticket-A')
  const local = await import('./localWork')
  local.activateLocalUser('A')
  const { fetchBlob } = await import('../blobs/fetchBlob')
  const put = vi.fn(async () => {})
  vi.stubGlobal('caches', { open: async () => ({ match: async () => undefined, put }) })
  vi.stubGlobal('fetch', async () => new Response('export PDF bytes'))
  let proceed!: () => void
  let markStarted!: () => void
  const waiting = new Promise<void>((resolve) => {
    proceed = resolve
  })
  const started = new Promise<void>((resolve) => {
    markStarted = resolve
  })
  const exportWork = local.runLocalWork(async () => {
    markStarted()
    await waiting
    return (await fetchBlob('/blobs/A/pdf')).text()
  }, 'A')
  await started
  const draining = local.quiesceLocalWork()
  proceed()
  await expect(exportWork).resolves.toBe('export PDF bytes')
  const release = await draining
  await release()
  expect(put).not.toHaveBeenCalled()
})

test('R3 cleanup failure revokes the claim while retaining the queued CRUD upload namespace', async () => {
  vi.resetModules()
  localStorage.clear()
  const local = await import('./localWork')
  const { claimLocalDb, deviceId } = await import('../powersync/ownership')
  let synced = false
  const raw = {
    getClientId: async () => 'disposable-live-file',
    getAll: async <T>(sql: string): Promise<T[]> =>
      synced && sql.includes('"shows"') ? ([{ x: 1 }] as T[]) : [],
    get: async <T>() => ({ n: 1 }) as T,
    disconnectAndClear: vi.fn(async () => {}),
  }
  await claimLocalDb(raw, 'A')
  synced = true
  local.activateLocalUser('A')
  const facade = local.guardLocalDatabase(raw, 'A')
  const retryBatchId = `${deviceId()}-1`
  const { signOutAndClear } = await import('./signOut')
  const clear = vi.fn(async () => {})
  await signOutAndClear({
    signOut: async () => ({ error: null }),
    pendingUploads: () => local.countLocalUploadsForSignOut(facade, 'A'),
    pendingExports: async () => 0,
    confirm: () => true,
    stopOfflineRunner: async () => {
      throw new Error('stop failed')
    },
    stopExportRunner: async () => {},
    clearOutbox: clear,
    clearOfflinePrefs: clear,
    clearLocalData: clear,
    clearCache: clear,
    toLogin: clear,
  })
  expect(clear).not.toHaveBeenCalled()
  expect(`${deviceId()}-1`).toBe(retryBatchId)
  await expect(facade.get()).rejects.toThrow(/session has changed/)
  await claimLocalDb(raw, 'A')
  local.activateLocalUser('A')
  expect(`${deviceId()}-1`).toBe(retryBatchId)
  expect(raw.disconnectAndClear).not.toHaveBeenCalled()
  await expect(facade.get()).rejects.toThrow(/session has changed/)
})
