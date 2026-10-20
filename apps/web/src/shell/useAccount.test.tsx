import { renderHook } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import { activateLocalUser, disposeLocalDatabase, guardLocalDatabase } from '../auth/localWork'
import { useAccount } from './useAccount'

const h = vi.hoisted(() => ({
  signOut: vi.fn(async () => ({ error: null })),
  clear: vi.fn(async () => {}),
  pending: vi.fn(async (): Promise<unknown[]> => []),
  db: { get: async <T,>() => ({ n: 0 }) as T },
}))
vi.mock('@powersync/react', () => ({ usePowerSync: () => h.db }))
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ clear: vi.fn() }) }))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn(async () => {}) }))
vi.mock('@/auth/client', () => ({ authClient: { signOut: () => h.signOut() } }))
vi.mock('@/auth/session', () => ({
  useSessionUser: () => ({
    data: { id: 'disposable-one', email: 'one@example.test', name: 'One' },
  }),
}))
vi.mock('@/powersync/provider', () => ({ clearLocalData: () => h.clear() }))
vi.mock('@/exports/outbox', () => ({
  clearOutbox: () => h.clear(),
  pendingExports: () => h.pending(),
  stopExportUploads: async () => {},
}))
vi.mock('@/offline/keepOffline/active', () => ({ stopKeepOffline: async () => {} }))
vi.mock('@/offline/keepOffline/store', () => ({ clearOfflinePrefs: async () => {} }))
beforeEach(() => {
  vi.clearAllMocks()
  h.pending.mockResolvedValue([])
  h.signOut.mockResolvedValue({ error: null })
  localStorage.clear()
  localStorage.setItem('binder.localDbOwner', 'disposable-one')
  localStorage.setItem('binder.localDbDevice', 'account-test-ticket')
  activateLocalUser('disposable-one')
  h.db = guardLocalDatabase({ get: async <T,>() => ({ n: 0 }) as T }, 'disposable-one')
})

test('B13 a stale account cannot sign out or clear another tab’s newly claimed local database', async () => {
  localStorage.setItem('binder.localDbOwner', 'disposable-two')
  const { result } = renderHook(useAccount)
  await result.current.signOut(vi.fn(async () => true))
  expect(h.signOut).not.toHaveBeenCalled()
  expect(h.clear).not.toHaveBeenCalled()
})

test('B13 the verified owner can sign out when both queues are empty', async () => {
  localStorage.setItem('binder.localDbOwner', 'disposable-one')
  const { result } = renderHook(useAccount)
  const confirm = vi.fn(async () => true)
  await result.current.signOut(confirm)
  expect(confirm).not.toHaveBeenCalled()
  expect(h.signOut).toHaveBeenCalledOnce()
  expect(h.clear).toHaveBeenCalledTimes(2)
})

test('B13 the verified owner is warned about export-only waiting work and cancel preserves it', async () => {
  localStorage.setItem('binder.localDbOwner', 'disposable-one')
  h.pending.mockResolvedValue([{ id: 'disposable-export' }])
  const { result } = renderHook(useAccount)
  const confirm = vi.fn(async () => false)
  await result.current.signOut(confirm)
  expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/1 pending export/))
  expect(h.signOut).not.toHaveBeenCalled()
  expect(h.clear).not.toHaveBeenCalled()
})

test('R2 sign-out final counts work after actual provider disposal without restoring stale reads', async () => {
  const original = h.db
  h.signOut.mockImplementation(async () => {
    disposeLocalDatabase(original) // Better Auth's session transition unmounts the provider.
    return { error: null }
  })
  const { result } = renderHook(useAccount)
  await result.current.signOut(vi.fn(async () => true))
  expect(h.signOut).toHaveBeenCalledOnce()
  expect(h.clear).toHaveBeenCalledTimes(2)
  await expect(original.get()).rejects.toThrow(/session has changed/)
})
