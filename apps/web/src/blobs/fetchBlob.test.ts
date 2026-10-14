import { beforeEach, expect, test, vi } from 'vitest'
import { blobUrl, clearBlobCache, fetchBlob } from './fetchBlob'

const URL_ = '/blobs/shows/s/documents/d/versions/v/searchable.pdf'

function fakeCache(entries: Record<string, Response> = {}) {
  return {
    match: vi.fn(async (url: string) => entries[url]?.clone()),
    put: vi.fn(async (url: string, res: Response) => {
      entries[url] = res
    }),
  }
}

function stubCaches(cache: ReturnType<typeof fakeCache> | 'refuses' | undefined) {
  const open = vi.fn(async () => {
    if (cache === 'refuses') throw new DOMException('The operation is insecure.', 'SecurityError')
    return cache
  })
  vi.stubGlobal(
    'caches',
    cache === undefined ? undefined : { open, delete: vi.fn(async () => true) },
  )
  return open
}

const network = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>()
beforeEach(() => {
  network.mockReset()
  vi.stubGlobal('fetch', network)
})

test('serves a cached blob without touching the network', async () => {
  const cache = fakeCache({ [URL_]: new Response('cached', { status: 200 }) })
  const open = stubCaches(cache)
  const res = await fetchBlob(URL_)
  expect(await res.text()).toBe('cached')
  expect(open).toHaveBeenCalledWith('blobs-v1')
  expect(network).not.toHaveBeenCalled()
})

test('fetches a miss with credentials and caches a 200', async () => {
  const cache = fakeCache()
  stubCaches(cache)
  network.mockResolvedValue(new Response('pdf bytes', { status: 200 }))
  const res = await fetchBlob(URL_)
  expect(await res.text()).toBe('pdf bytes')
  expect(network).toHaveBeenCalledWith(URL_, { credentials: 'include' })
  expect(cache.put).toHaveBeenCalledOnce()
  expect(cache.put.mock.calls[0][0]).toBe(URL_)
  expect(await cache.put.mock.calls[0][1].text()).toBe('pdf bytes')
})

test.each([404, 403, 500])('does not cache a %i response', async (status) => {
  const cache = fakeCache()
  stubCaches(cache)
  network.mockResolvedValue(new Response('{"message":"no"}', { status }))
  const res = await fetchBlob(URL_)
  expect(res.status).toBe(status)
  expect(cache.put).not.toHaveBeenCalled()
})

test('falls back to the network when the Cache API throws', async () => {
  stubCaches('refuses')
  network.mockResolvedValue(new Response('fresh', { status: 200 }))
  expect(await (await fetchBlob(URL_)).text()).toBe('fresh')
})

test('falls back to the network when a cache lookup throws', async () => {
  const cache = fakeCache()
  cache.match.mockRejectedValue(new Error('quota'))
  cache.put.mockRejectedValue(new Error('quota'))
  stubCaches(cache)
  network.mockResolvedValue(new Response('fresh', { status: 200 }))
  expect(await (await fetchBlob(URL_)).text()).toBe('fresh')
})

test('works where there is no Cache API at all', async () => {
  stubCaches(undefined)
  network.mockResolvedValue(new Response('fresh', { status: 200 }))
  expect(await (await fetchBlob(URL_)).text()).toBe('fresh')
})

test('clearBlobCache deletes the cache and tolerates a missing Cache API', async () => {
  stubCaches(fakeCache())
  await clearBlobCache()
  expect(caches.delete).toHaveBeenCalledWith('blobs-v1')
  stubCaches(undefined)
  await expect(clearBlobCache()).resolves.toBeUndefined()
})

test('blobUrl encodes each key segment', () =>
  expect(blobUrl('shows/a b/pages/0/thumb.png')).toBe('/blobs/shows/a%20b/pages/0/thumb.png'))
