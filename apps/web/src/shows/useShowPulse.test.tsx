import type { ShowLastChange, ShowPresence } from '@binder/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { api } from '../api/client'
import { useShowPulse } from './useShowPulse'

vi.mock('../api/client', async (original) => ({
  ...(await original<typeof import('../api/client')>()),
  api: { get: vi.fn() },
}))

const online = { value: true }
vi.mock('../offline/useOnline', () => ({ useOnline: () => online.value }))

const get = vi.mocked(api.get)
const presence: { shows: Record<string, ShowPresence> } = {
  shows: {
    s1: { people: [{ userId: 'u2', name: 'Mikaela', colour: '#5b8def', departments: ['LX'] }] },
  },
}
const change: ShowLastChange = {
  at: '2026-10-16T11:48:00Z',
  userId: 'u2',
  label: 'Mikaela',
  summary: 'relabelled 3 LX cues',
  sentence: 'LX relabelled 3 cues',
  count: 3,
  via: 'web',
  agent: null,
  batchId: 'b1',
}

const calls = (path: string) => get.mock.calls.filter(([p]) => p === path).length

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, ...renderHook(() => useShowPulse(), { wrapper }) }
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false })
  online.value = true
  get.mockReset()
  get.mockImplementation(async (path: string) =>
    path === '/me/shows/presence' ? presence : { shows: { s1: change } },
  )
})
afterEach(() => vi.useRealTimers())

const settle = () => act(() => vi.advanceTimersByTimeAsync(0))

test('polls presence every 15 s and stops when offline', async () => {
  const { result, rerender } = setup()
  await settle()
  expect(calls('/me/shows/presence')).toBe(1)
  expect(result.current.presence?.s1.people[0].name).toBe('Mikaela')

  await act(() => vi.advanceTimersByTimeAsync(15_000))
  expect(calls('/me/shows/presence')).toBe(2)
  await act(() => vi.advanceTimersByTimeAsync(15_000))
  expect(calls('/me/shows/presence')).toBe(3)

  // Offline: no more requests, and no presence is drawn (the cached answer is not shown).
  online.value = false
  rerender()
  await act(() => vi.advanceTimersByTimeAsync(60_000))
  expect(calls('/me/shows/presence')).toBe(3)
  expect(result.current.presence).toBeUndefined()
  expect(result.current.lastChanges).toBeUndefined()

  // Back online: it asks again at once.
  online.value = true
  rerender()
  await settle()
  expect(calls('/me/shows/presence')).toBe(4)
  expect(result.current.presence?.s1.people).toHaveLength(1)
})

test('last changes are fetched once up front, then every 60 s', async () => {
  const { result } = setup()
  await settle()
  expect(calls('/me/shows/last-changes')).toBe(1)
  expect(result.current.lastChanges?.s1?.sentence).toBe('LX relabelled 3 cues')
  await act(() => vi.advanceTimersByTimeAsync(59_000))
  expect(calls('/me/shows/last-changes')).toBe(1)
  await act(() => vi.advanceTimersByTimeAsync(1_000))
  expect(calls('/me/shows/last-changes')).toBe(2)
})

test('nothing is asked offline from the start', async () => {
  online.value = false
  const { result } = setup()
  await settle()
  expect(get).not.toHaveBeenCalled()
  expect(result.current.presence).toBeUndefined()
})

test("both keys sit under ['home'], so the sign-out clear drops them", async () => {
  const { client } = setup()
  await settle()
  const keys = client
    .getQueryCache()
    .getAll()
    .map((q) => q.queryKey)
  expect(keys).toEqual([
    ['home', 'presence'],
    ['home', 'last-changes'],
  ])
})
