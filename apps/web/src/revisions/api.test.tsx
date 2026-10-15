import type { Anchor } from '@binder/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, expect, test, vi } from 'vitest'
import { ApiError, api } from '../api/client'
import { clearNotices, getNotices } from '../components/noticeStore'
import { reviewErrorMessage, useResolveItem } from './api'

vi.mock('../api/client', async (original) => ({
  ...(await original<typeof import('../api/client')>()),
  api: { get: vi.fn(), post: vi.fn() },
}))

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

beforeEach(() => {
  clearNotices()
  vi.mocked(api.post).mockReset()
})

const input = { table: 'cues' as const, rowId: 'c1', action: 'accept' as const }

test('the server’s refusal reason becomes a notice, whichever reason it is', async () => {
  const { result } = renderHook(() => useResolveItem('d1'), { wrapper: wrapper() })
  vi.mocked(api.post).mockRejectedValueOnce(
    new ApiError(403, 'forbidden', 'You cannot edit the SND layer'),
  )
  await act(async () => {
    await result.current.mutateAsync(input).catch(() => {})
  })
  expect(getNotices().map((n) => n.message)).toEqual([
    "You can't accept this item: You cannot edit the SND layer",
  ])

  clearNotices()
  vi.mocked(api.post).mockRejectedValueOnce(
    new ApiError(409, 'archived', 'This show is archived and read-only'),
  )
  await act(async () => {
    await result.current.mutateAsync(input).catch(() => {})
  })
  expect(getNotices()[0]?.message).toBe(
    'Could not accept this item: This show is archived and read-only',
  )
})

test('a successful action posts the table, row and action to the document’s review route', async () => {
  const anchor = { status: 'ok' } as Anchor
  vi.mocked(api.post).mockResolvedValueOnce({ anchor })
  const { result } = renderHook(() => useResolveItem('d1'), { wrapper: wrapper() })
  await act(async () => {
    result.current.mutate({ table: 'annotations', rowId: 'a1', action: 'reanchor' })
  })
  await waitFor(() => expect(result.current.isSuccess).toBe(true))
  expect(api.post).toHaveBeenCalledWith('/documents/d1/review', {
    table: 'annotations',
    rowId: 'a1',
    action: 'reanchor',
  })
  expect(getNotices()).toEqual([])
})

test('review error messages name the action', () => {
  expect(reviewErrorMessage('revert', new ApiError(400, 'invalid', 'nothing to revert to'))).toBe(
    'Could not revert this item: nothing to revert to',
  )
  expect(reviewErrorMessage('reanchor', new Error('offline'))).toBe(
    'Could not re-anchor this item: offline',
  )
})
