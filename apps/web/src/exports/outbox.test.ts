import 'fake-indexeddb/auto'
import { beforeEach, expect, test, vi } from 'vitest'
import { clearNotices, getNotices } from '../components/noticeStore'
import {
  clearOtherOutboxes,
  clearOutbox,
  enqueueExport,
  flushOutbox,
  type OutboxStore,
  type PendingExport,
  pendingExports,
} from './outbox'

beforeEach(() => clearNotices())

/** An in-memory store, so the flush logic is tested apart from IndexedDB. */
function memoryStore(): OutboxStore & { entries: Map<string, PendingExport> } {
  const entries = new Map<string, PendingExport>()
  return {
    entries,
    put: async (p) => void entries.set(p.id, p),
    list: async () => [...entries.values()],
    remove: async (id) => void entries.delete(id),
    clear: async () => entries.clear(),
  }
}

let counter = 0
function pending(
  userId: string,
  over: Partial<PendingExport> & { filename?: string } = {},
): PendingExport {
  const { filename, ...rest } = over
  const id = rest.id ?? `0190c000-0000-7000-8000-${String(++counter).padStart(12, '0')}`
  return {
    id,
    showId: 'show-1',
    userId,
    meta: {
      id,
      kind: 'pdf-script',
      filename: filename ?? `${id}.pdf`,
      layerSelection: [],
      createdAt: new Date(1_700_000_000_000 + counter * 1000).toISOString(),
    },
    bytes: new TextEncoder().encode('%PDF-1.7 fake'),
    contentType: 'application/pdf',
    ...rest,
  }
}

const reply = (status: number, body: unknown = {}) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }))

test('2xx removes, 4xx drops with a notice, network failure and 5xx keep for the next flush', async () => {
  const store = memoryStore()
  const ok = pending('u1', { filename: 'ok.pdf' })
  const bad = pending('u1', { filename: 'bad.pdf' })
  const down = pending('u1', { filename: 'down.pdf' })
  const broken = pending('u1', { filename: 'broken.pdf' })
  for (const p of [ok, bad, down, broken]) await enqueueExport(p, store)
  expect(store.entries.size).toBe(4)

  const post = vi.fn(async (p: PendingExport) => {
    if (p.id === ok.id) return reply(201)
    if (p.id === bad.id) return reply(413, { message: 'too large' })
    if (p.id === down.id) throw new TypeError('Failed to fetch')
    return reply(503)
  })
  const first = await flushOutbox('u1', { store, post })
  expect(first).toEqual({ sent: 1, kept: 2, dropped: 1 })
  expect([...store.entries.keys()].sort()).toEqual([down.id, broken.id].sort())
  const notices = getNotices()
  expect(notices).toHaveLength(1)
  expect(notices[0]).toMatchObject({ kind: 'error' })
  expect(notices[0].message).toContain('bad.pdf')
  expect(notices[0].message).toContain('too large')

  // The server recovers: the kept ones go on the next flush, and nothing is sent twice.
  post.mockImplementation(async () => reply(201))
  const second = await flushOutbox('u1', { store, post })
  expect(second).toEqual({ sent: 2, kept: 0, dropped: 0 })
  expect(store.entries.size).toBe(0)
  expect(getNotices()).toHaveLength(1)
})

test('an expired session (401) and throttling keep the entry: nothing has been refused for good', async () => {
  const store = memoryStore()
  const a = pending('u1')
  const b = pending('u1')
  await enqueueExport(a, store)
  await enqueueExport(b, store)
  const post = vi.fn(async (p: PendingExport) => (p.id === a.id ? reply(401) : reply(429)))
  expect(await flushOutbox('u1', { store, post })).toEqual({ sent: 0, kept: 2, dropped: 0 })
  expect(store.entries.size).toBe(2)
  expect(getNotices()).toHaveLength(0)
})

test("flushing as user B never sends user A's pending exports; clearOutbox(A) empties A's store", async () => {
  const a = pending('user-a')
  const b = pending('user-b')
  // The default stores: one IndexedDB database per user.
  await enqueueExport(a)
  await enqueueExport(b)
  expect((await pendingExports('user-a')).map((p) => p.id)).toEqual([a.id])

  const post = vi.fn(async (_p: PendingExport) => reply(201))
  expect(await flushOutbox('user-b', { post })).toEqual({ sent: 1, kept: 0, dropped: 0 })
  expect(post).toHaveBeenCalledTimes(1)
  expect(post.mock.calls[0][0].id).toBe(b.id)
  expect((await pendingExports('user-a')).map((p) => p.id)).toEqual([a.id])

  // Even an entry that somehow sits in B's store under A's name is not sent as B.
  const stray = memoryStore()
  await enqueueExport(pending('user-a'), stray)
  post.mockClear()
  expect(await flushOutbox('user-b', { store: stray, post })).toEqual({
    sent: 0,
    kept: 0,
    dropped: 0,
  })
  expect(post).not.toHaveBeenCalled()
  expect(stray.entries.size).toBe(1)

  await clearOutbox('user-a')
  expect(await pendingExports('user-a')).toEqual([])
  await enqueueExport(pending('user-b'))
  await clearOutbox('user-a')
  expect(await pendingExports('user-b')).toHaveLength(1)
  await clearOutbox('user-b')
})

test('the default store keeps the bytes and names its database for the user', async () => {
  const p = pending('user-c', { bytes: Uint8Array.from([37, 80, 68, 70, 45, 0, 255]) })
  await enqueueExport(p)
  const [back] = await pendingExports('user-c')
  expect([...back.bytes]).toEqual([37, 80, 68, 70, 45, 0, 255])
  expect(back.meta).toEqual(p.meta)
  const names = (await indexedDB.databases()).map((d) => d.name)
  expect(names).toContain('binder-exports-user-c')
  await clearOutbox('user-c')
})

test('overlapping flushes post an entry once, and an entry queued mid-flush goes in the same run', async () => {
  const store = memoryStore()
  const first = pending('u1')
  await enqueueExport(first, store)
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const post = vi.fn(async (p: PendingExport) => {
    if (p.id === first.id) await gate
    return reply(201)
  })
  const a = flushOutbox('u1', { store, post })
  const b = flushOutbox('u1', { store, post }) // "start" and "online" firing together
  const late = pending('u1')
  await enqueueExport(late, store)
  const c = flushOutbox('u1', { store, post }) // right after the enqueue
  release()
  await Promise.all([a, b, c])
  expect(post.mock.calls.map(([p]) => p.id).sort()).toEqual([first.id, late.id].sort())
  expect(store.entries.size).toBe(0)
})

test('a network failure stops the run, so a dead connection is tried once, not per file', async () => {
  const store = memoryStore()
  for (let i = 0; i < 3; i++) await enqueueExport(pending('u1'), store)
  const post = vi.fn(async () => {
    throw new TypeError('Failed to fetch')
  })
  expect(await flushOutbox('u1', { store, post })).toEqual({ sent: 0, kept: 3, dropped: 0 })
  expect(post).toHaveBeenCalledTimes(1)
})

test('the default post sends meta, then the file, as multipart to the show', async () => {
  const store = memoryStore()
  const p = pending('u1')
  await enqueueExport(p, store)
  let sent: FormData | undefined
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    sent = init.body as FormData
    return new Response('{}', { status: 201 })
  })
  vi.stubGlobal('fetch', fetchMock)
  expect(await flushOutbox('u1', { store })).toEqual({ sent: 1, kept: 0, dropped: 0 })
  expect(fetchMock.mock.calls[0][0]).toBe('/api/shows/show-1/exports')
  expect(fetchMock.mock.calls[0][1].credentials).toBe('include')
  expect([...(sent?.keys() ?? [])]).toEqual(['meta', 'file'])
  expect(JSON.parse(sent?.get('meta') as string)).toEqual(p.meta)
  const file = sent?.get('file') as File
  expect(file.type).toBe('application/pdf')
  expect(file.name).toBe(p.meta.filename)
  expect(file.size).toBe(p.bytes.length)
})

test('an error that is not a network failure keeps the entry, is logged, and the run goes on', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  const store = memoryStore()
  const bad = pending('u1', { filename: 'bad.pdf' })
  const good = pending('u1', { filename: 'good.pdf' })
  await enqueueExport(bad, store)
  await enqueueExport(good, store)
  const post = vi.fn(async (p: PendingExport) => {
    if (p.id === bad.id) throw new RangeError('boom')
    return reply(201)
  })
  expect(await flushOutbox('u1', { store, post })).toEqual({ sent: 1, kept: 1, dropped: 0 })
  // Not treated as "offline": the next entry was still tried, and the failure was reported.
  expect(post).toHaveBeenCalledTimes(2)
  expect([...store.entries.keys()]).toEqual([bad.id])
  expect(log).toHaveBeenCalledWith(expect.stringContaining('bad.pdf'), expect.any(RangeError))
})

test('a storage failure rejects that flush but does not poison the next one', async () => {
  const store = memoryStore()
  await enqueueExport(pending('u1'), store)
  const list = store.list
  let failures = 1
  store.list = async () => {
    if (failures-- > 0) throw new Error('IndexedDB is closing')
    return list()
  }
  const post = vi.fn(async () => reply(201))
  await expect(flushOutbox('u1', { store, post })).rejects.toThrow('IndexedDB is closing')
  expect(await flushOutbox('u1', { store, post })).toEqual({ sent: 1, kept: 0, dropped: 0 })
})

test('clearOutbox cancels a flush in flight: no further post goes out under whoever signs in next', async () => {
  const store = memoryStore()
  const [one, two, three] = [pending('u1'), pending('u1'), pending('u1')]
  for (const p of [one, two, three]) await enqueueExport(p, store)
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const post = vi.fn(async (p: PendingExport) => {
    if (p.id === one.id) await gate
    return reply(201)
  })
  const flushing = flushOutbox('u1', { store, post })
  await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1))

  const clearing = clearOutbox('u1', store) // sign-out, mid-flush
  release()
  await Promise.all([flushing, clearing])
  expect(post).toHaveBeenCalledTimes(1)
  expect(store.entries.size).toBe(0)

  // The store is usable again: a later flush starts a fresh run and sends what is queued then.
  const later = pending('u1')
  await enqueueExport(later, store)
  expect(await flushOutbox('u1', { store, post })).toEqual({ sent: 1, kept: 0, dropped: 0 })
  expect(post).toHaveBeenLastCalledWith(expect.objectContaining({ id: later.id }))
})

test("clearOtherOutboxes empties every other user's outbox and leaves the owner's", async () => {
  await enqueueExport(pending('old-1'))
  await enqueueExport(pending('old-2'))
  const mine = pending('new-user')
  await enqueueExport(mine)
  await clearOtherOutboxes('new-user')
  expect(await pendingExports('old-1')).toEqual([])
  expect(await pendingExports('old-2')).toEqual([])
  expect((await pendingExports('new-user')).map((p) => p.id)).toEqual([mine.id])
  await clearOutbox('new-user')
})

test('a script PDF queued by older code with an unsafe name is sanitised before it is sent, and the upload succeeds', async () => {
  const store = memoryStore()
  // Older code cut a long name at 196 characters, which can leave a space before ".pdf".
  const legacy = pending('u1', { filename: 'Pirates: A/B - Libretto v2 - LX .pdf' })
  await enqueueExport(legacy, store)
  const sentNames: string[] = []
  let sentForm: FormData | undefined
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      sentForm = init.body as FormData
      sentNames.push(JSON.parse(sentForm.get('meta') as string).filename)
      return new Response('{}', { status: 201 })
    }),
  )
  expect(await flushOutbox('u1', { store })).toEqual({ sent: 1, kept: 0, dropped: 0 })
  expect(sentNames).toEqual(['Pirates- A-B - Libretto v2 - LX.pdf'])
  expect(((sentForm as FormData).get('file') as File).name).toBe(
    'Pirates- A-B - Libretto v2 - LX.pdf',
  )
})

test('a name that is already valid is sent as it is, and other kinds of export are never renamed', async () => {
  const store = memoryStore()
  const fine = pending('u1', { filename: 'songs-libretto-v2-LX.pdf' })
  const sheet = pending('u1', { filename: 'Show - SND cue list.xlsx' })
  sheet.meta.kind = 'xlsx-cuesheet'
  const spaced = pending('u1', { filename: 'Show - cues .csv' })
  spaced.meta.kind = 'csv-cuesheet'
  for (const p of [fine, sheet, spaced]) await enqueueExport(p, store)
  const names: string[] = []
  const post = vi.fn(async (p: PendingExport) => {
    names.push(p.meta.filename)
    return reply(201)
  })
  await flushOutbox('u1', { store, post })
  expect(names).toEqual([
    'songs-libretto-v2-LX.pdf',
    'Show - SND cue list.xlsx',
    'Show - cues .csv',
  ])
})

test('a 400 that remains after sanitising shows a notice and the entry is not retried', async () => {
  const store = memoryStore()
  const p = pending('u1', { filename: 'Show - Libretto v1 - LX.pdf' })
  await enqueueExport(p, store)
  const post = vi.fn(async () =>
    reply(400, { message: 'File names can\'t contain / \\ : * ? " < > |' }),
  )
  expect(await flushOutbox('u1', { store, post })).toEqual({ sent: 0, kept: 0, dropped: 1 })
  expect(store.entries.size).toBe(0)
  const notices = getNotices()
  expect(notices).toHaveLength(1)
  expect(notices[0]?.message).toContain('Show - Libretto v1 - LX.pdf')
  expect(notices[0]?.message).toContain('could not record it')
  // Another flush, and the one after a reconnect, find nothing to send: it is never retried.
  expect(await flushOutbox('u1', { store, post })).toEqual({ sent: 0, kept: 0, dropped: 0 })
  expect(post).toHaveBeenCalledTimes(1)
})

test('the print options travel in the meta the upload sends', async () => {
  const store = memoryStore()
  const p = pending('u1')
  p.meta.options = {
    pages: '2-3',
    paper: 'Letter',
    includeStandbyWarn: false,
    includeAnnotations: true,
    includeCueNotes: true,
  }
  await enqueueExport(p, store)
  let sent: FormData | undefined
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      sent = init.body as FormData
      return new Response('{}', { status: 201 })
    }),
  )
  await flushOutbox('u1', { store })
  expect(JSON.parse(sent?.get('meta') as string).options).toEqual(p.meta.options)
})

test('an unsafe legacy name that is sanitised and still refused with 400: one sanitised post, entry dropped, notice names the original file', async () => {
  const store = memoryStore()
  const original = 'Pirates: A/B - Libretto v2 - LX .pdf'
  const p = pending('u1', { filename: original })
  await enqueueExport(p, store)
  const sent: string[] = []
  const post = vi.fn(async (q: PendingExport) => {
    sent.push(q.meta.filename)
    return reply(400, { message: 'the server did not like it' })
  })
  expect(await flushOutbox('u1', { store, post })).toEqual({ sent: 0, kept: 0, dropped: 1 })
  expect(sent).toEqual(['Pirates- A-B - Libretto v2 - LX.pdf'])
  expect(store.entries.size).toBe(0)
  const notices = getNotices()
  expect(notices).toHaveLength(1)
  expect(notices[0]?.kind).toBe('error')
  expect(notices[0]?.message).toContain(original)
  expect(notices[0]?.message).toContain('the server did not like it')
  // A later flush (reconnect, the retry timer) finds nothing: no second attempt.
  expect(await flushOutbox('u1', { store, post })).toEqual({ sent: 0, kept: 0, dropped: 0 })
  expect(post).toHaveBeenCalledTimes(1)
})
