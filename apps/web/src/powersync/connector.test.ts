import { type CommonPowerSyncDatabase, type CrudEntry, UpdateType } from '@powersync/web'
import { beforeEach, expect, test, vi } from 'vitest'
import { clearNotices, getNotices } from '../components/noticeStore'
import { ApiConnector, toCrudEntries } from './connector'

beforeEach(() => clearNotices())

const entry = (e: Partial<CrudEntry>) => e as CrudEntry

test('maps PowerSync crud entries to the wire format', () => {
  const entries = toCrudEntries([
    entry({ op: UpdateType.PATCH, table: 'shows', id: 'a', opData: { title: 'B' } }),
  ])
  expect(entries).toEqual([{ table: 'shows', id: 'a', op: 'PATCH', data: { title: 'B' } }])
})

test('maps every op and omits data when there is none', () => {
  const crud = [
    entry({ op: UpdateType.PUT, table: 'documents', id: 'p', opData: { title: 'T' } }),
    entry({ op: UpdateType.DELETE, table: 'documents', id: 'd' }),
  ]
  expect(toCrudEntries(crud)).toEqual([
    { table: 'documents', id: 'p', op: 'PUT', data: { title: 'T' } },
    { table: 'documents', id: 'd', op: 'DELETE' },
  ])
})

function fakeDb(
  tx: { crud: CrudEntry[]; transactionId?: number; complete: () => Promise<void> } | null,
) {
  return { getNextCrudTransaction: async () => tx } as unknown as CommonPowerSyncDatabase
}

const patch = entry({ op: UpdateType.PATCH, table: 'shows', id: 's1', opData: { title: 'Nope' } })

test('uploads a transaction, records rejections as notices, and completes it', async () => {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
    Response.json({
      applied: 0,
      rejected: [
        { index: 0, table: 'shows', id: 's1', reason: 'forbidden', message: 'owner only' },
      ],
    }),
  )
  vi.stubGlobal('fetch', fetchMock)
  const complete = vi.fn(async () => {})

  await new ApiConnector().uploadData(fakeDb({ crud: [patch], transactionId: 7, complete }))

  const [url, init] = fetchMock.mock.calls[0]
  expect(url).toBe('/api/sync/upload')
  expect(init?.credentials).toBe('include')
  const body = JSON.parse(String(init?.body))
  expect(body.batchId).toBe('7')
  expect(body.entries).toEqual([{ table: 'shows', id: 's1', op: 'PATCH', data: { title: 'Nope' } }])
  expect(complete).toHaveBeenCalledOnce()
  expect(getNotices()).toEqual([
    expect.objectContaining({ kind: 'rejection', message: expect.stringContaining('owner only') }),
  ])
})

test('throws on a non-2xx upload so PowerSync retries, leaving the transaction queued', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ error: 'unavailable' }, { status: 503 })),
  )
  const complete = vi.fn(async () => {})

  await expect(new ApiConnector().uploadData(fakeDb({ crud: [patch], complete }))).rejects.toThrow(
    /503/,
  )
  expect(complete).not.toHaveBeenCalled()
})

test('does nothing when the upload queue is empty', async () => {
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  await new ApiConnector().uploadData(fakeDb(null))
  expect(fetchMock).not.toHaveBeenCalled()
})

test('fetchCredentials returns the endpoint and token from the API', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({ token: 't', expiresAt: '2026-10-15T01:00:00.000Z', endpoint: 'http://ps' }),
    ),
  )
  expect(await new ApiConnector().fetchCredentials()).toEqual({
    endpoint: 'http://ps',
    token: 't',
    expiresAt: new Date('2026-10-15T01:00:00.000Z'),
  })
})

test('fetchCredentials returns null when signed out', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ error: 'unauthenticated' }, { status: 401 })),
  )
  expect(await new ApiConnector().fetchCredentials()).toBeNull()
})
