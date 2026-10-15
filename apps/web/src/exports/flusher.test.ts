import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const get = vi.fn()
const flushOutbox = vi.fn()
vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/client')>()),
  api: { get: (...args: unknown[]) => get(...args) },
}))
vi.mock('./outbox', () => ({ flushOutbox: (...args: unknown[]) => flushOutbox(...args) }))

const { ApiError } = await import('../api/client')
const { RETRY_MS, flushForSession, flushSoon, startOutboxFlusher } = await import('./flusher')

const ME = 'server-user'
const flushed = { sent: 1, kept: 0, dropped: 0 }
let online = true

beforeEach(() => {
  vi.useFakeTimers()
  get.mockReset().mockResolvedValue({ user: { id: ME } })
  flushOutbox.mockReset().mockResolvedValue(flushed)
  online = true
  vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  localStorage.clear()
})

test('flushes the outbox of the id /api/me names, never a remembered one', async () => {
  localStorage.setItem('binder.sessionUser', JSON.stringify({ id: 'remembered-user' }))
  expect(await flushForSession()).toEqual(flushed)
  expect(get).toHaveBeenCalledWith('/me')
  expect(flushOutbox).toHaveBeenCalledOnce()
  expect(flushOutbox).toHaveBeenCalledWith(ME)
})

test('offline: no request and no flush', async () => {
  online = false
  expect(await flushForSession()).toBeNull()
  expect(get).not.toHaveBeenCalled()
  expect(flushOutbox).not.toHaveBeenCalled()
})

test('signed out (401): nothing is flushed and no retry is scheduled', async () => {
  get.mockRejectedValue(new ApiError(401, 'unauthorized', 'not signed in'))
  expect(await flushForSession()).toBeNull()
  expect(flushOutbox).not.toHaveBeenCalled()

  const stop = startOutboxFlusher()
  await vi.advanceTimersByTimeAsync(0)
  expect(flushOutbox).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
  stop()
})

test('any other failure asking the server schedules a retry that asks again', async () => {
  get.mockRejectedValueOnce(new ApiError(503, 'unavailable', 'down'))
  const stop = startOutboxFlusher()
  await vi.advanceTimersByTimeAsync(0)
  expect(get).toHaveBeenCalledTimes(1)
  expect(flushOutbox).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(1)

  await vi.advanceTimersByTimeAsync(RETRY_MS)
  expect(get).toHaveBeenCalledTimes(2)
  expect(flushOutbox).toHaveBeenCalledWith(ME)
  stop()
})

test('a network error asking the server also retries', async () => {
  get.mockRejectedValueOnce(new TypeError('Failed to fetch'))
  expect(await flushForSession()).toBe('retry')
})

test('a flush that throws is logged, resolves to retry, and is retried; nothing is unhandled', async () => {
  flushOutbox.mockRejectedValueOnce(new Error('IndexedDB is closing'))
  const unhandled = vi.fn()
  process.on('unhandledRejection', unhandled)
  const stop = startOutboxFlusher()
  await vi.advanceTimersByTimeAsync(0)
  expect(console.error).toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(1)
  await vi.advanceTimersByTimeAsync(RETRY_MS)
  expect(flushOutbox).toHaveBeenCalledTimes(2)
  process.off('unhandledRejection', unhandled)
  expect(unhandled).not.toHaveBeenCalled()
  stop()
})

test('flushes at start, retries every 30 s while entries are kept, and stops when they are sent', async () => {
  flushOutbox
    .mockResolvedValueOnce({ sent: 0, kept: 1, dropped: 0 })
    .mockResolvedValueOnce({ sent: 0, kept: 1, dropped: 0 })
    .mockResolvedValue(flushed)
  const stop = startOutboxFlusher()
  await vi.advanceTimersByTimeAsync(0)
  expect(flushOutbox).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(RETRY_MS - 1)
  expect(flushOutbox).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1)
  expect(flushOutbox).toHaveBeenCalledTimes(2)
  await vi.advanceTimersByTimeAsync(RETRY_MS)
  expect(flushOutbox).toHaveBeenCalledTimes(3)
  // Everything went up: no timer is left running.
  expect(vi.getTimerCount()).toBe(0)
  stop()
})

test('the online event flushes, and stopping removes the listener and the timer', async () => {
  flushOutbox.mockResolvedValue({ sent: 0, kept: 1, dropped: 0 })
  const stop = startOutboxFlusher()
  await vi.advanceTimersByTimeAsync(0)
  expect(flushOutbox).toHaveBeenCalledTimes(1)

  window.dispatchEvent(new Event('online'))
  await vi.advanceTimersByTimeAsync(0)
  expect(flushOutbox).toHaveBeenCalledTimes(2)
  expect(vi.getTimerCount()).toBe(1)

  stop()
  expect(vi.getTimerCount()).toBe(0)
  window.dispatchEvent(new Event('online'))
  await vi.advanceTimersByTimeAsync(RETRY_MS * 2)
  expect(flushOutbox).toHaveBeenCalledTimes(2)
})

test('flushSoon goes through the started flusher, and works on its own when none is started', async () => {
  flushSoon()
  await vi.advanceTimersByTimeAsync(0)
  expect(flushOutbox).toHaveBeenCalledTimes(1)

  flushOutbox.mockResolvedValue({ sent: 0, kept: 1, dropped: 0 })
  const stop = startOutboxFlusher()
  await vi.advanceTimersByTimeAsync(0)
  flushSoon()
  await vi.advanceTimersByTimeAsync(0)
  expect(flushOutbox).toHaveBeenCalledTimes(3)
  // It was the flusher that ran, so the retry timer is the flusher's.
  expect(vi.getTimerCount()).toBe(1)
  stop()
  expect(vi.getTimerCount()).toBe(0)
})
