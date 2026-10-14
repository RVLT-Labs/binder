import { changeLog, documents, showMemberships, shows } from '@binder/db'
import { type Actor, newId } from '@binder/shared'
import { and, eq } from 'drizzle-orm'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { AppError } from '../src/errors'
import {
  addShowMember,
  createShow,
  createToken,
  listOrganisations,
  updateDocument,
  updateShow,
} from '../src/services'
import { applyCrudBatch, type CrudEntry } from '../src/sync/apply'
import { SYNC_TABLES } from '../src/sync/policy'
import { createTestApp, createTestUser } from './helpers'

let n = 0
const web = (userId: string): Actor => ({ userId, via: 'web', agent: null })
const sync = (userId: string): Actor => ({ userId, via: 'sync', agent: null })
const code = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e) => (e instanceof AppError ? e.code : 'other'),
  )

async function setup() {
  const { app, deps } = await createTestApp()
  const i = ++n
  const mail = { o: `so${i}@x.test`, e: `se${i}@x.test`, v: `sv${i}@x.test`, s: `ss${i}@x.test` }
  const owner = await createTestUser(app, deps, {
    email: mail.o,
    name: 'O',
    password: 'password123',
  })
  const editor = await createTestUser(app, deps, {
    email: mail.e,
    name: 'E',
    password: 'password123',
  })
  const viewer = await createTestUser(app, deps, {
    email: mail.v,
    name: 'V',
    password: 'password123',
  })
  const stranger = await createTestUser(app, deps, {
    email: mail.s,
    name: 'S',
    password: 'password123',
  })
  const [org] = await listOrganisations(deps.db, web(owner.id))
  const show = await createShow(deps.db, web(owner.id), { organisationId: org.id, title: 'A' })
  await addShowMember(deps.db, web(owner.id), { showId: show.id, email: mail.e, role: 'editor' })
  await addShowMember(deps.db, web(owner.id), { showId: show.id, email: mail.v, role: 'viewer' })
  const docId = newId()
  await deps.db.insert(documents).values({
    id: docId,
    showId: show.id,
    kind: 'libretto',
    title: 'Script',
    updatedBy: owner.id,
  })
  return { app, deps, db: deps.db, owner, editor, viewer, stranger, show, docId }
}

const patch = (table: string, id: string, data: Record<string, unknown>): CrudEntry => ({
  table,
  id,
  op: 'PATCH',
  data,
})

async function logRows(db: Awaited<ReturnType<typeof setup>>['db'], batchId: string) {
  return db.select().from(changeLog).where(eq(changeLog.batchId, batchId)).orderBy(changeLog.seq)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('applyCrudBatch', () => {
  test('owner PATCH on shows applies and logs before/after', async () => {
    const { db, owner, show } = await setup()
    const batchId = newId()
    const clientTs = '2026-10-14T10:00:00.000Z'
    const result = await applyCrudBatch(db, sync(owner.id), {
      batchId,
      entries: [{ ...patch('shows', show.id, { title: 'B' }), clientTs }],
    })
    expect(result).toEqual({ applied: 1, rejected: [] })
    const [row] = await db.select().from(shows).where(eq(shows.id, show.id))
    expect(row.title).toBe('B')
    expect(row.updatedBy).toBe(owner.id)
    const logs = await logRows(db, batchId)
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({
      tableName: 'shows',
      rowId: show.id,
      op: 'update',
      via: 'sync',
      userId: owner.id,
      before: { title: 'A' },
      after: { title: 'B' },
    })
    expect(logs[0].clientTs?.toISOString()).toBe(clientTs)
  })

  test('editor PATCH on shows is rejected forbidden, other entries still apply', async () => {
    const { db, editor, show, docId } = await setup()
    const batchId = newId()
    const result = await applyCrudBatch(db, sync(editor.id), {
      batchId,
      entries: [
        patch('shows', show.id, { title: 'Hijack' }),
        patch('documents', docId, { title: 'Book' }),
      ],
    })
    expect(result.applied).toBe(1)
    expect(result.rejected).toEqual([
      { index: 0, table: 'shows', id: show.id, reason: 'forbidden', message: expect.any(String) },
    ])
    const [s] = await db.select().from(shows).where(eq(shows.id, show.id))
    expect(s.title).toBe('A')
    const [d] = await db.select().from(documents).where(eq(documents.id, docId))
    expect(d.title).toBe('Book')
    expect(d.updatedBy).toBe(editor.id)
    const logs = await logRows(db, batchId)
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({
      tableName: 'documents',
      rowId: docId,
      showId: show.id,
      via: 'sync',
      before: { title: 'Script' },
      after: { title: 'Book' },
    })
  })

  test('viewer PATCH on documents is rejected forbidden', async () => {
    const { db, viewer, docId } = await setup()
    const result = await applyCrudBatch(db, sync(viewer.id), {
      batchId: newId(),
      entries: [patch('documents', docId, { title: 'Nope' })],
    })
    expect(result.applied).toBe(0)
    expect(result.rejected.map((r) => r.reason)).toEqual(['forbidden'])
  })

  test('unknown table and PUT are rejected with the right reasons', async () => {
    const { db, owner, show } = await setup()
    const result = await applyCrudBatch(db, sync(owner.id), {
      batchId: newId(),
      entries: [
        patch('cues', newId(), { title: 'x' }),
        patch('constructor', newId(), { title: 'x' }),
        { table: 'shows', id: show.id, op: 'PUT', data: { title: 'x' } },
        { table: 'shows', id: show.id, op: 'DELETE' },
      ],
    })
    expect(result.applied).toBe(0)
    expect(result.rejected.map((r) => [r.index, r.reason])).toEqual([
      [0, 'unknown_table'],
      [1, 'unknown_table'],
      [2, 'unsupported_op'],
      [3, 'unsupported_op'],
    ])
  })

  test('PATCH with only non-writable columns is rejected invalid', async () => {
    const { db, owner, show, docId } = await setup()
    const batchId = newId()
    const result = await applyCrudBatch(db, sync(owner.id), {
      batchId,
      entries: [
        patch('documents', docId, { show_id: 'x' }),
        { table: 'documents', id: docId, op: 'PATCH' },
        patch('documents', docId, { show_id: 'x', updated_at: 'now', title: 'Kept' }),
      ],
    })
    expect(result.rejected.map((r) => [r.index, r.reason])).toEqual([
      [0, 'invalid'],
      [1, 'invalid'],
    ])
    expect(result.applied).toBe(1)
    const [d] = await db.select().from(documents).where(eq(documents.id, docId))
    expect(d.showId).toBe(show.id)
    expect(d.title).toBe('Kept')
  })

  test('PATCH on a row the user is not a member of is not_found', async () => {
    const { db, stranger, show, docId } = await setup()
    const result = await applyCrudBatch(db, sync(stranger.id), {
      batchId: newId(),
      entries: [
        patch('shows', show.id, { title: 'x' }),
        patch('documents', docId, { title: 'x' }),
        patch('documents', newId(), { title: 'x' }),
      ],
    })
    expect(result.applied).toBe(0)
    expect(result.rejected.map((r) => r.reason)).toEqual(['not_found', 'not_found', 'not_found'])
  })

  test('revoked membership mid-queue: all entries rejected, response is still 200', async () => {
    const { app, db, editor, show, docId } = await setup()
    await db
      .delete(showMemberships)
      .where(and(eq(showMemberships.showId, show.id), eq(showMemberships.userId, editor.id)))
    const res = await app.request('/api/sync/upload', {
      method: 'POST',
      headers: { cookie: editor.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        batchId: newId(),
        entries: [
          patch('documents', docId, { title: 'one' }),
          patch('documents', docId, { sort_order: 3 }),
        ],
      }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { applied: number; rejected: { reason: string }[] }
    expect(body.applied).toBe(0)
    expect(body.rejected.map((r) => r.reason)).toEqual(['not_found', 'not_found'])
    const [d] = await db.select().from(documents).where(eq(documents.id, docId))
    expect(d.title).toBe('Script')
  })

  test('coerces SQLite wire values: settings as JSON text, snap_to_text as 1', async () => {
    const { db, owner, show, docId } = await setup()
    const batchId = newId()
    const result = await applyCrudBatch(db, sync(owner.id), {
      batchId,
      entries: [
        patch('shows', show.id, { settings: '{"tempo":120}' }),
        patch('documents', docId, {
          snap_to_text: 1,
          sort_order: 4,
          ocr_mode: 'never',
          kind: 'score',
        }),
        patch('documents', docId, { snap_to_text: 0 }),
      ],
    })
    expect(result).toEqual({ applied: 3, rejected: [] })
    const [s] = await db.select().from(shows).where(eq(shows.id, show.id))
    expect(s.settings).toEqual({ tempo: 120 })
    const [d] = await db.select().from(documents).where(eq(documents.id, docId))
    expect(d).toMatchObject({ snapToText: false, sortOrder: 4, ocrMode: 'never', kind: 'score' })
    const logs = await logRows(db, batchId)
    expect(logs.map((l) => l.after)).toEqual([
      { settings: { tempo: 120 } },
      { snapToText: true, sortOrder: 4, ocrMode: 'never', kind: 'score' },
      { snapToText: false },
    ])
  })

  test('invalid values are rejected invalid and change nothing', async () => {
    const { db, owner, show, docId } = await setup()
    const result = await applyCrudBatch(db, sync(owner.id), {
      batchId: newId(),
      entries: [
        patch('shows', show.id, { status: 'cancelled' }),
        patch('documents', docId, { kind: 'poster' }),
        patch('documents', docId, { ocr_mode: 'always' }),
        patch('shows', show.id, { title: '' }),
        patch('shows', show.id, { title: 'x'.repeat(201) }),
        patch('shows', show.id, { settings: '[1,2]' }),
        patch('shows', show.id, { settings: 'not json' }),
        patch('documents', docId, { snap_to_text: 2 }),
        patch('documents', docId, { sort_order: 1.5 }),
        patch('documents', docId, { sort_order: 2 ** 31 }),
        patch('shows', show.id, { title: 'nul\u0000byte' }),
        { ...patch('shows', show.id, { title: 'B' }), clientTs: 'yesterday' },
      ],
    })
    expect(result.applied).toBe(0)
    expect(result.rejected.map((r) => r.reason)).toEqual(Array(12).fill('invalid'))
    const [s] = await db.select().from(shows).where(eq(shows.id, show.id))
    expect(s).toMatchObject({ title: 'A', status: 'prep', settings: {} })
  })

  test('a documents PATCH in an archived show is rejected forbidden', async () => {
    const { db, owner, editor, show, docId } = await setup()
    await updateShow(db, web(owner.id), { showId: show.id, patch: { status: 'archived' } })
    const result = await applyCrudBatch(db, sync(editor.id), {
      batchId: newId(),
      entries: [patch('documents', docId, { title: 'Late' })],
    })
    expect(result.rejected.map((r) => r.reason)).toEqual(['forbidden'])
    const [d] = await db.select().from(documents).where(eq(documents.id, docId))
    expect(d.title).toBe('Script')
  })

  test('an owner can unarchive through sync', async () => {
    const { db, owner, show } = await setup()
    await updateShow(db, web(owner.id), { showId: show.id, patch: { status: 'archived' } })
    const result = await applyCrudBatch(db, sync(owner.id), {
      batchId: newId(),
      entries: [
        patch('shows', show.id, { title: 'No' }),
        patch('shows', show.id, { status: 'prep' }),
      ],
    })
    expect(result.applied).toBe(1)
    expect(result.rejected.map((r) => [r.index, r.reason])).toEqual([[0, 'forbidden']])
  })

  test('an unexpected error aborts the whole batch', async () => {
    const { db, owner, show, docId } = await setup()
    const batchId = newId()
    vi.spyOn(SYNC_TABLES.documents, 'patch').mockRejectedValueOnce(new Error('boom'))
    await expect(
      applyCrudBatch(db, sync(owner.id), {
        batchId,
        entries: [
          patch('shows', show.id, { title: 'B' }),
          patch('documents', docId, { title: 'x' }),
        ],
      }),
    ).rejects.toThrow('boom')
    const [s] = await db.select().from(shows).where(eq(shows.id, show.id))
    expect(s.title).toBe('A')
    expect(await logRows(db, batchId)).toHaveLength(0)
  })
})

describe('updateDocument', () => {
  test('logs only changed columns and skips a no-op', async () => {
    const { db, editor, docId } = await setup()
    const batchId = newId()
    await updateDocument(db, web(editor.id), {
      documentId: docId,
      patch: { title: 'Script', sortOrder: 2 },
      batchId,
    })
    await updateDocument(db, web(editor.id), {
      documentId: docId,
      patch: { title: 'Script' },
      batchId,
    })
    const logs = await logRows(db, batchId)
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({ before: { sortOrder: 0 }, after: { sortOrder: 2 }, via: 'web' })
  })

  test('respects a token show scope', async () => {
    const { db, owner, docId } = await setup()
    const scoped: Actor = { ...web(owner.id), via: 'mcp', showScope: [newId()] }
    expect(
      await code(updateDocument(db, scoped, { documentId: docId, patch: { title: 'x' } })),
    ).toBe('forbidden')
  })
})

describe('POST /api/sync/upload', () => {
  const post = (headers: Record<string, string>, body: unknown) => ({
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })

  test('HTTP: a batch with one bad entry returns 200 with one rejection', async () => {
    const { app, db, owner, show, docId } = await setup()
    const batchId = newId()
    const res = await app.request(
      '/api/sync/upload',
      post(
        { cookie: owner.cookie },
        {
          batchId,
          entries: [
            { ...patch('shows', show.id, { title: 'B' }), clientTs: '2026-10-14T09:00:00Z' },
            patch('nope', newId(), { title: 'x' }),
            patch('documents', docId, { title: 'Book' }),
          ],
        },
      ),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      applied: 2,
      rejected: [
        {
          index: 1,
          table: 'nope',
          id: expect.any(String),
          reason: 'unknown_table',
          message: expect.any(String),
        },
      ],
    })
    const logs = await logRows(db, batchId)
    expect(logs.map((l) => [l.tableName, l.via, l.batchId])).toEqual([
      ['shows', 'sync', batchId],
      ['documents', 'sync', batchId],
    ])
    expect(logs[0].clientTs?.toISOString()).toBe('2026-10-14T09:00:00.000Z')
    expect(logs[1].clientTs).toBeNull()
  })

  test('requires a session cookie: no auth and a bearer token are 401', async () => {
    const { app, db, owner, show } = await setup()
    const body = { batchId: newId(), entries: [patch('shows', show.id, { title: 'B' })] }
    expect((await app.request('/api/sync/upload', post({}, body))).status).toBe(401)
    const { token } = await createToken(db, web(owner.id), { name: 'pat', showScope: '*' })
    const res = await app.request(
      '/api/sync/upload',
      post({ authorization: `Bearer ${token}` }, body),
    )
    expect(res.status).toBe(401)
    const [s] = await db.select().from(shows).where(eq(shows.id, show.id))
    expect(s.title).toBe('A')
  })

  test('a malformed body is 400', async () => {
    const { app, owner, show } = await setup()
    const entry = patch('shows', show.id, { title: 'B' })
    for (const body of [
      { entries: [entry] },
      { batchId: newId(), entries: [{ ...entry, op: 'MERGE' }] },
      { batchId: newId(), entries: Array(501).fill(entry) },
    ]) {
      const res = await app.request('/api/sync/upload', post({ cookie: owner.cookie }, body))
      expect(res.status).toBe(400)
    }
  })

  test('an unexpected error mid-batch returns 503 with nothing applied', async () => {
    const { app, db, owner, show, docId } = await setup()
    const batchId = newId()
    vi.spyOn(SYNC_TABLES.documents, 'patch').mockRejectedValueOnce(new Error('connection lost'))
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await app.request(
      '/api/sync/upload',
      post(
        { cookie: owner.cookie },
        {
          batchId,
          entries: [
            patch('shows', show.id, { title: 'B' }),
            patch('documents', docId, { title: 'x' }),
          ],
        },
      ),
    )
    expect(res.status).toBe(503)
    expect(errors).toHaveBeenCalled()
    const [s] = await db.select().from(shows).where(eq(shows.id, show.id))
    expect(s.title).toBe('A')
    expect(await logRows(db, batchId)).toHaveLength(0)
  })
})
