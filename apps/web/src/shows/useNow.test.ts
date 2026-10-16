import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useNow } from './useNow'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-16T12:00:00Z'))
})
afterEach(() => vi.useRealTimers())

test('ticks every interval so relative times stay current', () => {
  const { result } = renderHook(() => useNow(60_000))
  expect(result.current.toISOString()).toBe('2026-10-16T12:00:00.000Z')
  act(() => {
    vi.advanceTimersByTime(60_000)
  })
  expect(result.current.toISOString()).toBe('2026-10-16T12:01:00.000Z')
})

test('stops ticking when unmounted', () => {
  const { unmount } = renderHook(() => useNow(60_000))
  unmount()
  expect(vi.getTimerCount()).toBe(0)
})
