import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { blobUrl } from '../../blobs/fetchBlob'
import type { ShowBlobRows } from '../prefetch'
import { createKeepOfflineRunner, type KeepOfflineRunner, type RunnerDeps } from './runner'

const MB = 1024 * 1024
const GB = 1024 * MB

const base = (show: string, doc: string, v: string) =>
  `shows/${show}/documents/${doc}/versions/${v}`
const searchable = (show: string, doc: string, v: string) =>
  `/blobs/${base(show, doc, v)}/searchable.pdf`
const thumb = (show: string, doc: string, v: string, i: number) =>
  `/blobs/${base(show, doc, v)}/pages/${i}/thumb.png`

/** One document with the given ready versions (oldest first) and one page each; the last is current. */
function showRows(show: string, doc: string, versions: string[]): ShowBlobRows {
  return {
    versions: versions.map((id, i) => ({
      id,
      document_id: doc,
      version_number: i + 1,
      status: 'ready' as const,
      searchable_key: `${base(show, doc, id)}/searchable.pdf`,
    })),
    pages: versions.map((id) => ({
      document_version_id: id,
      thumb_key: `${base(show, doc, id)}/pages/0/thumb.png`,
      words_key: null,
    })),
    documents: [{ id: doc, current_version_id: versions[versions.length - 1] }],
  }
}

interface Harness {
  deps: RunnerDeps
  runner: KeepOfflineRunner
  cache: Set<string>
  rows: Record<string, ShowBlobRows>
  fetchStarted: string[]
  state: { online: boolean; saveData: boolean }
  put: ReturnType<typeof vi.fn>
  fetchBlob: ReturnType<typeof vi.fn>
}

function setup(over: Partial<RunnerDeps> = {}): Harness {
  const cache = new Set<string>()
  const rows: Record<string, ShowBlobRows> = {}
  const state = { online: true, saveData: false }
  const fetchStarted: string[] = []
  const fetchBlob = vi.fn(async (url: string) => {
    fetchStarted.push(url)
    return new Response('bytes', { status: 200 })
  })
  const put = vi.fn(async (url: string) => void cache.add(url))
  const deps: RunnerDeps = {
    loadRows: async (id) => rows[id] ?? { versions: [], pages: [] },
    cachedUrls: async () => new Set(cache),
    fetchBlob,
    putBlob: put,
    deleteShowBlobs: vi.fn(async (id: string) => {
      for (const u of [...cache]) if (u.startsWith(`/blobs/shows/${id}/documents/`)) cache.delete(u)
    }),
    dropPreference: vi.fn(async () => {}),
    estimate: async () => ({ usage: 0, quota: 10 * GB }),
    isOnline: () => state.online,
    saveData: () => state.saveData,
    locks: undefined,
    ...over,
  }
  const runner = createKeepOfflineRunner(deps)
  return { deps, runner, cache, rows, fetchStarted, state, put, fetchBlob }
}

let h: Harness
beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(async () => {
  await h?.runner.stop()
  vi.useRealTimers()
})

const on = (...ids: string[]) => ({ enabled: ids, localShows: null })

test('fetches only missing urls, current version first', async () => {
  h = setup()
  h.rows.s = showRows('s', 'd', ['v1', 'v2'])
  h.cache.add(searchable('s', 'd', 'v1'))
  h.runner.update(on('s'))
  await h.runner.whenIdle()
  // v2 is current so it goes first; v1's searchable pdf was already cached.
  expect(h.fetchStarted).toEqual([
    searchable('s', 'd', 'v2'),
    thumb('s', 'd', 'v2', 0),
    thumb('s', 'd', 'v1', 0),
  ])
  expect(h.runner.getStatus().get('s')).toEqual({ state: 'idle', total: 4, missing: 0, failed: 0 })
})

test('works through a show two files at a time', async () => {
  let inFlight = 0
  let peak = 0
  h = setup()
  h.fetchBlob.mockImplementation(async () => {
    inFlight++
    peak = Math.max(peak, inFlight)
    await Promise.resolve()
    await Promise.resolve()
    inFlight--
    return new Response('x', { status: 200 })
  })
  h.rows.s = showRows('s', 'd', ['v1', 'v2', 'v3', 'v4'])
  h.runner.update(on('s'))
  await h.runner.whenIdle()
  expect(h.put).toHaveBeenCalledTimes(8)
  expect(peak).toBe(2)
})

test('a new ready version is fetched after the sync signature changes', async () => {
  h = setup()
  h.rows.s = showRows('s', 'd', ['v1'])
  h.runner.update(on('s'))
  h.runner.notifySync('sig-1')
  await h.runner.whenIdle()
  expect(h.fetchStarted).toHaveLength(2)

  h.rows.s = showRows('s', 'd', ['v1', 'v2'])
  h.runner.notifySync('sig-1') // same signature: nothing to do
  await vi.advanceTimersByTimeAsync(5_000)
  expect(h.fetchStarted).toHaveLength(2)

  h.runner.notifySync('sig-2')
  await vi.advanceTimersByTimeAsync(1_999)
  expect(h.fetchStarted).toHaveLength(2) // debounced by 2 s
  await vi.advanceTimersByTimeAsync(1)
  await h.runner.whenIdle()
  expect(h.fetchStarted.slice(2)).toEqual([searchable('s', 'd', 'v2'), thumb('s', 'd', 'v2', 0)])
})

test('Off stops in-flight fetches and keeps cached blobs', async () => {
  const signals: AbortSignal[] = []
  h = setup()
  h.fetchBlob.mockImplementation(
    (_url: string, signal: AbortSignal) =>
      new Promise<Response>((_res, rej) => {
        signals.push(signal)
        signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))
      }),
  )
  h.rows.s = showRows('s', 'd', ['v1', 'v2'])
  h.cache.add(searchable('s', 'd', 'v1'))
  h.runner.update(on('s'))
  await vi.advanceTimersByTimeAsync(0)
  expect(signals).toHaveLength(2)

  h.runner.update(on())
  await h.runner.whenIdle()
  expect(signals.every((s) => s.aborted)).toBe(true)
  expect(h.put).not.toHaveBeenCalled()
  expect(h.deps.deleteShowBlobs).not.toHaveBeenCalled()
  expect(h.cache.has(searchable('s', 'd', 'v1'))).toBe(true)
  expect(h.runner.getStatus().has('s')).toBe(false)
})

test('offline waits and resumes on online', async () => {
  h = setup()
  h.state.online = false
  h.rows.s = showRows('s', 'd', ['v1'])
  h.runner.update(on('s'))
  await h.runner.whenIdle()
  expect(h.fetchBlob).not.toHaveBeenCalled()
  expect(h.runner.getStatus().get('s')).toEqual({
    state: 'offline',
    total: 2,
    missing: 2,
    failed: 0,
  })
  // Offline is not a failure: no retry timer runs while the network is away.
  await vi.advanceTimersByTimeAsync(11 * 60_000)
  expect(h.fetchBlob).not.toHaveBeenCalled()

  h.state.online = true
  h.runner.resume()
  await h.runner.whenIdle()
  expect(h.fetchStarted).toHaveLength(2)
  expect(h.runner.getStatus().get('s')?.state).toBe('idle')
})

test('a fetch that fails because the network dropped waits for online instead of backing off', async () => {
  h = setup()
  h.rows.s = showRows('s', 'd', ['v1'])
  h.fetchBlob.mockImplementation(async () => {
    h.state.online = false
    throw new TypeError('Failed to fetch')
  })
  h.runner.update(on('s'))
  await h.runner.whenIdle()
  expect(h.runner.getStatus().get('s')?.state).toBe('offline')
  const calls = h.fetchBlob.mock.calls.length
  await vi.advanceTimersByTimeAsync(11 * 60_000)
  expect(h.fetchBlob).toHaveBeenCalledTimes(calls)
})

test('saveData pauses', async () => {
  h = setup()
  h.state.saveData = true
  h.rows.s = showRows('s', 'd', ['v1'])
  h.runner.update(on('s'))
  await h.runner.whenIdle()
  expect(h.fetchBlob).not.toHaveBeenCalled()
  expect(h.runner.getStatus().get('s')).toEqual({
    state: 'paused',
    total: 2,
    missing: 2,
    failed: 0,
  })
  h.state.saveData = false
  h.runner.resume()
  await h.runner.whenIdle()
  expect(h.fetchStarted).toHaveLength(2)
})

test('a quota error stops with state full and keeps what was stored', async () => {
  h = setup()
  h.rows.s = showRows('s', 'd', ['v1', 'v2', 'v3', 'v4'])
  let n = 0
  h.put.mockImplementation(async (url: string) => {
    if (++n > 3) throw new DOMException('quota', 'QuotaExceededError')
    h.cache.add(url)
  })
  h.runner.update(on('s'))
  await h.runner.whenIdle()
  const status = h.runner.getStatus().get('s')
  expect(status?.state).toBe('full')
  expect(status?.missing).toBe(5)
  expect(h.cache.size).toBe(3)
  // Stopped: nothing past the failing batch was tried.
  expect(h.fetchBlob.mock.calls.length).toBeLessThanOrEqual(5)
})

test('low estimate headroom stops with state full', async () => {
  // 100 MB free of 10 GB: under the larger of 150 MB and 10 % of quota.
  h = setup({ estimate: async () => ({ usage: 10 * GB - 100 * MB, quota: 10 * GB }) })
  h.rows.s = showRows('s', 'd', ['v1'])
  h.runner.update(on('s'))
  await h.runner.whenIdle()
  expect(h.fetchBlob).not.toHaveBeenCalled()
  expect(h.runner.getStatus().get('s')).toEqual({ state: 'full', total: 2, missing: 2, failed: 0 })
})

test('headroom is the larger of 150 MB and 10 % of the quota', async () => {
  // 1 GB quota: 10 % is 100 MB, so the 150 MB floor applies. 160 MB free passes, 140 MB fails.
  h = setup({ estimate: async () => ({ usage: 1 * GB - 160 * MB, quota: 1 * GB }) })
  h.rows.s = showRows('s', 'd', ['v1'])
  h.runner.update(on('s'))
  await h.runner.whenIdle()
  expect(h.fetchBlob).toHaveBeenCalled()
  await h.runner.stop()

  h = setup({ estimate: async () => ({ usage: 1 * GB - 140 * MB, quota: 1 * GB }) })
  h.rows.s = showRows('s', 'd', ['v1'])
  h.runner.update(on('s'))
  await h.runner.whenIdle()
  expect(h.fetchBlob).not.toHaveBeenCalled()
})

test('no estimate support means no headroom check', async () => {
  h = setup({ estimate: async () => undefined })
  h.rows.s = showRows('s', 'd', ['v1'])
  h.runner.update(on('s'))
  await h.runner.whenIdle()
  expect(h.fetchBlob).toHaveBeenCalled()
})

test('failures back off 30 s then 2 min then 10 min and reset on a sync change', async () => {
  h = setup()
  h.rows.s = showRows('s', 'd', ['v1'])
  h.fetchBlob.mockRejectedValue(new Error('the server answered 503'))
  h.runner.update(on('s'))
  await h.runner.whenIdle()
  // Each pass tries both files once (the pool has 2 workers).
  const passes = () => h.fetchBlob.mock.calls.length / 2
  expect(passes()).toBe(1)
  expect(h.runner.getStatus().get('s')).toEqual({
    state: 'failed',
    total: 2,
    missing: 2,
    failed: 2,
  })

  await vi.advanceTimersByTimeAsync(29_999)
  expect(passes()).toBe(1)
  await vi.advanceTimersByTimeAsync(1)
  expect(passes()).toBe(2)

  await vi.advanceTimersByTimeAsync(119_999)
  expect(passes()).toBe(2)
  await vi.advanceTimersByTimeAsync(1)
  expect(passes()).toBe(3)

  await vi.advanceTimersByTimeAsync(599_999)
  expect(passes()).toBe(3)
  await vi.advanceTimersByTimeAsync(1)
  expect(passes()).toBe(4)

  // Capped at 10 minutes.
  await vi.advanceTimersByTimeAsync(600_000)
  expect(passes()).toBe(5)

  // A sync change resets the ladder: the next retry is 30 s again.
  h.runner.notifySync('first')
  h.runner.notifySync('second')
  await vi.advanceTimersByTimeAsync(2_000)
  expect(passes()).toBe(6)
  await vi.advanceTimersByTimeAsync(30_000)
  expect(passes()).toBe(7)
})

test('online resets the backoff and retries at once', async () => {
  h = setup()
  h.rows.s = showRows('s', 'd', ['v1'])
  h.fetchBlob.mockRejectedValue(new Error('the server answered 503'))
  h.runner.update(on('s'))
  await h.runner.whenIdle()
  await vi.advanceTimersByTimeAsync(30_000) // second pass, next wait is 2 min
  h.fetchBlob.mockImplementation(async () => new Response('x', { status: 200 }))
  h.runner.resume()
  await h.runner.whenIdle()
  expect(h.runner.getStatus().get('s')?.state).toBe('idle')
})

test("a removed show's preference and blobs are dropped", async () => {
  h = setup()
  h.rows.a = showRows('a', 'd', ['v1'])
  h.rows.gone = showRows('gone', 'd', ['v1'])
  h.cache.add(searchable('gone', 'd', 'v1'))
  h.cache.add(searchable('a', 'd', 'v1'))
  h.runner.update({ enabled: ['a', 'gone'], localShows: new Set(['a']) })
  await h.runner.whenIdle()
  expect(h.deps.dropPreference).toHaveBeenCalledWith('gone')
  expect(h.deps.dropPreference).not.toHaveBeenCalledWith('a')
  expect(h.deps.deleteShowBlobs).toHaveBeenCalledWith('gone')
  expect(h.cache.has(searchable('gone', 'd', 'v1'))).toBe(false)
  expect(h.cache.has(searchable('a', 'd', 'v1'))).toBe(true)
  expect(h.runner.getStatus().has('gone')).toBe(false)
})

test('nothing is pruned until the local shows are known', async () => {
  h = setup()
  h.rows.a = showRows('a', 'd', ['v1'])
  h.runner.update({ enabled: ['a'], localShows: null })
  await h.runner.whenIdle()
  expect(h.deps.dropPreference).not.toHaveBeenCalled()
  expect(h.deps.deleteShowBlobs).not.toHaveBeenCalled()
})

test('a late put after stop is discarded', async () => {
  let release!: (r: Response) => void
  h = setup()
  h.fetchBlob.mockImplementation(
    () =>
      new Promise<Response>((resolve) => {
        release = resolve // ignores the abort signal, like a fetch that was already past headers
      }),
  )
  h.rows.s = showRows('s', 'd', ['v1'])
  h.runner.update(on('s'))
  await vi.advanceTimersByTimeAsync(0)
  expect(h.fetchBlob).toHaveBeenCalled()

  await h.runner.stop() // resolves without waiting for the stuck fetch
  const body = new Response('late', { status: 200 })
  release(body)
  await vi.advanceTimersByTimeAsync(0)
  expect(h.put).not.toHaveBeenCalled()
  expect(h.cache.size).toBe(0)
})

test('stop waits for a put that has begun, so the cache can be cleared after it', async () => {
  const finishers: (() => void)[] = []
  const finishPut = () => {
    for (const f of finishers) f()
  }
  h = setup()
  h.put.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finishers.push(resolve)
      }),
  )
  h.rows.s = showRows('s', 'd', ['v1'])
  h.runner.update(on('s'))
  await vi.advanceTimersByTimeAsync(0)
  let stopped = false
  void h.runner.stop().then(() => {
    stopped = true
  })
  await vi.advanceTimersByTimeAsync(0)
  expect(stopped).toBe(false)
  finishPut()
  await vi.advanceTimersByTimeAsync(0)
  expect(stopped).toBe(true)
})

test('a stopped runner ignores updates and timers', async () => {
  h = setup()
  h.rows.s = showRows('s', 'd', ['v1'])
  h.fetchBlob.mockRejectedValue(new Error('503'))
  h.runner.update(on('s'))
  await h.runner.whenIdle()
  await h.runner.stop()
  const calls = h.fetchBlob.mock.calls.length
  h.runner.update(on('s'))
  h.runner.resume()
  await vi.advanceTimersByTimeAsync(20 * 60_000)
  expect(h.fetchBlob.mock.calls.length).toBe(calls)
})

test('only the Web Locks leader fetches; a tab refused the lock shows no progress', async () => {
  const request = vi.fn(
    async (_name: string, _o: { ifAvailable: true }, cb: (lock: unknown) => Promise<unknown>) =>
      cb(null),
  )
  h = setup({ locks: { request } as unknown as RunnerDeps['locks'] })
  h.rows.s = showRows('s', 'd', ['v1'])
  h.runner.update(on('s'))
  await h.runner.whenIdle()
  expect(request).toHaveBeenCalledWith(
    'binder-keep-offline',
    { ifAvailable: true },
    expect.any(Function),
  )
  expect(h.fetchBlob).not.toHaveBeenCalled()
  expect(h.runner.getStatus().size).toBe(0)

  request.mockImplementation(async (_n, _o, cb) => cb({ name: 'binder-keep-offline' }))
  h.runner.resume()
  await h.runner.whenIdle()
  expect(h.fetchBlob).toHaveBeenCalled()
})

test('a browser that cannot take the lock runs the pass anyway', async () => {
  h = setup({
    locks: {
      request: async () => {
        throw new Error('SecurityError')
      },
    } as unknown as RunnerDeps['locks'],
  })
  h.rows.s = showRows('s', 'd', ['v1'])
  h.runner.update(on('s'))
  await h.runner.whenIdle()
  expect(h.fetchBlob).toHaveBeenCalled()
})

test('switching a second show on mid-run catches it up without waiting for the first', async () => {
  h = setup()
  h.rows.a = showRows('a', 'd', ['v1', 'v2', 'v3', 'v4', 'v5', 'v6'])
  h.rows.b = showRows('b', 'd', ['v1'])
  h.runner.update(on('a'))
  await vi.advanceTimersByTimeAsync(0)
  h.runner.update(on('a', 'b'))
  await h.runner.whenIdle()
  expect(h.cache.has(searchable('b', 'd', 'v1'))).toBe(true)
  expect(h.cache.has(searchable('a', 'd', 'v6'))).toBe(true)
})

test('status listeners hear every change', async () => {
  h = setup()
  h.rows.s = showRows('s', 'd', ['v1'])
  const seen: string[] = []
  h.runner.subscribe(() => seen.push(h.runner.getStatus().get('s')?.state ?? 'none'))
  h.runner.update(on('s'))
  await h.runner.whenIdle()
  expect(seen).toContain('working')
  expect(seen[seen.length - 1]).toBe('idle')
})

test('blobUrl paths from keys match the cache listing format', () => {
  expect(blobUrl('shows/s/documents/d/versions/v1/searchable.pdf')).toBe(searchable('s', 'd', 'v1'))
})
