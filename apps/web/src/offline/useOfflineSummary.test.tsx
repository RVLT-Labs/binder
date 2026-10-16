import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { blobCacheChanged } from './cacheStatus'
import { READY_VERSIONS_SQL, RESCAN_DELAY_MS, useOfflineSummary } from './useOfflineSummary'

const state = vi.hoisted(() => ({
  ready: 1,
  sql: [] as string[],
  load: vi.fn(),
  db: {},
}))

vi.mock('@powersync/react', () => ({
  usePowerSync: () => state.db,
  useQuery: (sql: string) => {
    state.sql.push(sql)
    return { data: [{ k: state.ready }] }
  },
}))
vi.mock('./prefetch', () => ({
  loadShowBlobRows: (...args: unknown[]) => state.load(...args),
  blobUrlsForShow: () => ['/blobs/a', '/blobs/b'],
}))
vi.mock('../blobs/fetchBlob', () => ({ isBlobCached: async (u: string) => u === '/blobs/a' }))

beforeEach(() => {
  vi.useFakeTimers()
  state.ready = 1
  state.sql = []
  state.load = vi.fn(async () => ({ versions: [], pages: [], documents: [] }))
})
afterEach(() => vi.useRealTimers())

const settle = () => act(async () => void (await vi.advanceTimersByTimeAsync(RESCAN_DELAY_MS + 10)))

test('counts what is cached against what a full offline copy holds', async () => {
  const { result } = renderHook(() => useOfflineSummary('s1'))
  await settle()
  expect(result.current).toEqual({ total: 2, cached: 1 })
})

test('watches only ready versions: no page rows are in the trigger query', () => {
  renderHook(() => useOfflineSummary('s1'))
  expect(state.sql[0]).toBe(READY_VERSIONS_SQL)
  expect(READY_VERSIONS_SQL).not.toMatch(/pages|thumb_key/)
})

test('re-rendering as pages of a processing version arrive does not scan the cache again', async () => {
  const { rerender } = renderHook(() => useOfflineSummary('s1'))
  await settle()
  expect(state.load).toHaveBeenCalledTimes(1)
  // Page rows changing leave the ready-version count where it was.
  for (let i = 0; i < 5; i++) rerender()
  await settle()
  expect(state.load).toHaveBeenCalledTimes(1)
})

test('a version becoming ready scans again, after the changes settle', async () => {
  const { rerender } = renderHook(() => useOfflineSummary('s1'))
  await settle()
  state.ready = 2
  rerender()
  // Not yet: the scan waits for a burst of changes to end.
  await act(async () => void (await vi.advanceTimersByTimeAsync(RESCAN_DELAY_MS - 100)))
  expect(state.load).toHaveBeenCalledTimes(1)
  await settle()
  expect(state.load).toHaveBeenCalledTimes(2)
})

test('several changes in a burst make one scan', async () => {
  const { rerender } = renderHook(() => useOfflineSummary('s1'))
  await settle()
  state.ready = 2
  rerender()
  await act(async () => void (await vi.advanceTimersByTimeAsync(200)))
  state.ready = 3
  rerender()
  act(() => blobCacheChanged())
  await settle()
  expect(state.load).toHaveBeenCalledTimes(2)
})
