import type { SyncUploadRequest } from '@binder/shared'
import { type CommonPowerSyncDatabase, type CrudEntry, UpdateType } from '@powersync/web'
import { beforeEach, expect, test, vi } from 'vitest'
import { clearNotices, getNotices } from '../components/noticeStore'
import { ApiConnector, toCrudEntries } from './connector'
import { deviceId } from './ownership'
import { UPLOAD_CHUNK_MAX_BYTES } from './uploadChunks'

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
  // Device-scoped, so a transaction counter restarting after a wipe never reuses an id.
  expect(body.batchId).toBe(`${deviceId()}-7`)
  expect(body.batchId).toMatch(/^[A-Za-z0-9_-]{1,100}$/)
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

test('without a transaction id the batch id is still device-scoped and fits the server grammar', async () => {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
    Response.json({ applied: 1, rejected: [] }),
  )
  vi.stubGlobal('fetch', fetchMock)
  await new ApiConnector().uploadData(fakeDb({ crud: [patch], complete: async () => {} }))
  const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
  expect(body.batchId.startsWith(`${deviceId()}-`)).toBe(true)
  expect(body.batchId).toMatch(/^[A-Za-z0-9_-]{1,100}$/)
  expect(body.batchId).not.toContain(':')
})

test('clientTs comes from opData.updated_at', () => {
  const at = '2026-10-15T10:00:00.000Z'
  expect(
    toCrudEntries([
      entry({ op: UpdateType.PUT, table: 'cues', id: 'c', opData: { label: 'A', updated_at: at } }),
      entry({ op: UpdateType.PATCH, table: 'cues', id: 'c', opData: { label: 'B' } }),
      entry({ op: UpdateType.DELETE, table: 'cues', id: 'c' }),
    ]),
  ).toEqual([
    { table: 'cues', id: 'c', op: 'PUT', data: { label: 'A', updated_at: at }, clientTs: at },
    { table: 'cues', id: 'c', op: 'PATCH', data: { label: 'B' } },
    { table: 'cues', id: 'c', op: 'DELETE' },
  ])
})

/** A fake transaction of `n` cue PUTs, and a local database that knows no rows (labels fall back). */
function bigTx(n: number) {
  const ids = Array.from({ length: n }, (_, i) => `cue-${i}`)
  const tx = {
    crud: ids.map((id) => entry({ op: UpdateType.PUT, table: 'cues', id, opData: { label: id } })),
    transactionId: 42,
    complete: vi.fn(async () => {}),
  }
  const db = {
    getNextCrudTransaction: async () => tx,
    getOptional: async () => null,
  } as unknown as CommonPowerSyncDatabase
  return { ids, tx, db }
}

function recordPosts(respond: (body: SyncUploadRequest, n: number) => Response) {
  const posts: SyncUploadRequest[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as SyncUploadRequest
      posts.push(body)
      return respond(body, posts.length)
    }),
  )
  return posts
}

test('uploads 1,200 entries as three ordered chunks of 400 under one batch id and completes once', async () => {
  const { ids, tx, db } = bigTx(1200)
  const posts = recordPosts((body) => Response.json({ applied: body.entries.length, rejected: [] }))
  await new ApiConnector().uploadData(db)
  expect(posts.map((p) => p.entries.length)).toEqual([400, 400, 400])
  expect(new Set(posts.map((p) => p.batchId))).toEqual(new Set([`${deviceId()}-42`]))
  expect(posts.map((p) => p.chunk)).toEqual([
    { index: 0, count: 3 },
    { index: 1, count: 3 },
    { index: 2, count: 3 },
  ])
  expect(posts.flatMap((p) => p.entries.map((e) => e.id))).toEqual(ids)
  expect(tx.complete).toHaveBeenCalledTimes(1)
})

test('40 entries of about 100 KB upload in chunks within the byte budget, in order, completing once', async () => {
  const { ids, tx, db } = bigTx(40)
  for (const e of tx.crud) e.opData = { notes: 'n'.repeat(100_000) }
  const sizes: number[] = []
  const posted: SyncUploadRequest[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      sizes.push(new TextEncoder().encode(String(init?.body)).length)
      const body = JSON.parse(String(init?.body)) as SyncUploadRequest
      posted.push(body)
      return Response.json({ applied: body.entries.length, rejected: [] })
    }),
  )
  await new ApiConnector().uploadData(db)
  expect(posted.length).toBeGreaterThan(1)
  for (const size of sizes) expect(size).toBeLessThanOrEqual(UPLOAD_CHUNK_MAX_BYTES)
  expect(posted.flatMap((p) => p.entries.map((e) => e.id))).toEqual(ids)
  expect(posted.map((p) => p.chunk)).toEqual(
    posted.map((_, index) => ({ index, count: posted.length })),
  )
  expect(new Set(posted.map((p) => p.batchId)).size).toBe(1)
  expect(tx.complete).toHaveBeenCalledTimes(1)
})

test('a failed second chunk throws and never completes the transaction', async () => {
  const { tx, db } = bigTx(1000)
  const posts = recordPosts((body, n) =>
    n === 2
      ? Response.json({ error: 'unavailable' }, { status: 503 })
      : Response.json({ applied: body.entries.length, rejected: [] }),
  )
  await expect(new ApiConnector().uploadData(db)).rejects.toThrow(/503/)
  // The third chunk is never sent; PowerSync retries the whole transaction later.
  expect(posts.map((p) => p.chunk?.index)).toEqual([0, 1])
  expect(tx.complete).not.toHaveBeenCalled()
})

test('rejections from every chunk become notices naming the row, before the transaction completes', async () => {
  const { tx, db } = bigTx(500)
  const order: string[] = []
  tx.complete.mockImplementation(async () => {
    order.push(`complete after ${getNotices().length} notices`)
  })
  recordPosts((body) =>
    Response.json({
      applied: body.entries.length - 1,
      rejected: [
        {
          index: 0,
          table: 'cues',
          id: body.entries[0].id,
          reason: 'forbidden',
          message: 'you cannot edit this layer',
        },
      ],
    }),
  )
  await new ApiConnector().uploadData(db)
  expect(getNotices().map((n) => n.message)).toEqual([
    'Your change to a cue was not saved: you cannot edit this layer',
    'Your change to a cue was not saved: you cannot edit this layer',
  ])
  expect(order).toEqual(['complete after 2 notices'])
})

test('a replayed chunk raises no notice and the transaction completes', async () => {
  const { tx, db } = bigTx(3)
  recordPosts(() => Response.json({ applied: 0, rejected: [], replay: true }))
  await new ApiConnector().uploadData(db)
  expect(getNotices()).toEqual([])
  expect(tx.complete).toHaveBeenCalledOnce()
})
