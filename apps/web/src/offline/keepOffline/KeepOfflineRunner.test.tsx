import { act, render, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { KeepOfflineRunner as Runner, RunnerInput, ShowStatus } from './runner'

const h = vi.hoisted(() => ({
  db: { getAll: async () => [] },
  asked: [] as string[],
  empty: { data: [] as unknown[], isLoading: false },
  hasSynced: false,
  queries: new Map<string, { data: unknown[]; isLoading: boolean }>(),
  prefs: { userId: null as string | null, prefs: new Map<string, unknown>() },
  loadFails: false,
  runners: [] as unknown[],
  onStored: undefined as undefined | (() => void),
}))

const SHOWS = 'SELECT id FROM shows'
const setQuery = (sql: string, data: unknown[], isLoading = false) =>
  h.queries.set(sql, { data, isLoading })

vi.mock('@powersync/react', () => ({
  usePowerSync: () => h.db,
  useStatus: () => ({ hasSynced: h.hasSynced }),
  useQuery: (sql: string) => {
    h.asked.push(sql)
    return h.queries.get(sql) ?? h.empty
  },
}))
vi.mock('./store', () => ({
  useOfflinePrefs: () => h.prefs,
  loadOfflinePrefs: vi.fn(async (userId: string) => {
    if (h.loadFails) throw new Error('indexeddb unavailable')
    h.prefs = { ...h.prefs, userId }
  }),
}))
vi.mock('./browser', () => ({
  browserRunnerDeps: (opts: { onStored?: () => void }) => {
    h.onStored = opts.onStored
    return {}
  },
}))
vi.mock('./active', () => ({ setActiveRunner: vi.fn() }))
vi.mock('../cacheStatus', () => ({ blobCacheChanged: vi.fn() }))
vi.mock('./runner', () => ({
  createKeepOfflineRunner: () => {
    const listeners = new Set<() => void>()
    let status: ReadonlyMap<string, ShowStatus> = new Map()
    const runner = {
      update: vi.fn<(input: RunnerInput) => void>(),
      notifySync: vi.fn<(signature: string) => void>(),
      resume: vi.fn(),
      stop: vi.fn(async () => {}),
      whenIdle: async () => {},
      getStatus: () => status,
      subscribe: (l: () => void) => {
        listeners.add(l)
        return () => listeners.delete(l)
      },
      setStatus(next: ReadonlyMap<string, ShowStatus>) {
        status = next
        for (const l of listeners) l()
      },
    }
    h.runners.push(runner)
    return runner
  },
}))

import { blobCacheChanged } from '../cacheStatus'
import { setActiveRunner } from './active'
import { KeepOfflineRunner, PAGES_SQL, VERSIONS_SQL } from './KeepOfflineRunner'
import { useKeepOfflineStatus } from './status'

const current = () =>
  h.runners.at(-1) as Runner & { setStatus(m: ReadonlyMap<string, ShowStatus>): void }
const lastUpdate = () => vi.mocked(current().update).mock.calls.at(-1)?.[0]

beforeEach(() => {
  h.hasSynced = false
  h.queries.clear()
  h.prefs = { userId: 'u1', prefs: new Map([['s1', { on: true, enabledAt: '2026-01-01' }]]) }
  h.loadFails = false
  h.runners.length = 0
  h.asked.length = 0
  vi.clearAllMocks()
})
afterEach(() => vi.restoreAllMocks())

test('passes localShows = null until the first sync has landed, so an empty table prunes nothing', async () => {
  // The local table is empty and loaded, but no sync has landed yet.
  setQuery(SHOWS, [])
  const view = render(<KeepOfflineRunner userId="u1" />)
  await act(async () => {})
  expect(lastUpdate()).toEqual({ enabled: ['s1'], localShows: null })

  // Synced, but the shows query has not answered yet: still null.
  h.hasSynced = true
  setQuery(SHOWS, [], true)
  view.rerender(<KeepOfflineRunner userId="u1" />)
  expect(lastUpdate()?.localShows).toBeNull()

  // Synced and answered: the set of local shows.
  setQuery(SHOWS, [{ id: 's1' }, { id: 's2' }])
  view.rerender(<KeepOfflineRunner userId="u1" />)
  expect(lastUpdate()?.localShows).toEqual(new Set(['s1', 's2']))
})

test('synced, with an earlier [] answer still standing while the query refetches: no prune', async () => {
  // The shows query answered [] before the first sync and keeps that answer (isLoading false)
  // while it refetches; hasSynced flips to true in the meantime.
  setQuery(SHOWS, [])
  const view = render(<KeepOfflineRunner userId="u1" />)
  await act(async () => {})
  h.hasSynced = true
  view.rerender(<KeepOfflineRunner userId="u1" />)
  expect(lastUpdate()).toEqual({ enabled: ['s1'], localShows: null })
  for (const call of vi.mocked(current().update).mock.calls) expect(call[0].localShows).toBeNull()
  // The refetch lands.
  setQuery(SHOWS, [{ id: 's1' }])
  view.rerender(<KeepOfflineRunner userId="u1" />)
  expect(lastUpdate()?.localShows).toEqual(new Set(['s1']))
})

test('loads the preferences before it updates the runner, and survives a failed load', async () => {
  h.prefs = { userId: null, prefs: new Map() }
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  h.loadFails = true
  render(<KeepOfflineRunner userId="u1" />)
  await act(async () => {})
  expect(error).toHaveBeenCalled()
  // Nothing was loaded for this user, so the runner was told nothing.
  expect(current().update).not.toHaveBeenCalled()
})

test('does not call notifySync until the sync queries have loaded', () => {
  setQuery(VERSIONS_SQL, [], true)
  const view = render(<KeepOfflineRunner userId="u1" />)
  expect(current().notifySync).not.toHaveBeenCalled()
  setQuery(VERSIONS_SQL, [{ id: 'v1', show_id: 's1', searchable_key: 'k1' }])
  view.rerender(<KeepOfflineRunner userId="u1" />)
  expect(current().notifySync).toHaveBeenCalledOnce()
})

test('the signature follows the ready versions, not the preferences', () => {
  const rows = [{ id: 'v1', show_id: 's1', searchable_key: 'k1' }]
  setQuery(VERSIONS_SQL, rows)
  const view = render(<KeepOfflineRunner userId="u1" />)
  const sig = () => vi.mocked(current().notifySync).mock.calls.map((c) => c[0])
  expect(sig()).toHaveLength(1)
  // Switching another show on is not a sync change.
  h.prefs = {
    ...h.prefs,
    prefs: new Map([...h.prefs.prefs, ['s2', { on: true, enabledAt: '2026-01-02' }]]),
  }
  view.rerender(<KeepOfflineRunner userId="u1" />)
  expect(new Set(sig()).size).toBe(1)
  // A new ready version is.
  setQuery(VERSIONS_SQL, [...rows, { id: 'v2', show_id: 's1', searchable_key: 'k2' }])
  view.rerender(<KeepOfflineRunner userId="u1" />)
  expect(new Set(sig()).size).toBe(2)
})

test('the app-wide sync queries are not watched while no show is On', () => {
  h.prefs = { userId: 'u1', prefs: new Map() }
  const view = render(<KeepOfflineRunner userId="u1" />)
  expect(h.asked).not.toContain(PAGES_SQL)
  expect(h.asked).not.toContain(VERSIONS_SQL)
  expect(current().notifySync).not.toHaveBeenCalled()
  h.prefs = { userId: 'u1', prefs: new Map([['s1', { on: true, enabledAt: '2026-01-01' }]]) }
  view.rerender(<KeepOfflineRunner userId="u1" />)
  expect(h.asked).toContain(PAGES_SQL)
})

test('registers the runner for sign-out, and unregisters and stops it on unmount', async () => {
  const view = render(<KeepOfflineRunner userId="u1" />)
  const runner = current()
  expect(setActiveRunner).toHaveBeenCalledWith(runner)
  view.unmount()
  expect(setActiveRunner).toHaveBeenLastCalledWith(null)
  expect(runner.stop).toHaveBeenCalled()
})

test('the online event and the page becoming visible resume the runner; hidden does not', () => {
  render(<KeepOfflineRunner userId="u1" />)
  window.dispatchEvent(new Event('online'))
  expect(current().resume).toHaveBeenCalledTimes(1)
  const visibility = vi.spyOn(document, 'visibilityState', 'get')
  visibility.mockReturnValue('hidden')
  document.dispatchEvent(new Event('visibilitychange'))
  expect(current().resume).toHaveBeenCalledTimes(1)
  visibility.mockReturnValue('visible')
  document.dispatchEvent(new Event('visibilitychange'))
  expect(current().resume).toHaveBeenCalledTimes(2)
})

test('stored blobs notify the blob cache, and the runner status reaches the status store', () => {
  render(<KeepOfflineRunner userId="u1" />)
  const seen = renderHook(() => useKeepOfflineStatus('s1'))
  h.onStored?.()
  expect(blobCacheChanged).toHaveBeenCalledOnce()
  const status: ShowStatus = { state: 'working', total: 5, missing: 3, failed: 0 }
  act(() => current().setStatus(new Map([['s1', status]])))
  expect(seen.result.current).toEqual(status)
})
