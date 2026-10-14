import { beforeEach, expect, test, vi } from 'vitest'
import { ApiError } from '../api/client'
import { fetchSessionUser, forgetSessionUser } from './session'

const alice = { id: 'u1', email: 'alice@example.test', name: 'Alice' }
const get = vi.fn()
vi.mock('../api/client', async (orig) => ({
  ...(await orig<typeof import('../api/client')>()),
  api: { get: (...args: unknown[]) => get(...args) },
}))

beforeEach(() => {
  get.mockReset()
  localStorage.clear()
})

test('returns the signed-in user and remembers them for the next offline start', async () => {
  get.mockResolvedValue({ user: alice })
  expect(await fetchSessionUser()).toEqual(alice)
  get.mockRejectedValue(new TypeError('Failed to fetch'))
  expect(await fetchSessionUser()).toEqual(alice)
})

test('stays signed in from the remembered user when the server cannot be reached or is failing', async () => {
  get.mockResolvedValueOnce({ user: alice })
  await fetchSessionUser()
  get.mockRejectedValue(new ApiError(502, 'unknown', 'bad gateway'))
  expect(await fetchSessionUser()).toEqual(alice)
})

test('a server that says 401 means signed out, and forgets the remembered user', async () => {
  get.mockResolvedValueOnce({ user: alice })
  await fetchSessionUser()
  get.mockRejectedValue(new ApiError(401, 'unauthorized', 'no session'))
  expect(await fetchSessionUser()).toBeNull()
  get.mockRejectedValue(new TypeError('Failed to fetch'))
  await expect(fetchSessionUser()).rejects.toThrow('Failed to fetch')
})

test('with nobody remembered, an unreachable server is an error', async () => {
  get.mockRejectedValue(new TypeError('Failed to fetch'))
  await expect(fetchSessionUser()).rejects.toThrow('Failed to fetch')
})

test('forgetSessionUser makes the next offline start signed out', async () => {
  get.mockResolvedValueOnce({ user: alice })
  await fetchSessionUser()
  forgetSessionUser()
  get.mockRejectedValue(new TypeError('Failed to fetch'))
  await expect(fetchSessionUser()).rejects.toThrow()
})

test('ignores a corrupt remembered value and blocked storage', async () => {
  localStorage.setItem('binder.sessionUser', '{not json')
  get.mockRejectedValue(new TypeError('Failed to fetch'))
  await expect(fetchSessionUser()).rejects.toThrow('Failed to fetch')
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('blocked', 'SecurityError')
  })
  get.mockResolvedValue({ user: alice })
  expect(await fetchSessionUser()).toEqual(alice)
})
