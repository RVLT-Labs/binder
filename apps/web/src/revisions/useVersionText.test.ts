import type { WordLayer } from '@binder/shared'
import { expect, test, vi } from 'vitest'
import { createVersionTextCache, type PageInfo, readVersionText } from './useVersionText'

const layer: WordLayer = { words: [{ t: 'a', x: 0, y: 0, w: 1, h: 1 }], lines: [[0]] }
const page = (index: number, key: string | null): PageInfo => ({
  index,
  width: 100,
  height: 200,
  words_key: key,
})

test('pages whose layer cannot be read are counted, and pages without a words key are not', async () => {
  const load = vi.fn(async (key: string) => (key === 'k1' ? null : layer))
  const out = await readVersionText('v', 'd', [page(0, 'k0'), page(1, 'k1'), page(2, null)], load)
  expect(out.unavailable).toBe(1)
  expect([...out.text.layers.keys()]).toEqual([0])
  expect(out.text.pageCount).toBe(3)
})

test('an incomplete result is never cached: the next use reads again and can complete', async () => {
  let online = false
  const load = vi.fn(async () => (online ? layer : null))
  const cache = createVersionTextCache(3, load)
  const pages = [page(0, 'k0'), page(1, 'k1')]
  expect((await cache.get('v', 'd', pages)).unavailable).toBe(2)
  expect(cache.size()).toBe(0)
  online = true
  const again = await cache.get('v', 'd', pages)
  expect(again.unavailable).toBe(0)
  expect(load).toHaveBeenCalledTimes(4)
  // Complete: kept, so a third use reads nothing.
  await cache.get('v', 'd', pages)
  expect(load).toHaveBeenCalledTimes(4)
})

test('only the most recently used versions are kept; the least recently used goes first', async () => {
  const load = vi.fn(async () => layer)
  const cache = createVersionTextCache(2, load)
  const p = (key: string) => [page(0, key)]
  await cache.get('v1', 'd', p('a'))
  await cache.get('v2', 'd', p('b'))
  await cache.get('v1', 'd', p('a')) // v1 is now the most recent
  await cache.get('v3', 'd', p('c')) // evicts v2
  expect(cache.size()).toBe(2)
  load.mockClear()
  await cache.get('v1', 'd', p('a'))
  expect(load).not.toHaveBeenCalled()
  await cache.get('v2', 'd', p('b'))
  expect(load).toHaveBeenCalledTimes(1)
})
