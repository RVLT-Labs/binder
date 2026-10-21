import { act, renderHook } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import { useConnectorStyles, useMarkerSides } from './MarkerSideEditor'
import { updateShowSettings } from './updateShowSettings'

/**
 * A db that behaves like PowerSync for the one thing that matters here: each call takes a
 * macrotask to commit, and `writeTransaction` runs one callback at a time (the write lock).
 * Plain `getOptional` / `execute` on the db itself are NOT serialised, so a read-then-write done
 * as two separate calls can interleave with another one.
 */
let stored: string | null
let lock: Promise<unknown>
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
const rawGet = async () => {
  await tick()
  return { settings: stored }
}
const rawExecute = async (_sql: string, params: unknown[]) => {
  await tick()
  stored = params[0] as string | null
}
const db = {
  getOptional: vi.fn(rawGet),
  execute: vi.fn(rawExecute),
  writeTransaction: vi.fn(async <T,>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
    const run = lock.then(() => fn({ getOptional: rawGet, execute: rawExecute }))
    lock = run.catch(() => undefined)
    return run
  }),
}
vi.mock('@powersync/react', () => ({
  usePowerSync: () => db,
  // The live query is still the old text when the quick second click lands.
  useQuery: () => ({ data: [{ settings: '{"timezone":"Europe/London"}' }] }),
}))

beforeEach(() => {
  stored = '{"timezone":"Europe/London"}'
  lock = Promise.resolve()
  vi.clearAllMocks()
})

test('two quick connector clicks (width, then pattern) both land', async () => {
  const { result } = renderHook(() => useConnectorStyles('s1'))
  await act(async () => {
    await Promise.all([
      result.current.setStyle('d-snd', { width: 'bold' }),
      result.current.setStyle('d-snd', { pattern: 'dashed' }),
    ])
  })
  expect(JSON.parse(stored as string)).toEqual({
    timezone: 'Europe/London',
    connectorStyles: { 'd-snd': { width: 'bold', pattern: 'dashed' } },
  })
})

test('a marker side and a connector style set at the same time both land', async () => {
  const sides = renderHook(() => useMarkerSides('s1'))
  const styles = renderHook(() => useConnectorStyles('s1'))
  await act(async () => {
    await Promise.all([
      sides.result.current.setSide('d-snd', 'right'),
      styles.result.current.setStyle('d-snd', { width: 'medium' }),
    ])
  })
  expect(JSON.parse(stored as string)).toEqual({
    timezone: 'Europe/London',
    markerSides: { 'd-snd': 'right' },
    connectorStyles: { 'd-snd': { width: 'medium', pattern: 'solid' } },
  })
})

test('updateShowSettings hands the transform the stored text and writes its result for that show', async () => {
  stored = '{"paperSize":"Letter"}'
  const seen: Array<string | null> = []
  await updateShowSettings(db as never, 's1', (current) => {
    seen.push(current)
    return '{"paperSize":"A4"}'
  })
  expect(seen).toEqual(['{"paperSize":"Letter"}'])
  expect(db.execute).not.toHaveBeenCalled() // the write went through the transaction, not the db
  expect(stored).toBe('{"paperSize":"A4"}')
})

test('updateShowSettings does nothing, and does not call the transform, when the show row is missing', async () => {
  const missing = {
    writeTransaction: async <T,>(fn: (tx: unknown) => Promise<T>) =>
      fn({ getOptional: async () => null, execute: vi.fn() }),
  }
  const transform = vi.fn(() => '{}')
  await updateShowSettings(missing as never, 'gone', transform)
  expect(transform).not.toHaveBeenCalled()
})
