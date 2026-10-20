import { expect, test, vi } from 'vitest'
import { api } from './client'

test('round4 API options attach original expected account without changing cookie or JSON behavior', async () => {
  const fetcher = vi.fn(async () => Response.json({ ok: true }))
  vi.stubGlobal('fetch', fetcher)
  await api.post('/sync/upload', { batchId: 'stable-7' }, { expectedUserId: 'A' })
  await api.get('/sync/token', { expectedUserId: 'A' })
  await api.post('/ordinary', { value: 1 })
  expect(fetcher.mock.calls).toEqual([
    [
      '/api/sync/upload',
      expect.objectContaining({
        credentials: 'include',
        body: JSON.stringify({ batchId: 'stable-7' }),
        headers: { 'content-type': 'application/json', 'X-Binder-Expected-User': 'A' },
      }),
    ],
    [
      '/api/sync/token',
      expect.objectContaining({
        credentials: 'include',
        headers: { 'X-Binder-Expected-User': 'A' },
      }),
    ],
    ['/api/ordinary', expect.objectContaining({ headers: { 'content-type': 'application/json' } })],
  ])
})
