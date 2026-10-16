import { renderHook } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { useWakeLock } from './useWakeLock'

function stubWakeLock() {
  const sentinels: { release: ReturnType<typeof vi.fn>; released: boolean }[] = []
  const request = vi.fn(async () => {
    const s = { released: false, release: vi.fn(async () => {}) }
    s.release.mockImplementation(async () => {
      s.released = true
    })
    sentinels.push(s)
    return s
  })
  vi.stubGlobal('navigator', { ...navigator, wakeLock: { request } })
  return { request, sentinels }
}
const flush = () => new Promise((r) => setTimeout(r, 0))
const setVisibility = (state: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state })
  document.dispatchEvent(new Event('visibilitychange'))
}

afterEach(() => setVisibility('visible'))

test('requests a screen lock while active and releases it when it ends', async () => {
  const { request, sentinels } = stubWakeLock()
  const { rerender } = renderHook(({ on }) => useWakeLock(on), { initialProps: { on: false } })
  await flush()
  expect(request).not.toHaveBeenCalled()

  rerender({ on: true })
  await flush()
  expect(request).toHaveBeenCalledWith('screen')
  expect(request).toHaveBeenCalledTimes(1)

  rerender({ on: false })
  await flush()
  expect(sentinels[0]?.released).toBe(true)
})

test('takes the lock again when the page becomes visible, because hiding released it', async () => {
  const { request, sentinels } = stubWakeLock()
  renderHook(() => useWakeLock(true))
  await flush()
  expect(request).toHaveBeenCalledTimes(1)

  // The browser drops the lock itself when the page is hidden.
  setVisibility('hidden')
  await flush()
  expect(request).toHaveBeenCalledTimes(1)
  setVisibility('visible')
  await flush()
  expect(request).toHaveBeenCalledTimes(2)
  expect(sentinels).toHaveLength(2)
})

test('releases the lock on unmount, and a lock granted after leaving is released at once', async () => {
  const { sentinels } = stubWakeLock()
  const { unmount } = renderHook(() => useWakeLock(true))
  await flush()
  unmount()
  await flush()
  expect(sentinels[0]?.released).toBe(true)

  // Request still pending while the hook unmounts: the late grant must not leak.
  let grant: (s: unknown) => void = () => {}
  const late = { released: false, release: vi.fn(async () => {}) }
  vi.stubGlobal('navigator', {
    wakeLock: { request: () => new Promise((r) => (grant = r)) },
  })
  const second = renderHook(() => useWakeLock(true))
  second.unmount()
  grant(late)
  await flush()
  expect(late.release).toHaveBeenCalled()
})

test('does nothing, and does not throw, where the Wake Lock API is missing or refuses', async () => {
  vi.stubGlobal('navigator', {})
  expect(() => renderHook(() => useWakeLock(true))).not.toThrow()

  vi.stubGlobal('navigator', {
    wakeLock: {
      request: vi.fn(async () => {
        throw new Error('NotAllowedError')
      }),
    },
  })
  const { unmount } = renderHook(() => useWakeLock(true))
  await flush()
  expect(() => unmount()).not.toThrow()
})
