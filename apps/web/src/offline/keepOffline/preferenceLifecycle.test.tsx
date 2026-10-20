import 'fake-indexeddb/auto'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import { activateLocalUser, endLocalSession, quiesceLocalWork } from '../../auth/localWork'
import { signOutAndClear } from '../../auth/signOut'
import { KeepOfflineSwitch } from './KeepOfflineSwitch'
import {
  clearOfflinePrefs,
  dropOfflinePref,
  getOfflinePrefs,
  idbOfflinePrefsStore,
  loadOfflinePrefs,
  type OfflinePref,
  setKeepOffline,
  subscribeOfflinePrefs,
} from './store'

const session = vi.hoisted(() => ({ id: 'A' }))
vi.mock('../../auth/session', () => ({ useSessionUser: () => ({ data: { id: session.id } }) }))
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
let counter = 0
beforeEach(() => {
  session.id = `preference-A-${++counter}`
  localStorage.clear()
  localStorage.setItem('binder.localDbOwner', session.id)
  localStorage.setItem('binder.localDbClaim', `claim-${counter}`)
  localStorage.setItem('binder.localDbDevice', 'unchanged-retry-namespace')
  activateLocalUser(session.id)
})

test('P2 actual switch registers before initial IDB load, so sign-out clears the completed write', async () => {
  const userId = session.id
  const store = idbOfflinePrefsStore(userId)
  const list = deferred<[string, OfflinePref][]>()
  const started = deferred<void>()
  vi.spyOn(store, 'list').mockImplementationOnce(() => {
    started.resolve()
    return list.promise
  })
  render(<KeepOfflineSwitch showId="show-before-load" />)
  fireEvent.click(screen.getByRole('switch'))
  await started.promise
  const server = vi.fn(async () => ({ error: null }))
  const clearing = vi.fn(() => clearOfflinePrefs(userId))
  const signout = signOutAndClear({
    signOut: server,
    pendingUploads: async () => 0,
    pendingExports: async () => 0,
    confirm: () => true,
    stopOfflineRunner: async () => {},
    stopExportRunner: async () => {},
    clearOutbox: async () => {},
    clearOfflinePrefs: clearing,
    clearLocalData: async () => {},
    clearCache: () => {},
    toLogin: async () => {},
  })
  for (let i = 0; i < 50; i++) await Promise.resolve()
  const signedOutBeforeLoad = server.mock.calls.length > 0
  await act(async () => {
    list.resolve([])
    await signout
  })
  await waitFor(async () => expect(await store.list()).toEqual([]))
  expect(signedOutBeforeLoad).toBe(false)
  expect(clearing).toHaveBeenCalledOnce()
  expect(getOfflinePrefs().prefs.size).toBe(0)
})

test('P2 revoked claim during initial load rejects before preference write or publication', async () => {
  const list = deferred<[string, OfflinePref][]>()
  const store = {
    ...idbOfflinePrefsStore(session.id),
    list: () => list.promise,
    set: vi.fn(async () => {}),
  }
  const publish = vi.fn()
  const unsubscribe = subscribeOfflinePrefs(publish)
  const operation = setKeepOffline(session.id, 'late-show', true, store)
  const settled = operation.then(
    () => 'resolved',
    () => 'rejected',
  )
  for (let i = 0; i < 10; i++) await Promise.resolve()
  localStorage.setItem('binder.localDbClaim', 'revoked')
  list.resolve([])
  const outcome = await settled
  unsubscribe()
  expect(outcome).toBe('rejected')
  expect(store.set).not.toHaveBeenCalled()
  expect(publish).not.toHaveBeenCalled()
})

test('P2 standalone delayed initial load cannot republish old On preferences after clear', async () => {
  const list = deferred<[string, OfflinePref][]>()
  const store = { ...idbOfflinePrefsStore(session.id), list: () => list.promise }
  const operation = loadOfflinePrefs(session.id, store)
  const settled = operation.then(
    () => 'resolved',
    () => 'rejected',
  )
  localStorage.setItem('binder.localDbClaim', 'revoked')
  await clearOfflinePrefs(session.id)
  list.resolve([['old-show', { on: true, enabledAt: '2026-10-20T00:00:00Z' }]])
  expect(await settled).toBe('rejected')
  expect(getOfflinePrefs().prefs.has('old-show')).toBe(false)
})

test('P2 write already started cannot publish after claim revocation', async () => {
  await loadOfflinePrefs(session.id)
  const written = deferred<void>()
  const started = deferred<void>()
  const store = {
    ...idbOfflinePrefsStore(session.id),
    set: async () => {
      started.resolve()
      await written.promise
    },
  }
  const operation = setKeepOffline(session.id, 'late-write', true, store)
  const settled = operation.then(
    () => 'resolved',
    () => 'rejected',
  )
  await started.promise
  localStorage.setItem('binder.localDbClaim', 'revoked')
  written.resolve()
  expect(await settled).toBe('rejected')
  expect(getOfflinePrefs().prefs.has('late-write')).toBe(false)
})

test('P2 intentional sign-out cleanup remains available under exclusive lock after revocation', async () => {
  await setKeepOffline(session.id, 'cleanup-show', true)
  const release = await quiesceLocalWork()
  try {
    endLocalSession()
    await clearOfflinePrefs(session.id)
    expect(await idbOfflinePrefsStore(session.id).list()).toEqual([])
    expect(getOfflinePrefs().prefs.size).toBe(0)
  } finally {
    await release()
  }
})

test('P2 runner prune nested in a cache commit never queues behind an exclusive waiter', async () => {
  await setKeepOffline(session.id, 'removed-show', true)
  const locks = navigator.locks
  let exclusive!: Promise<unknown>
  const removed = locks.request('binder-local-data', { mode: 'shared' }, async () => {
    // A different tab can queue exclusive sign-out while this tab is pruning.
    exclusive = locks.request('binder-local-data', { mode: 'exclusive' }, async () => {})
    return dropOfflinePref(session.id, 'removed-show').catch(() => {})
  })
  await removed
  await exclusive
  // Wait until the queued exclusive callback has released its lock before retrying.
  await locks.request('binder-local-data', { mode: 'shared' }, async () => {})
  // A transiently busy prune is retryable; after exclusion ends it can remove normally.
  await dropOfflinePref(session.id, 'removed-show')
  expect(await idbOfflinePrefsStore(session.id).list()).toEqual([])
})
