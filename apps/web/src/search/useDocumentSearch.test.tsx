import type { WordLayer } from '@binder/shared'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import { useDocumentSearch } from './useDocumentSearch'

const getAll = vi.fn()
vi.mock('@powersync/react', () => ({ usePowerSync: () => ({ getAll }) }))

const layer = (...words: string[]): WordLayer => ({
  words: words.map((t, i) => ({ t, x: i * 10, y: 20, w: 9, h: 8 })),
  lines: [words.map((_, i) => i)],
})
const wordsKey = (i: number) => `shows/s/documents/d/versions/v1/pages/${i}/words.json`
const layers: Record<string, WordLayer | undefined> = {
  [`/blobs/${wordsKey(0)}`]: layer('The', 'Pirate', 'King'),
  [`/blobs/${wordsKey(1)}`]: layer('no', 'match', 'here'),
  [`/blobs/${wordsKey(2)}`]: layer('pirate', 'ship'),
}

const network = vi.fn<(url: string) => Promise<Response>>()
beforeEach(() => {
  getAll.mockReset()
  getAll.mockResolvedValue([0, 1, 2].map((i) => ({ index: i, words_key: wordsKey(i) })))
  network.mockReset()
  network.mockImplementation(async (url) => {
    const found = layers[url]
    return found ? Response.json(found) : new Response('gone', { status: 404 })
  })
  vi.stubGlobal('fetch', network)
  vi.stubGlobal('caches', undefined)
})

test('searches every page of the version and returns hits with page index and snippet', async () => {
  const { result } = renderHook(() => useDocumentSearch('v1'))
  let hits: Awaited<ReturnType<typeof result.current.search>> = []
  await act(async () => {
    hits = await result.current.search('pirate')
  })
  expect(hits.map((h) => [h.pageIndex, h.wordStart, h.snippet])).toEqual([
    [0, 1, 'The Pirate King'],
    [2, 0, 'pirate ship'],
  ])
  expect(getAll.mock.calls[0][1]).toEqual(['v1'])
})

test('loads each words.json once however many searches run', async () => {
  const { result } = renderHook(() => useDocumentSearch('v1'))
  await act(async () => {
    await Promise.all([result.current.search('pirate'), result.current.search('king')])
    await result.current.search('ship')
  })
  expect(network).toHaveBeenCalledTimes(3)
})

test('reports loading while the words load, then exposes the layers for highlighting', async () => {
  const { result } = renderHook(() => useDocumentSearch('v1'))
  expect(result.current.loading).toBe(false)
  expect(result.current.layers).toBeNull()
  let pending!: Promise<unknown>
  act(() => {
    pending = result.current.search('pirate')
  })
  expect(result.current.loading).toBe(true)
  await act(async () => {
    await pending
  })
  expect(result.current.loading).toBe(false)
  expect(result.current.layers?.get(0)?.words[1].t).toBe('Pirate')
})

test('a page whose words cannot be loaded is skipped and counted, not fatal', async () => {
  layers[`/blobs/${wordsKey(1)}`] = undefined
  getAll.mockResolvedValue([
    { index: 0, words_key: wordsKey(0) },
    { index: 1, words_key: wordsKey(1) },
    { index: 2, words_key: null },
  ])
  const { result } = renderHook(() => useDocumentSearch('v1'))
  let hits: unknown[] = []
  await act(async () => {
    hits = await result.current.search('pirate')
  })
  expect(hits).toHaveLength(1)
  expect(result.current.unavailable).toBe(2)
})

test('a different version loads its own words', async () => {
  const { result, rerender } = renderHook(({ id }) => useDocumentSearch(id), {
    initialProps: { id: 'v1' },
  })
  await act(async () => {
    await result.current.search('pirate')
  })
  rerender({ id: 'v2' })
  await waitFor(() => expect(result.current.layers).toBeNull())
  await act(async () => {
    await result.current.search('pirate')
  })
  expect(getAll.mock.calls.map((c) => c[1][0])).toEqual(['v1', 'v2'])
})

test('a failed database read can be retried', async () => {
  getAll.mockRejectedValueOnce(new Error('db closed'))
  const { result } = renderHook(() => useDocumentSearch('v1'))
  await act(async () => {
    await expect(result.current.search('pirate')).rejects.toThrow('db closed')
  })
  let hits: unknown[] = []
  await act(async () => {
    hits = await result.current.search('pirate')
  })
  expect(hits).toHaveLength(2)
})
