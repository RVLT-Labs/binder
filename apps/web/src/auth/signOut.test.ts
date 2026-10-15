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
