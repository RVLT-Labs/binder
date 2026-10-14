import { beforeEach, expect, test, vi } from 'vitest'
import { fetchBlob } from '../blobs/fetchBlob'
import { blobUrlsForShow, prefetchShow } from './prefetch'

const base = (v: string) => `shows/s/documents/d/versions/${v}`
const version = (id: string, status: string, searchable = true) => ({
  id,
  status,
  searchable_key: searchable ? `${base(id)}/searchable.pdf` : null,
})
const page = (versionId: string, index: number, keys = true) => ({
  document_version_id: versionId,
  thumb_key: keys ? `${base(versionId)}/pages/${index}/thumb.png` : null,
  words_key: keys ? `${base(versionId)}/pages/${index}/words.json` : null,
})

test('blobUrlsForShow lists searchable pdf, thumbs, and words for ready versions only', () => {
  const urls = blobUrlsForShow({
    versions: [
      version('v1', 'ready'),
      version('v2', 'processing'),
      version('v3', 'failed'),
      version('v4', 'queued'),
    ],
    pages: [page('v1', 0), page('v1', 1), page('v2', 0), page('v3', 0), page('v4', 0)],
  })
  expect(urls).toEqual([
    `/blobs/${base('v1')}/searchable.pdf`,
    `/blobs/${base('v1')}/pages/0/thumb.png`,
    `/blobs/${base('v1')}/pages/0/words.json`,
    `/blobs/${base('v1')}/pages/1/thumb.png`,
    `/blobs/${base('v1')}/pages/1/words.json`,
  ])
})

test('blobUrlsForShow skips missing keys and lists nothing twice', () => {
  const urls = blobUrlsForShow({
    versions: [version('v1', 'ready'), version('v2', 'ready', false)],
    pages: [page('v1', 0), page('v1', 0), page('v1', 1, false), page('v2', 0)],
  })
  expect(urls).toEqual([
    `/blobs/${base('v1')}/searchable.pdf`,
    `/blobs/${base('v1')}/pages/0/thumb.png`,
    `/blobs/${base('v1')}/pages/0/words.json`,
    `/blobs/${base('v2')}/pages/0/thumb.png`,
    `/blobs/${base('v2')}/pages/0/words.json`,
  ])
})

test('blobUrlsForShow lists nothing for a show with no ready versions', () => {
  expect(blobUrlsForShow({ versions: [], pages: [] })).toEqual([])
})

function fakeCache(entries: Record<string, Response> = {}) {
  return {
    entries,
    match: vi.fn(async (url: string) => entries[url]?.clone()),
    put: vi.fn(async (url: string, res: Response) => {
      entries[url] = new Response(await res.arrayBuffer())
    }),
  }
}

/** Rows as the local database returns them: one versions query, one pages query. */
function fakeDb(rows: { versions: unknown[]; pages: unknown[] }) {
  const calls: [string, unknown[] | undefined][] = []
  return {
    calls,
    async getAll<T>(sql: string, params?: unknown[]) {
      calls.push([sql, params])
      return (sql.includes('FROM pages') ? rows.pages : rows.versions) as T[]
    },
  }
}

const network = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>()
const persist = vi.fn<() => Promise<boolean>>()
let cache: ReturnType<typeof fakeCache>

beforeEach(() => {
  network.mockReset()
  network.mockImplementation(async (url) => new Response(`bytes of ${url}`, { status: 200 }))
  persist.mockReset()
  persist.mockResolvedValue(true)
  cache = fakeCache()
  vi.stubGlobal('fetch', network)
  vi.stubGlobal('caches', { open: vi.fn(async () => cache) })
  vi.stubGlobal('navigator', { storage: { persist } })
})

const rows = {
  versions: [version('v1', 'ready'), version('v2', 'processing')],
  pages: [page('v1', 0), page('v1', 1), page('v2', 0)],
}

test('prefetchShow requests persistent storage before fetching anything', async () => {
  await prefetchShow(fakeDb(rows), 'show-1', () => {})
  expect(persist).toHaveBeenCalledOnce()
  expect(persist.mock.invocationCallOrder[0]).toBeLessThan(network.mock.invocationCallOrder[0])
})

test('prefetchShow stores every blob where fetchBlob finds it later, and reports progress', async () => {
  const progress: [number, number][] = []
  const result = await prefetchShow(fakeDb(rows), 'show-1', (p) => progress.push([p.done, p.total]))
  expect(result).toEqual({ fetched: 5, failed: [] })
  expect(network).toHaveBeenCalledTimes(5)
  expect(progress.at(0)).toEqual([0, 5])
  expect(progress.at(-1)).toEqual([5, 5])
  expect(progress.map(([done]) => done)).toEqual([...progress.map(([done]) => done)].sort())

  // The same cache and key space the viewer reads: no further network request.
  network.mockClear()
  const url = `/blobs/${base('v1')}/pages/1/words.json`
  expect(await (await fetchBlob(url)).text()).toBe(`bytes of ${url}`)
  expect(network).not.toHaveBeenCalled()
})

test('prefetchShow scopes its queries to the show', async () => {
  const db = fakeDb(rows)
  await prefetchShow(db, 'show-1', () => {})
  expect(db.calls).toHaveLength(2)
  for (const [, params] of db.calls) expect(params).toEqual(['show-1'])
})

test('prefetchShow does not fetch what is already cached', async () => {
  const cached = `/blobs/${base('v1')}/searchable.pdf`
  cache.entries[cached] = new Response('already here')
  const result = await prefetchShow(fakeDb(rows), 'show-1', () => {})
  expect(result).toEqual({ fetched: 5, failed: [] })
  expect(network).toHaveBeenCalledTimes(4)
  expect(network.mock.calls.map(([u]) => u)).not.toContain(cached)
})

test('prefetchShow lists individual failures and carries on', async () => {
  const missing = `/blobs/${base('v1')}/pages/0/thumb.png`
  const broken = `/blobs/${base('v1')}/pages/1/words.json`
  network.mockImplementation(async (url) => {
    if (url === missing) return new Response('nope', { status: 404 })
    if (url === broken) throw new TypeError('Failed to fetch')
    return new Response('ok', { status: 200 })
  })
  const result = await prefetchShow(fakeDb(rows), 'show-1', () => {})
  expect(result.fetched).toBe(3)
  expect([...result.failed].sort()).toEqual([broken, missing].sort())
})

test('prefetchShow reports every blob as failed where the browser has no Cache API', async () => {
  vi.stubGlobal('caches', undefined)
  const result = await prefetchShow(fakeDb(rows), 'show-1', () => {})
  expect(result.fetched).toBe(0)
  expect(result.failed).toHaveLength(5)
  expect(network).not.toHaveBeenCalled()
})

test('prefetchShow still runs when persistent storage is refused or unsupported', async () => {
  persist.mockRejectedValue(new Error('denied'))
  expect((await prefetchShow(fakeDb(rows), 'show-1', () => {})).fetched).toBe(5)
  vi.stubGlobal('navigator', {})
  cache = fakeCache()
  expect((await prefetchShow(fakeDb(rows), 'show-1', () => {})).fetched).toBe(5)
})

test('prefetchShow with nothing ready finishes immediately', async () => {
  const result = await prefetchShow(
    fakeDb({ versions: [version('v2', 'processing')], pages: [] }),
    'show-1',
    () => {},
  )
  expect(result).toEqual({ fetched: 0, failed: [] })
})
