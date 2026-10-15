import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { promisify } from 'node:util'
import { documents, documentVersions, exportRecords, shows } from '@binder/db'
import { type LayerRef, newId } from '@binder/shared'
import { eq } from 'drizzle-orm'
import { PDFDocument } from 'pdf-lib'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { BlobStore } from '../src/blob/BlobStore'
import { exportBlobKey, parseExportKey, searchableBlobKey } from '../src/blob/keys'
import { AppError } from '../src/errors'
import {
  createAnnotation,
  createCue,
  createExportRecord,
  createToken,
  exportMarkedScript,
  listExportRecords,
  updateDepartment,
  updateShow,
} from '../src/services'
import { readableExport } from '../src/services/exports'
import { applyCrudBatch } from '../src/sync/apply'
import { MAX_UPLOAD_BYTES } from '../src/upload/multipart'
import { asJson, blobFiles, librettoBytes, multipart } from './documentHelpers'
import { APP_ORIGIN } from './helpers'
import { anchorAt, setupMarkupShow } from './markupHelpers'
import { findMissingTools, skipWithoutTools } from './tools'

const run = promisify(execFile)
const skipPoppler = skipWithoutTools(
  'export footer test',
  findMissingTools([['pdftotext', ['-v']]]),
)

type Setup = Awaited<ReturnType<typeof setupMarkupShow>>
let s: Setup
let work: string

beforeAll(async () => {
  s = await setupMarkupShow()
  work = await mkdtemp(join(tmpdir(), 'binder-export-test-'))
})
afterAll(async () => {
  await rm(work, { recursive: true, force: true })
})

const code = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e) => (e instanceof AppError ? e.code : `other: ${e}`),
  )

const pdfBytes = () => new Uint8Array(librettoBytes())

const meta = (over: Record<string, unknown> = {}) => ({
  id: newId(),
  kind: 'pdf-script',
  filename: 'Libretto - LX.pdf',
  layerSelection: [{ kind: 'department', id: s.depts.LX.id }],
  ...over,
})

async function post(
  who: { cookie: string } | { token: string },
  m: Record<string, unknown> | string,
  file: { bytes: Uint8Array } | null = { bytes: pdfBytes() },
  showId = s.show.id,
  extraHeaders: Record<string, string> = {},
) {
  const headers: Record<string, string> = {
    ...('cookie' in who
      ? { cookie: who.cookie, origin: APP_ORIGIN }
      : { authorization: `Bearer ${who.token}` }),
    ...extraHeaders,
  }
  return asJson(
    await s.app.request(`/api/shows/${showId}/exports`, {
      method: 'POST',
      headers,
      body: multipart({ meta: typeof m === 'string' ? m : JSON.stringify(m) }, file),
    }),
  )
}

const get = (who: { cookie: string }, path: string) =>
  s.app.request(path, { headers: { cookie: who.cookie } })

const input = (over: Partial<Parameters<typeof createExportRecord>[3]> = {}) => ({
  id: newId(),
  showId: s.show.id,
  kind: 'pdf-script' as const,
  filename: 'Libretto - LX.pdf',
  layerSelection: [{ kind: 'department' as const, id: s.depts.LX.id }],
  file: Readable.from(Buffer.from(pdfBytes())),
  ...over,
})

describe('POST /api/shows/:showId/exports', () => {
  test('a viewer uploads an export; a replay with the same id returns the record and stores one blob', async () => {
    const id = newId()
    const a = await post(s.viewer, meta({ id }))
    const b = await post(s.viewer, meta({ id }))
    expect(a.status).toBe(201)
    expect(b.status).toBe(201)
    const first = await a.json()
    expect((await b.json()).id).toBe(first.id)
    expect(first).toMatchObject({
      id,
      showId: s.show.id,
      kind: 'pdf-script',
      filename: 'Libretto - LX.pdf',
      createdBy: s.viewer.id,
      privateTo: null,
      snapshotId: null,
      binderVersion: null,
      changelog: null,
    })
    expect(first.fileKey).toMatch(
      new RegExp(`^shows/${s.show.id}/exports/${id}/[A-Za-z0-9-]+\\.pdf$`),
    )
    expect((await blobFiles(s.deps)).filter((f) => f.includes(`/exports/${id}/`))).toHaveLength(
      2, // the pdf and its .meta.json sidecar
    )
    const blob = await get(s.viewer, `/blobs/${first.fileKey}`)
    expect(blob.status).toBe(200)
    expect(blob.headers.get('content-type')).toBe('application/pdf')
    expect(Buffer.from(await blob.arrayBuffer())).toEqual(librettoBytes())
  })

  test('the same export id from another user is conflict and stores nothing', async () => {
    const id = newId()
    expect((await post(s.viewer, meta({ id }))).status).toBe(201)
    const before = (await blobFiles(s.deps)).filter((f) => f.includes(`/exports/${id}/`))
    const res = await post(s.owner, meta({ id }))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('conflict')
    expect((await blobFiles(s.deps)).filter((f) => f.includes(`/exports/${id}/`))).toEqual(before)
    const [row] = await s.deps.db.select().from(exportRecords).where(eq(exportRecords.id, id))
    expect(row.createdBy).toBe(s.viewer.id)
  })

  test('an id already used in another show is conflict, even for the same user', async () => {
    const id = newId()
    expect((await post(s.owner, meta({ id }))).status).toBe(201)
    const { createShow, listOrganisations } = await import('../src/services')
    const [org] = await listOrganisations(s.deps.db, s.actors.owner)
    const other = await createShow(s.deps.db, s.actors.owner, {
      organisationId: org.id,
      title: 'Other',
    })
    const res = await post(s.owner, meta({ id, layerSelection: [] }), undefined, other.id)
    expect(res.status).toBe(409)
  })

  describe('a duplicate that loses on insert (23505)', () => {
    /**
     * Stores through the real store, then (once) inserts a competing row for `id` before the loser's
     * own insert runs: `put` sits between the pre-check and the insert, so the 23505 branch is certain.
     */
    function racingStore(id: string, winnerUser: string) {
      const stored: string[] = []
      const winnerKey = exportBlobKey(s.show.id, id, newId(), 'pdf')
      let raced = false
      const store: BlobStore = {
        get: (k) => s.deps.blobs.get(k),
        exists: (k) => s.deps.blobs.exists(k),
        delete: (k) => s.deps.blobs.delete(k),
        async put(key, body, contentType) {
          await s.deps.blobs.put(key, body, contentType)
          stored.push(key)
          if (raced) return
          raced = true
          await s.deps.blobs.put(winnerKey, pdfBytes(), 'application/pdf')
          await s.deps.db.insert(exportRecords).values({
            id,
            showId: s.show.id,
            kind: 'pdf-script',
            filename: 'winner.pdf',
            layerSelection: [],
            fileKey: winnerKey,
            createdBy: winnerUser,
            updatedBy: winnerUser,
          })
        },
      }
      return { store, stored, winnerKey }
    }

    test("the same user's loser deletes its own blob and returns the winner's record", async () => {
      const id = newId()
      const { store, stored, winnerKey } = racingStore(id, s.viewer.id)
      const rec = await createExportRecord(s.deps.db, store, s.actors.viewer, input({ id }))
      expect(stored).toHaveLength(1)
      expect(rec.fileKey).toBe(winnerKey)
      expect(rec.filename).toBe('winner.pdf')
      expect(await s.deps.blobs.exists(stored[0])).toBe(false)
      expect(await s.deps.blobs.exists(winnerKey)).toBe(true)
      expect(
        await s.deps.db.select().from(exportRecords).where(eq(exportRecords.id, id)),
      ).toHaveLength(1)
    })

    test("another user's winner makes the loser conflict, and the loser's blob is deleted", async () => {
      const id = newId()
      const { store, stored, winnerKey } = racingStore(id, s.owner.id)
      expect(await code(createExportRecord(s.deps.db, store, s.actors.viewer, input({ id })))).toBe(
        'conflict',
      )
      expect(stored).toHaveLength(1)
      expect(await s.deps.blobs.exists(stored[0])).toBe(false)
      expect(await s.deps.blobs.exists(winnerKey)).toBe(true)
    })
  })

  test('concurrent uploads of one id leave one blob and one record', async () => {
    const id = newId()
    const [a, b] = await Promise.all([
      createExportRecord(s.deps.db, s.deps.blobs, s.actors.viewer, input({ id })),
      createExportRecord(s.deps.db, s.deps.blobs, s.actors.viewer, input({ id })),
    ])
    expect(b.id).toBe(a.id)
    expect(b.fileKey).toBe(a.fileKey)
    const files = (await blobFiles(s.deps)).filter((f) => f.includes(`/exports/${id}/`))
    expect(files.filter((f) => f.endsWith('.pdf'))).toHaveLength(1)
  })

  test('an export with my personal layer is invisible to others in the list and its blob is 404 for them', async () => {
    const rec = await createExportRecord(
      s.deps.db,
      s.deps.blobs,
      s.actors.viewer,
      input({ layerSelection: [{ kind: 'personal', id: s.viewer.id }] }),
    )
    expect(rec.privateTo).toBe(s.viewer.id)
    expect(
      (await listExportRecords(s.deps.db, s.actors.owner, { showId: s.show.id })).map((r) => r.id),
    ).not.toContain(rec.id)
    expect(
      (await listExportRecords(s.deps.db, s.actors.viewer, { showId: s.show.id })).map((r) => r.id),
    ).toContain(rec.id)
    expect((await get(s.owner, `/blobs/${rec.fileKey}`)).status).toBe(404)
    expect((await get(s.viewer, `/blobs/${rec.fileKey}`)).status).toBe(200)
    // The REST list agrees.
    const list = async (who: { cookie: string }) =>
      (
        (await asJson(await get(who, `/api/shows/${s.show.id}/exports`)).json()).exports as {
          id: string
        }[]
      ).map((r) => r.id)
    expect(await list(s.owner)).not.toContain(rec.id)
    expect(await list(s.viewer)).toContain(rec.id)
  })

  test('an export key with no record row is 404, even for an owner', async () => {
    const key = exportBlobKey(s.show.id, newId(), newId(), 'pdf')
    expect((await get(s.owner, `/blobs/${key}`)).status).toBe(404)
  })

  test("a blob whose key is not the record's file_key is 404", async () => {
    const rec = await createExportRecord(s.deps.db, s.deps.blobs, s.actors.owner, input())
    // A second file under the same export id that the record does not point at.
    const stray = exportBlobKey(s.show.id, rec.id, newId(), 'pdf')
    await s.deps.blobs.put(stray, pdfBytes(), 'application/pdf')
    expect((await get(s.owner, `/blobs/${stray}`)).status).toBe(404)
    expect((await get(s.owner, `/blobs/${rec.fileKey}`)).status).toBe(200)
    // Keys under exports/ that do not have the five-segment shape are 404 too.
    expect((await get(s.owner, `/blobs/shows/${s.show.id}/exports/${rec.id}`)).status).toBe(404)
  })

  test('a shared export is listed for every member, newest first, and readable', async () => {
    const older = await createExportRecord(
      s.deps.db,
      s.deps.blobs,
      s.actors.owner,
      input({ createdAt: new Date('2026-01-01T00:00:00Z') }),
    )
    const newer = await createExportRecord(
      s.deps.db,
      s.deps.blobs,
      s.actors.editorLx,
      input({ createdAt: new Date('2026-02-01T00:00:00Z') }),
    )
    for (const actor of [s.actors.owner, s.actors.viewer, s.actors.editorLx]) {
      const ids = (await listExportRecords(s.deps.db, actor, { showId: s.show.id })).map(
        (r) => r.id,
      )
      expect(ids.indexOf(newer.id)).toBeGreaterThanOrEqual(0)
      expect(ids.indexOf(newer.id)).toBeLessThan(ids.indexOf(older.id))
    }
    expect((await get(s.viewer, `/blobs/${older.fileKey}`)).status).toBe(200)
  })

  test("including another user's personal layer is forbidden", async () => {
    const res = await post(
      s.viewer,
      meta({ layerSelection: [{ kind: 'personal', id: s.owner.id }] }),
    )
    expect(res.status).toBe(403)
    expect(
      await code(
        createExportRecord(
          s.deps.db,
          s.deps.blobs,
          s.actors.viewer,
          input({ layerSelection: [{ kind: 'personal', id: s.owner.id }] }),
        ),
      ),
    ).toBe('forbidden')
  })

  test('a department that is not in this show is invalid', async () => {
    expect(
      await code(
        createExportRecord(
          s.deps.db,
          s.deps.blobs,
          s.actors.owner,
          input({ layerSelection: [{ kind: 'department', id: newId() }] }),
        ),
      ),
    ).toBe('invalid')
  })

  test('a non-PDF file is 400 and nothing is stored, for both PDF kinds (CSV and XLSX have their own checks)', async () => {
    for (const kind of ['pdf-script', 'pdf-sheet'] as const) {
      const id = newId()
      const res = await post(s.owner, meta({ id, kind }), {
        bytes: new TextEncoder().encode('a,b\n1,2\n'),
      })
      expect([kind, res.status]).toEqual([kind, 400])
      expect((await blobFiles(s.deps)).filter((f) => f.includes(`/exports/${id}/`))).toEqual([])
      expect(await s.deps.db.select().from(exportRecords).where(eq(exportRecords.id, id))).toEqual(
        [],
      )
    }
  })

  test('bad metadata is 400: kind, filename, id, JSON, missing file', async () => {
    const bad: Array<[string, Record<string, unknown> | string]> = [
      ['tmix kind', meta({ kind: 'tmix' })],
      ['unknown kind', meta({ kind: 'docx' })],
      ['empty filename', meta({ filename: '   ' })],
      ['long filename', meta({ filename: 'x'.repeat(201) })],
      ['NUL filename', meta({ filename: 'a\u0000b.pdf' })],
      ['non-uuid id', meta({ id: 'nope' })],
      ['bad createdAt', meta({ createdAt: '1999-01-01T00:00:00Z' })],
      ['selection not an array', meta({ layerSelection: 'all' })],
      ['not json', '{nope'],
    ]
    for (const [name, m] of bad) {
      const res = await post(s.owner, m)
      expect([name, res.status]).toEqual([name, 400])
    }
    expect((await post(s.owner, meta(), null)).status).toBe(400)
    // 200 characters is fine.
    expect((await post(s.owner, meta({ filename: 'x'.repeat(200) }))).status).toBe(201)
  })

  test('createdAt is honoured when given', async () => {
    const res = await post(s.owner, meta({ createdAt: '2026-03-04T05:06:07.000Z' }))
    expect(res.status).toBe(201)
    expect((await res.json()).createdAt).toBe('2026-03-04T05:06:07.000Z')
  })

  test('a non-member gets 404, a token scoped elsewhere gets 403 (list, upload and blob)', async () => {
    const rec = await createExportRecord(s.deps.db, s.deps.blobs, s.actors.owner, input())
    expect((await post(s.outsider, meta())).status).toBe(404)
    expect((await get(s.outsider, `/api/shows/${s.show.id}/exports`)).status).toBe(404)
    expect((await get(s.outsider, `/blobs/${rec.fileKey}`)).status).toBe(404)

    const { createShow, listOrganisations } = await import('../src/services')
    const [org] = await listOrganisations(s.deps.db, s.actors.owner)
    const other = await createShow(s.deps.db, s.actors.owner, {
      organisationId: org.id,
      title: 'Elsewhere',
    })
    const { token } = await createToken(s.deps.db, s.actors.owner, {
      name: 'x',
      showScope: [other.id],
    })
    const bearer = { authorization: `Bearer ${token}` }
    expect((await post({ token }, meta())).status).toBe(403)
    expect(
      (await s.app.request(`/api/shows/${s.show.id}/exports`, { headers: bearer })).status,
    ).toBe(403)
    expect((await s.app.request(`/blobs/${rec.fileKey}`, { headers: bearer })).status).toBe(403)
    // The same denial for a key with no row: scope is checked before existence.
    const ghost = exportBlobKey(s.show.id, newId(), newId(), 'pdf')
    expect((await s.app.request(`/blobs/${ghost}`, { headers: bearer })).status).toBe(403)
  })

  test('an archived show still takes uploads and server-side exports (M1-R20)', async () => {
    const fresh = await setupMarkupShow()
    const key = searchableBlobKey(fresh.show.id, fresh.docId, fresh.versionId)
    await fresh.deps.blobs.put(key, pdfBytes(), 'application/pdf')
    await fresh.deps.db
      .update(documentVersions)
      .set({ searchableKey: key })
      .where(eq(documentVersions.id, fresh.versionId))
    await updateShow(fresh.deps.db, fresh.actors.owner, {
      showId: fresh.show.id,
      patch: { status: 'archived' },
    })
    const res = await fresh.app.request(`/api/shows/${fresh.show.id}/exports`, {
      method: 'POST',
      headers: { cookie: fresh.viewer.cookie, origin: APP_ORIGIN },
      body: multipart(
        { meta: JSON.stringify(meta({ layerSelection: [] })) },
        { bytes: pdfBytes() },
      ),
    })
    expect(res.status).toBe(201)
    const { record } = await exportMarkedScript(
      fresh.deps.db,
      fresh.deps.blobs,
      fresh.actors.viewer,
      {
        documentId: fresh.docId,
        layers: 'all',
      },
    )
    expect(record.showId).toBe(fresh.show.id)
    // Membership still decides: an outsider is refused.
    const outsider = { userId: fresh.outsider.id, via: 'web' as const, agent: null }
    expect(
      await code(
        exportMarkedScript(fresh.deps.db, fresh.deps.blobs, outsider, {
          documentId: fresh.docId,
          layers: 'all',
        }),
      ),
    ).toBe('not_found')
  })

  test('export_records is not writable through sync upload', async () => {
    const id = newId()
    const result = await applyCrudBatch(
      s.deps.db,
      { userId: s.owner.id, via: 'sync', agent: null },
      {
        batchId: newId(),
        entries: [
          {
            table: 'export_records',
            id,
            op: 'PUT',
            data: { show_id: s.show.id, kind: 'csv', filename: 'x.csv', file_key: 'k' },
          },
        ],
      },
    )
    expect(result.applied).toBe(0)
    expect(result.rejected).toEqual([
      {
        index: 0,
        table: 'export_records',
        id,
        reason: 'unknown_table',
        message: expect.any(String),
      },
    ])
    expect(await s.deps.db.select().from(exportRecords).where(eq(exportRecords.id, id))).toEqual([])
  })
})

describe('oversize uploads', () => {
  const MB = 1024 * 1024
  const exportFiles = async (id: string) =>
    (await blobFiles(s.deps)).filter((f) => f.includes(`/exports/${id}/`))

  /** A multipart request whose file streams `fileBytes` zero bytes after `%PDF-`, with a chosen Content-Length. */
  function streamingUpload(id: string, fileBytes: number, contentLength: number) {
    const boundary = '----binderBoundary'
    const enc = new TextEncoder()
    const metaPart = `--${boundary}\r\ncontent-disposition: form-data; name="meta"\r\n\r\n${JSON.stringify(meta({ id }))}\r\n`
    const head = enc.encode(
      `${metaPart}--${boundary}\r\ncontent-disposition: form-data; name="file"; filename="big.pdf"\r\ncontent-type: application/pdf\r\n\r\n%PDF-1.7\n`,
    )
    const tail = enc.encode(`\r\n--${boundary}--\r\n`)
    const chunk = new Uint8Array(MB)
    let sent = 0
    let started = false
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!started) {
          started = true
          controller.enqueue(head)
          return
        }
        if (sent >= fileBytes) {
          controller.enqueue(tail)
          controller.close()
          return
        }
        const n = Math.min(MB, fileBytes - sent)
        controller.enqueue(n === MB ? chunk : chunk.subarray(0, n))
        sent += n
      },
    })
    return s.app.request(`/api/shows/${s.show.id}/exports`, {
      method: 'POST',
      headers: {
        cookie: s.owner.cookie,
        origin: APP_ORIGIN,
        'content-type': `multipart/form-data; boundary=${boundary}`,
        'content-length': String(contentLength),
      },
      body,
      duplex: 'half',
    } as RequestInit)
  }

  test('an over-size Content-Length is 413 payload_too_large with nothing stored', async () => {
    const id = newId()
    const res = await post(s.owner, meta({ id }), { bytes: pdfBytes() }, s.show.id, {
      'content-length': String(MAX_UPLOAD_BYTES + 1),
    })
    expect(res.status).toBe(413)
    expect((await res.json()).error).toBe('payload_too_large')
    expect(await exportFiles(id)).toEqual([])
    expect(await s.deps.db.select().from(exportRecords).where(eq(exportRecords.id, id))).toEqual([])
  })

  test('a streamed body past the cap is cut: 413, no blob, no row', async () => {
    const id = newId()
    const res = asJson(await streamingUpload(id, 201 * MB, 100 * MB))
    expect(res.status).toBe(413)
    expect((await res.json()).error).toBe('payload_too_large')
    expect(await exportFiles(id)).toEqual([])
    expect(await s.deps.db.select().from(exportRecords).where(eq(exportRecords.id, id))).toEqual([])
  }, 60_000)
})

describe('readableExport', () => {
  test('missing, private to someone else, wrong show and wrong key are all not_found', async () => {
    const priv = await createExportRecord(
      s.deps.db,
      s.deps.blobs,
      s.actors.viewer,
      input({ layerSelection: [{ kind: 'personal', id: s.viewer.id }] }),
    )
    const shared = await createExportRecord(s.deps.db, s.deps.blobs, s.actors.owner, input())
    const db = s.deps.db
    expect(await code(readableExport(db, s.actors.owner, { exportId: newId() }))).toBe('not_found')
    expect(await code(readableExport(db, s.actors.owner, { exportId: priv.id }))).toBe('not_found')
    expect(await code(readableExport(db, s.actors.viewer, { exportId: priv.id }))).toBe('ok')
    expect(
      await code(readableExport(db, s.actors.owner, { exportId: shared.id, showId: newId() })),
    ).toBe('not_found')
    expect(
      await code(
        readableExport(db, s.actors.owner, { exportId: shared.id, fileKey: priv.fileKey }),
      ),
    ).toBe('not_found')
    expect(
      await code(
        readableExport(db, s.actors.owner, {
          exportId: shared.id,
          showId: s.show.id,
          fileKey: shared.fileKey,
        }),
      ),
    ).toBe('ok')
  })
})

describe('exportMarkedScript', () => {
  async function ready(over: Partial<{ title: string }> = {}) {
    const fresh = await setupMarkupShow()
    const key = searchableBlobKey(fresh.show.id, fresh.docId, fresh.versionId)
    await fresh.deps.blobs.put(key, pdfBytes(), 'application/pdf')
    await fresh.deps.db
      .update(documentVersions)
      .set({ searchableKey: key, label: 'v1' })
      .where(eq(documentVersions.id, fresh.versionId))
    if (over.title) {
      await fresh.deps.db
        .update(documents)
        .set({ title: over.title })
        .where(eq(documents.id, fresh.docId))
    }
    return fresh
  }

  const footerOf = async (bytes: Uint8Array) => {
    const path = join(work, `${newId()}.pdf`)
    await writeFile(path, bytes)
    return (await run('pdftotext', ['-f', '1', '-l', '1', path, '-'])).stdout
  }

  async function readRecord(f: Setup, rec: { fileKey: string }) {
    const blob = await f.deps.blobs.get(rec.fileKey)
    if (!blob) throw new Error('export blob missing')
    const chunks: Buffer[] = []
    for await (const c of blob.stream) chunks.push(c as Buffer)
    return new Uint8Array(Buffer.concat(chunks))
  }

  test("'all' exports every visible department and no personal layer, as a shared record", async () => {
    const f = await ready()
    await updateDepartment(f.deps.db, f.actors.owner, {
      departmentId: f.depts.FLY.id,
      patch: { hidden: true },
    })
    await createCue(f.deps.db, f.actors.owner, {
      showId: f.show.id,
      departmentId: f.depts.LX.id,
      number: { major: 10, minor: 0 },
      label: 'lx go',
      anchor: anchorAt(f.docId, f.versionId, 0),
    })
    const { record, uri } = await exportMarkedScript(f.deps.db, f.deps.blobs, f.actors.viewer, {
      documentId: f.docId,
      layers: 'all',
    })
    expect(uri).toBe(`binder://shows/${f.show.id}/exports/${record.id}`)
    expect(record).toMatchObject({
      kind: 'pdf-script',
      filename: 'Show - Libretto v1 - All layers.pdf',
      privateTo: null,
      createdBy: f.viewer.id,
      snapshotId: null,
      binderVersion: null,
      changelog: null,
    })
    const selected = (record.layerSelection as LayerRef[]).map((l) => `${l.kind}:${l.id}`)
    expect(selected).toContain(`department:${f.depts.LX.id}`)
    expect(selected).not.toContain(`department:${f.depts.FLY.id}`)
    expect(selected.some((k) => k.startsWith('personal:'))).toBe(false)

    const bytes = await readRecord(f, record)
    const original = await PDFDocument.load(pdfBytes())
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(original.getPageCount())
    expect(bytes.length).toBeGreaterThan(0)
  })

  test.skipIf(skipPoppler)(
    'the footer carries the layer label and the export id, not a Binder version',
    async () => {
      const f = await ready()
      const { record } = await exportMarkedScript(f.deps.db, f.deps.blobs, f.actors.owner, {
        documentId: f.docId,
        layers: 'none',
      })
      expect(record.filename).toBe('Show - Libretto v1 - Clean copy.pdf')
      const text = await footerOf(await readRecord(f, record))
      expect(text).toContain('Show · Libretto v1 · Clean copy · export ')
      expect(text).toContain(`export ${record.id.slice(-8)}`)
    },
  )

  test('a selection with my personal layer makes the record private to me and says so in the name', async () => {
    const f = await ready()
    await createAnnotation(f.deps.db, f.actors.viewer, {
      showId: f.show.id,
      layerKind: 'personal',
      layerId: f.viewer.id,
      anchor: anchorAt(f.docId, f.versionId, 0),
      type: 'note',
      geometry: {},
      text: 'private note',
      style: {},
    })
    const { record } = await exportMarkedScript(f.deps.db, f.deps.blobs, f.actors.viewer, {
      documentId: f.docId,
      layers: [
        { kind: 'department', id: f.depts.LX.id },
        { kind: 'personal', id: f.viewer.id },
      ],
    })
    expect(record.privateTo).toBe(f.viewer.id)
    expect(record.filename).toBe('Show - Libretto v1 - LX + personal.pdf')
    expect(
      (await listExportRecords(f.deps.db, f.actors.owner, { showId: f.show.id })).map((r) => r.id),
    ).not.toContain(record.id)
    // Another member's personal layer cannot be asked for.
    expect(
      await code(
        exportMarkedScript(f.deps.db, f.deps.blobs, f.actors.owner, {
          documentId: f.docId,
          layers: [{ kind: 'personal', id: f.viewer.id }],
        }),
      ),
    ).toBe('forbidden')
  })

  test.skipIf(skipPoppler)(
    "a selection with my personal layer prints my notes and never another member's",
    async () => {
      const f = await ready()
      const at = (y: number) => anchorAt(f.docId, f.versionId, 0, 100, y)
      const note = (actor: typeof f.actors.viewer, userId: string, text: string, y: number) =>
        createAnnotation(f.deps.db, actor, {
          showId: f.show.id,
          layerKind: 'personal',
          layerId: userId,
          anchor: at(y),
          type: 'note',
          geometry: {},
          text,
          style: {},
        })
      await createCue(f.deps.db, f.actors.owner, {
        showId: f.show.id,
        departmentId: f.depts.LX.id,
        number: { major: 10, minor: 0 },
        label: 'CUELABELX',
        anchor: at(700),
      })
      await note(f.actors.viewer, f.viewer.id, 'MINEZEBRA', 500)
      await note(f.actors.owner, f.owner.id, 'THEIRSQUOKKA', 300)
      const { record } = await exportMarkedScript(f.deps.db, f.deps.blobs, f.actors.viewer, {
        documentId: f.docId,
        layers: [
          { kind: 'department', id: f.depts.LX.id },
          { kind: 'personal', id: f.viewer.id },
        ],
      })
      expect(record.privateTo).toBe(f.viewer.id)
      const text = await footerOf(await readRecord(f, record))
      expect(text).toContain('CUELABELX')
      expect(text).toContain('MINEZEBRA')
      expect(text).not.toContain('THEIRSQUOKKA')
    },
  )

  test('filename characters / \\ : * ? " < > | become dashes', async () => {
    const f = await ready({ title: 'Act 1/2: "Intro"?' })
    await f.deps.db.update(shows).set({ title: 'A|B*C' }).where(eq(shows.id, f.show.id))
    const { record } = await exportMarkedScript(f.deps.db, f.deps.blobs, f.actors.owner, {
      documentId: f.docId,
      layers: 'none',
    })
    expect(record.filename).toBe('A-B-C - Act 1-2- -Intro-- v1 - Clean copy.pdf')
  })

  test('a version without a searchable PDF, an unknown document, a non-member and an unknown version are refused', async () => {
    const f = await setupMarkupShow()
    const call = (actor: typeof f.actors.owner, over: Record<string, unknown> = {}) =>
      exportMarkedScript(f.deps.db, f.deps.blobs, actor, {
        documentId: f.docId,
        layers: 'none',
        ...over,
      })
    expect(await code(call(f.actors.owner))).toBe('invalid')
    expect(await code(call(f.actors.owner, { documentId: newId() }))).toBe('not_found')
    expect(await code(call(f.actors.owner, { versionId: newId() }))).toBe('not_found')
    const outsider: typeof f.actors.owner = { userId: f.outsider.id, via: 'web', agent: null }
    expect(await code(call(outsider))).toBe('not_found')
  })
})

describe('export keys', () => {
  test('exportBlobKey and parseExportKey round-trip; other keys do not parse', () => {
    const key = exportBlobKey('s1', 'e1', 'n1', 'xlsx')
    expect(key).toBe('shows/s1/exports/e1/n1.xlsx')
    expect(parseExportKey(key)).toEqual({ showId: 's1', exportId: 'e1' })
    expect(parseExportKey('shows/s1/documents/d/versions/v/original.pdf')).toBeNull()
    expect(parseExportKey('shows/s1/exports/e1')).toBeNull()
    expect(parseExportKey('shows/s1/exports/e1/a/b.pdf')).toBeNull()
  })
})
