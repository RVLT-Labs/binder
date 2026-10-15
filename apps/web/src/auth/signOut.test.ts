import { beforeEach, expect, test, vi } from 'vitest'
import { clearNotices, getNotices } from '../components/noticeStore'
import { signOutAndClear } from './signOut'

beforeEach(() => clearNotices())

function deps(signOut: () => Promise<{ error: { message?: string } | null }>) {
  return {
    signOut: vi.fn(signOut),
    clearLocalData: vi.fn(async () => {}),
    clearOutbox: vi.fn(async () => {}),
    clearCache: vi.fn(),
    toLogin: vi.fn(async () => {}),
    pendingUploads: vi.fn(async () => 0),
    confirm: vi.fn(() => true),
  }
}

test('signs out on the server, then clears local data and goes to login', async () => {
  const d = deps(async () => ({ error: null }))
  await signOutAndClear(d)
  expect(d.clearLocalData).toHaveBeenCalledOnce()
  expect(d.clearOutbox).toHaveBeenCalledOnce()
  expect(d.clearCache).toHaveBeenCalledOnce()
  expect(d.toLogin).toHaveBeenCalledOnce()
  expect(d.signOut.mock.invocationCallOrder[0]).toBeLessThan(
    d.clearLocalData.mock.invocationCallOrder[0],
  )
})

test('keeps local data and the session when the server refuses sign-out', async () => {
  const d = deps(async () => ({ error: { message: 'Internal error' } }))
  await signOutAndClear(d)
  expect(d.clearLocalData).not.toHaveBeenCalled()
  expect(d.clearOutbox).not.toHaveBeenCalled()
  expect(d.clearCache).not.toHaveBeenCalled()
  expect(d.toLogin).not.toHaveBeenCalled()
  expect(getNotices()).toEqual([
    expect.objectContaining({
      kind: 'error',
      message: expect.stringContaining('Could not sign out'),
    }),
  ])
})

test('keeps local data when the sign-out request cannot be sent (offline)', async () => {
  const d = deps(async () => {
    throw new TypeError('Failed to fetch')
  })
  await expect(signOutAndClear(d)).resolves.toBeUndefined()
  expect(d.clearLocalData).not.toHaveBeenCalled()
  expect(getNotices()).toHaveLength(1)
})

test('a failing outbox clear does not stop the sign-out', async () => {
  const d = deps(async () => ({ error: null }))
  d.clearOutbox.mockRejectedValue(new Error('IndexedDB is blocked'))
  vi.spyOn(console, 'error').mockImplementation(() => {})
  await signOutAndClear(d)
  expect(d.clearLocalData).toHaveBeenCalledOnce()
  expect(d.toLogin).toHaveBeenCalledOnce()
})

test('with changes still waiting to upload, asks first and signs out only on yes', async () => {
  const d = deps(async () => ({ error: null }))
  d.pendingUploads.mockResolvedValue(3)
  await signOutAndClear(d)
  expect(d.confirm).toHaveBeenCalledWith("3 changes haven't uploaded yet. Sign out anyway?")
  expect(d.signOut).toHaveBeenCalledOnce()
  expect(d.clearLocalData).toHaveBeenCalledOnce()
  expect(d.toLogin).toHaveBeenCalledOnce()
})

test('says "1 change hasn\'t" for a single pending change', async () => {
  const d = deps(async () => ({ error: null }))
  d.pendingUploads.mockResolvedValue(1)
  await signOutAndClear(d)
  expect(d.confirm).toHaveBeenCalledWith("1 change hasn't uploaded yet. Sign out anyway?")
})

test('a no leaves the session and every local row alone', async () => {
  const d = deps(async () => ({ error: null }))
  d.pendingUploads.mockResolvedValue(2)
  d.confirm.mockReturnValue(false)
  await signOutAndClear(d)
  expect(d.signOut).not.toHaveBeenCalled()
  expect(d.clearOutbox).not.toHaveBeenCalled()
  expect(d.clearLocalData).not.toHaveBeenCalled()
  expect(d.clearCache).not.toHaveBeenCalled()
  expect(d.toLogin).not.toHaveBeenCalled()
  expect(getNotices()).toEqual([])
})

test('nothing pending means no question', async () => {
  const d = deps(async () => ({ error: null }))
  await signOutAndClear(d)
  expect(d.confirm).not.toHaveBeenCalled()
  expect(d.toLogin).toHaveBeenCalledOnce()
})

test('a queue that cannot be counted does not stop the sign-out', async () => {
  const d = deps(async () => ({ error: null }))
  d.pendingUploads.mockRejectedValue(new Error('database is closed'))
  vi.spyOn(console, 'error').mockImplementation(() => {})
  await signOutAndClear(d)
  expect(d.confirm).not.toHaveBeenCalled()
  expect(d.toLogin).toHaveBeenCalledOnce()
})
