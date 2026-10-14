import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, expect, test, vi } from 'vitest'
import { ApiError, api } from '../api/client'
import { clearNotices, getNotices } from '../components/noticeStore'
import { CONFLICT_QUESTION, historyKey, targetOfGroup, useRevert } from './api'

vi.mock('../api/client', async (original) => ({
  ...(await original<typeof import('../api/client')>()),
  api: { get: vi.fn(), post: vi.fn() },
}))

const post = vi.mocked(api.post)
const done = { batchId: 'new', reverted: 1, skipped: [] }

beforeEach(() => {
  post.mockReset()
  clearNotices()
})

function setup(confirm: (q: string) => Promise<boolean>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { ...renderHook(() => useRevert('show-1', confirm), { wrapper }), invalidate }
}

test("a revert posts the target and refreshes the show's history", async () => {
  post.mockResolvedValueOnce(done)
  const confirm = vi.fn()
  const { result, invalidate } = setup(confirm)
  await act(() => result.current.mutateAsync({ seq: 7 }))
  expect(post).toHaveBeenCalledWith('/shows/show-1/revert', { seq: 7 })
  expect(confirm).not.toHaveBeenCalled()
  expect(invalidate).toHaveBeenCalledWith({ queryKey: historyKey('show-1') })
})

test('a conflict asks, and a yes retries with force', async () => {
  post
    .mockRejectedValueOnce(new ApiError(409, 'conflict', 'cues r1 has changed since'))
    .mockResolvedValueOnce(done)
  const confirm = vi.fn(async () => true)
  const { result } = setup(confirm)
  await act(() => result.current.mutateAsync({ batchId: 'b1', userId: 'u1' }))
  expect(confirm).toHaveBeenCalledWith(CONFLICT_QUESTION)
  expect(CONFLICT_QUESTION).toBe('This has changed since. Revert anyway?')
  expect(post).toHaveBeenNthCalledWith(1, '/shows/show-1/revert', { batchId: 'b1', userId: 'u1' })
  expect(post).toHaveBeenNthCalledWith(2, '/shows/show-1/revert', {
    batchId: 'b1',
    userId: 'u1',
    force: true,
  })
})

test('a conflict answered no does nothing more', async () => {
  post.mockRejectedValueOnce(new ApiError(409, 'conflict', 'changed'))
  const { result } = setup(async () => false)
  await act(() => result.current.mutateAsync({ seq: 3 }))
  expect(post).toHaveBeenCalledTimes(1)
  expect(getNotices()).toEqual([])
})

test.each([
  ['forbidden', "You can't revert this change: no edit rights"],
  ['not_found', "That change can't be reverted: gone"],
])('a %s answer is a notice naming the reason and no retry', async (code, message) => {
  post.mockRejectedValueOnce(
    new ApiError(
      code === 'forbidden' ? 403 : 404,
      code,
      code === 'forbidden' ? 'no edit rights' : 'gone',
    ),
  )
  const confirm = vi.fn()
  const { result } = setup(confirm)
  await act(async () => {
    await result.current.mutateAsync({ seq: 3 }).catch(() => {})
  })
  await waitFor(() => expect(getNotices().map((n) => n.message)).toEqual([message]))
  expect(confirm).not.toHaveBeenCalled()
  expect(post).toHaveBeenCalledTimes(1)
})

test('a group without a batch reverts by its one row', () => {
  const group = {
    batchId: null,
    userId: 'u1',
    label: 'A',
    summary: '',
    at: '',
    fromSeq: 4,
    toSeq: 4,
    count: 1,
    via: 'sync' as const,
    agent: null,
  }
  expect(targetOfGroup(group)).toEqual({ seq: 4 })
  expect(targetOfGroup({ ...group, batchId: 'b' })).toEqual({ batchId: 'b', userId: 'u1' })
})
