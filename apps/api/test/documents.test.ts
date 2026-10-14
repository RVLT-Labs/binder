import { readFile } from 'node:fs/promises'
import { changeLog, documents, documentVersions, pages } from '@binder/db'
import { asc, eq } from 'drizzle-orm'
import { describe, expect, test, vi } from 'vitest'
import { AppError } from '../src/errors'
import {
  addDocumentVersion,
  createDocument,
  getDocumentVersion,
  listDocuments,
  updateShow,
} from '../src/services'
import { MAX_UPLOAD_BYTES } from '../src/upload/multipart'
import {
  asJson,
  blobFiles,
  librettoBytes,
  postDocument,
  postVersion,
  setupShow,
} from './documentHelpers'
import { APP_ORIGIN } from './helpers'

const MB = 1024 * 1024
const libretto = { kind: 'libretto', title: 'Libretto' }
const code = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e) => (e instanceof AppError ? e.code : 'other'),
  )

/** A multipart request whose file part streams `fileBytes` zero bytes after `%PDF-`, with a chosen Content-Length. */
function streamingUpload(opts: {
  cookie: string
  showId: string
  fileBytes: number
  contentLength: number
  failAfter?: number
}) {
  const boundary = '----binderBoundary'
  const enc = new TextEncoder()
  const part = (name: string, value: string) =>
    `--${boundary}\r\ncontent-disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
  const head = enc.encode(
    `${part('kind', 'libretto')}${part('title', 'Big')}--${boundary}\r\ncontent-disposition: form-data; name="file"; filename="big.pdf"\r\ncontent-type: application/pdf\r\n\r\n%PDF-1.7\n`,
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
      if (opts.failAfter !== undefined && sent >= opts.failAfter) {
        controller.error(new Error('client went away'))
        return
      }
      if (sent >= opts.fileBytes) {
        controller.enqueue(tail)
        controller.close()
        return
      }
      const n = Math.min(MB, opts.fileBytes - sent)
      controller.enqueue(n === MB ? chunk : chunk.subarray(0, n))
      sent += n
    },
  })
  return {
    path: `/api/shows/${opts.showId}/documents`,
    init: {
      method: 'POST',
      headers: {
        cookie: opts.cookie,
        origin: APP_ORIGIN,
        'content-type': `multipart/form-data; boundary=${boundary}`,
        'content-length': String(opts.contentLength),
      },
      body,
      duplex: 'half',
    } as RequestInit,
  }
}

describe('POST /api/shows/:showId/documents', () => {
  test('editor uploads the libretto: 201, version queued, original stored, job enqueued', async () => {
    const { app, deps, jobs, editor, show } = await setupShow()
    const res = await postDocument(app, editor.cookie, show.id, { ...libretto, ocrMode: 'never' })
    expect(res.status).toBe(201)
    const { document, version } = await res.json()

    expect(document).toMatchObject({
      showId: show.id,
      kind: 'libretto',
      title: 'Libretto',
      ocrMode: 'never',
      currentVersionId: version.id,
    })
    expect(version).toMatchObject({
      documentId: document.id,
      showId: show.id,
      versionNumber: 1,
      status: 'queued',
      uploadedBy: editor.id,
      originalKey: `shows/${show.id}/documents/${document.id}/versions/${version.id}/original.pdf`,
    })
    const stored = await deps.blobs.get(version.originalKey)
    expect(stored?.contentType).toBe('application/pdf')
    expect(stored?.size).toBe(librettoBytes().length)
    expect(await readFile(deps.blobs.localPath?.(version.originalKey) ?? '')).toEqual(
      librettoBytes(),
    )
    expect(jobs.enqueued).toEqual([version.id])

    const log = await deps.db.select().from(changeLog).where(eq(changeLog.showId, show.id))
    const created = log.filter((r) => ['documents', 'document_versions'].includes(r.tableName))
    expect(created.map((r) => [r.tableName, r.rowId, r.op]).sort()).toEqual(
      [
        ['document_versions', version.id, 'insert'],
        ['documents', document.id, 'insert'],
      ].sort(),
    )
    expect(new Set(created.map((r) => r.batchId)).size).toBe(1)
    expect(created.every((r) => r.userId === editor.id)).toBe(true)
  })

  test('viewer upload is 403 and writes nothing; non-PDF is 400', async () => {
    const { app, deps, jobs, editor, viewer, show } = await setupShow()
    const forbidden = await postDocument(app, viewer.cookie, show.id, libretto)
    expect(forbidden.status).toBe(403)

    const notPdf = await postDocument(app, editor.cookie, show.id, libretto, {
      bytes: new TextEncoder().encode('MZ this is not a pdf at all'),
    })
    expect(notPdf.status).toBe(400)
    expect((await notPdf.json()).error).toBe('invalid')

    const tiny = await postDocument(app, editor.cookie, show.id, libretto, {
      bytes: new TextEncoder().encode('%PD'),
    })
    expect(tiny.status).toBe(400)

    expect(await blobFiles(deps)).toEqual([])
    expect(await deps.db.select().from(documents).where(eq(documents.showId, show.id))).toEqual([])
    expect(jobs.enqueued).toEqual([])
  })

  test('over-size Content-Length is 413 with no blob written', async () => {
    const { app, deps, editor, show } = await setupShow()
    const res = await postDocument(app, editor.cookie, show.id, libretto, undefined, {
      'content-length': String(MAX_UPLOAD_BYTES + 1),
    })
    expect(res.status).toBe(413)
    expect((await res.json()).error).toBe('payload_too_large')
    expect(await blobFiles(deps)).toEqual([])
    expect(await deps.db.select().from(documents).where(eq(documents.showId, show.id))).toEqual([])
  })

  test('a body longer than its Content-Length is cut at 200MB: 413, no blob, no rows', async () => {
    const { app, deps, jobs, editor, show } = await setupShow()
    const req = streamingUpload({
      cookie: editor.cookie,
      showId: show.id,
      fileBytes: 201 * MB,
      contentLength: 100 * MB,
    })
    const res = asJson(await app.request(req.path, req.init))
    expect(res.status).toBe(413)
    expect((await res.json()).error).toBe('payload_too_large')
    expect(await blobFiles(deps)).toEqual([])
    expect(await deps.db.select().from(documents).where(eq(documents.showId, show.id))).toEqual([])
    expect(
      await deps.db.select().from(documentVersions).where(eq(documentVersions.showId, show.id)),
    ).toEqual([])
    expect(jobs.enqueued).toEqual([])
  }, 60_000)

  test('a client that aborts mid-upload leaves no blob and no rows', async () => {
    const { app, deps, jobs, editor, show } = await setupShow()
    const req = streamingUpload({
      cookie: editor.cookie,
      showId: show.id,
      fileBytes: 50 * MB,
      contentLength: 50 * MB,
      failAfter: 3 * MB,
    })
    const res = asJson(await app.request(req.path, req.init))
    expect(res.status).toBe(400)
    expect(await blobFiles(deps)).toEqual([])
    expect(await deps.db.select().from(documents).where(eq(documents.showId, show.id))).toEqual([])
    expect(jobs.enqueued).toEqual([])
  })

  test('a file part without kind or title is rejected before anything is stored', async () => {
    const { app, deps, editor, show } = await setupShow()
    const bad: Array<[string, Record<string, string>]> = [
      ['bad kind', { kind: 'novel', title: 'T' }],
      ['missing kind', { title: 'T' }],
      ['empty title', { kind: 'libretto', title: '  ' }],
      ['long title', { kind: 'libretto', title: 'x'.repeat(201) }],
      ['bad ocrMode', { kind: 'libretto', title: 'T', ocrMode: 'sometimes' }],
    ]
    for (const [name, fields] of bad) {
      const res = await postDocument(app, editor.cookie, show.id, fields)
      expect([name, res.status]).toEqual([name, 400])
    }
    expect(await blobFiles(deps)).toEqual([])
  })

  test('a missing file is 400', async () => {
    const { app, editor, show } = await setupShow()
    const res = await postDocument(app, editor.cookie, show.id, libretto, null)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid')
  })

  test('a non-multipart body is 400', async () => {
    const { app, editor, show } = await setupShow()
    const res = await app.request(`/api/shows/${show.id}/documents`, {
      method: 'POST',
      headers: { cookie: editor.cookie, origin: APP_ORIGIN, 'content-type': 'application/json' },
      body: '{}',
    })
    expect(res.status).toBe(400)
  })

  test('unauthenticated is 401 and an outsider gets 404', async () => {
    const { app, outsider, show } = await setupShow()
    const anon = await app.request(`/api/shows/${show.id}/documents`, { method: 'POST' })
    expect(anon.status).toBe(401)
    const res = await postDocument(app, outsider.cookie, show.id, libretto)
    expect(res.status).toBe(404)
  })

  test('upload to an archived show is 403 and stores nothing', async () => {
    const { app, deps, ownerActor, editor, show } = await setupShow()
    await updateShow(deps.db, ownerActor, { showId: show.id, patch: { status: 'archived' } })
    const res = await postDocument(app, editor.cookie, show.id, libretto)
    expect(res.status).toBe(403)
    expect(await blobFiles(deps)).toEqual([])
  })

  test('snap_to_text defaults to true for libretto and other, false for score and blocking', async () => {
    const { app, editor, show } = await setupShow()
    const snap: Record<string, boolean | null> = {}
    for (const kind of ['libretto', 'other', 'score', 'blocking']) {
      const res = await postDocument(app, editor.cookie, show.id, { kind, title: kind })
      expect(res.status).toBe(201)
      snap[kind] = (await res.json()).document.snapToText
    }
    expect(snap).toEqual({ libretto: true, other: true, score: false, blocking: false })
  })

  test('the first-version document defaults to ocrMode auto and no label', async () => {
    const { app, editor, show } = await setupShow()
    const { document, version } = await (
      await postDocument(app, editor.cookie, show.id, libretto)
    ).json()
    expect(document.ocrMode).toBe('auto')
    expect(version.label).toBeNull()
  })

  test('the blob is deleted and no rows remain when the row transaction fails', async () => {
    const { deps, ownerActor, show } = await setupShow()
    const { Readable } = await import('node:stream')
    const before = await blobFiles(deps)
    const spy = vi.spyOn(deps.db, 'transaction').mockRejectedValueOnce(new Error('db down'))
    await expect(
      createDocument(deps.db, deps.blobs, deps.jobs, ownerActor, {
        showId: show.id,
        kind: 'libretto',
        title: 'T',
        file: Readable.from([librettoBytes()]),
      }),
    ).rejects.toThrow('db down')
    spy.mockRestore()
    expect(await blobFiles(deps)).toEqual(before)
  })

  test('a failed enqueue marks the version failed but keeps the upload', async () => {
    const { app, deps, jobs, editor, show } = await setupShow()
    jobs.enqueueDocumentProcess = async () => {
      throw new Error('queue down')
    }
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await postDocument(app, editor.cookie, show.id, libretto)
    errors.mockRestore()
    expect(res.status).toBe(201)
    const { version } = await res.json()
    expect(version.status).toBe('failed')
    expect(version.error).toMatch(/queue/i)
    const [row] = await deps.db
      .select()
      .from(documentVersions)
      .where(eq(documentVersions.id, version.id))
    expect(row.status).toBe('failed')
    expect(await deps.blobs.exists(version.originalKey)).toBe(true)
  })
})

describe('POST /api/shows/:showId/documents/:docId/versions', () => {
  test('second upload to the same document is version 2 and does not switch the current version', async () => {
    const { app, deps, jobs, editor, show } = await setupShow()
    const first = await (await postDocument(app, editor.cookie, show.id, libretto)).json()
    const res = await postVersion(app, editor.cookie, show.id, first.document.id, {
      label: 'V2 rehearsal cuts',
    })
    expect(res.status).toBe(201)
    const { version } = await res.json()
    expect(version).toMatchObject({
      documentId: first.document.id,
      versionNumber: 2,
      label: 'V2 rehearsal cuts',
      status: 'queued',
    })
    expect(version.originalKey).toBe(
      `shows/${show.id}/documents/${first.document.id}/versions/${version.id}/original.pdf`,
    )
    expect(await deps.blobs.exists(version.originalKey)).toBe(true)
    expect(jobs.enqueued).toEqual([first.version.id, version.id])
    const [doc] = await deps.db.select().from(documents).where(eq(documents.id, first.document.id))
    expect(doc.currentVersionId).toBe(first.version.id)
    const log = await deps.db.select().from(changeLog).where(eq(changeLog.rowId, version.id))
    expect(log).toHaveLength(1)
  })

  test('concurrent uploads get distinct consecutive version numbers', async () => {
    const { app, deps, editor, show } = await setupShow()
    const first = await (await postDocument(app, editor.cookie, show.id, libretto)).json()
    const results = await Promise.all(
      ['a', 'b', 'c'].map((label) =>
        postVersion(app, editor.cookie, show.id, first.document.id, { label }),
      ),
    )
    expect(results.map((r) => r.status)).toEqual([201, 201, 201])
    const rows = await deps.db
      .select()
      .from(documentVersions)
      .where(eq(documentVersions.documentId, first.document.id))
      .orderBy(asc(documentVersions.versionNumber))
    expect(rows.map((r) => r.versionNumber)).toEqual([1, 2, 3, 4])
  })

  test('validates label, file, and authorisation', async () => {
    const { app, deps, editor, viewer, show } = await setupShow()
    const { document } = await (await postDocument(app, editor.cookie, show.id, libretto)).json()
    const filesBefore = await blobFiles(deps)

    expect((await postVersion(app, editor.cookie, show.id, document.id, {})).status).toBe(400)
    expect(
      (await postVersion(app, editor.cookie, show.id, document.id, { label: '' })).status,
    ).toBe(400)
    expect(
      (await postVersion(app, editor.cookie, show.id, document.id, { label: 'x'.repeat(201) }))
        .status,
    ).toBe(400)
    expect(
      (await postVersion(app, editor.cookie, show.id, document.id, { label: 'V2' }, null)).status,
    ).toBe(400)
    expect(
      (await postVersion(app, viewer.cookie, show.id, document.id, { label: 'V2' })).status,
    ).toBe(403)
    expect(
      (
        await postVersion(
          app,
          editor.cookie,
          show.id,
          document.id,
          { label: 'V2' },
          {
            bytes: new TextEncoder().encode('not a pdf'),
          },
        )
      ).status,
    ).toBe(400)
    expect(await blobFiles(deps)).toEqual(filesBefore)
  })

  test('an unknown document is 404 and a document of another show is not reachable', async () => {
    const { app, deps, ownerActor, owner, editor, show } = await setupShow()
    const unknown = await postVersion(app, editor.cookie, show.id, 'nope', { label: 'V2' })
    expect(unknown.status).toBe(404)

    const { createShow, listOrganisations } = await import('../src/services')
    const [org] = await listOrganisations(deps.db, ownerActor)
    const other = await createShow(deps.db, ownerActor, { organisationId: org.id, title: 'Other' })
    const doc = await (await postDocument(app, owner.cookie, other.id, libretto)).json()
    // Editor of `show` addressing the other show's document through their own show's URL.
    const crossed = await postVersion(app, editor.cookie, show.id, doc.document.id, { label: 'V2' })
    expect(crossed.status).toBe(404)
  })

  test('upload to an archived show is 403', async () => {
    const { app, deps, ownerActor, editor, show } = await setupShow()
    const { document } = await (await postDocument(app, editor.cookie, show.id, libretto)).json()
    await updateShow(deps.db, ownerActor, { showId: show.id, patch: { status: 'archived' } })
    const res = await postVersion(app, editor.cookie, show.id, document.id, { label: 'V2' })
    expect(res.status).toBe(403)
  })
})

describe('GET /api/shows/:showId/documents', () => {
  test('lists documents with their versions to any member', async () => {
    const { app, editor, viewer, outsider, show } = await setupShow()
    const a = await (await postDocument(app, editor.cookie, show.id, libretto)).json()
    await postVersion(app, editor.cookie, show.id, a.document.id, { label: 'V2' })
    await postDocument(app, editor.cookie, show.id, { kind: 'score', title: 'Score' })

    const res = asJson(
      await app.request(`/api/shows/${show.id}/documents`, { headers: { cookie: viewer.cookie } }),
    )
    expect(res.status).toBe(200)
    const { documents: list } = await res.json()
    expect(list.map((d: { title: string }) => d.title)).toEqual(['Libretto', 'Score'])
    expect(list[0].versions.map((v: { versionNumber: number }) => v.versionNumber)).toEqual([1, 2])
    expect(list[1].versions).toHaveLength(1)

    const denied = await app.request(`/api/shows/${show.id}/documents`, {
      headers: { cookie: outsider.cookie },
    })
    expect(denied.status).toBe(404)
  })
})

describe('document services', () => {
  test('getDocumentVersion returns the version with its pages in order, for members only', async () => {
    const { app, deps, ownerActor, editor, outsider, show } = await setupShow()
    const { version } = await (await postDocument(app, editor.cookie, show.id, libretto)).json()
    for (const index of [1, 0]) {
      await deps.db.insert(pages).values({
        id: `pg-${version.id}-${index}`,
        showId: show.id,
        documentVersionId: version.id,
        index,
      })
    }
    const got = await getDocumentVersion(deps.db, ownerActor, { versionId: version.id })
    expect(got.id).toBe(version.id)
    expect(got.pages.map((p) => p.index)).toEqual([0, 1])
    expect(
      await code(
        getDocumentVersion(
          deps.db,
          { userId: outsider.id, via: 'web', agent: null },
          { versionId: version.id },
        ),
      ),
    ).toBe('not_found')
    expect(await code(getDocumentVersion(deps.db, ownerActor, { versionId: 'nope' }))).toBe(
      'not_found',
    )
  })

  test('listDocuments and addDocumentVersion enforce roles', async () => {
    const { deps, jobs, viewer, show } = await setupShow()
    const viewerActor = { userId: viewer.id, via: 'web' as const, agent: null }
    expect(await listDocuments(deps.db, viewerActor, { showId: show.id })).toEqual([])
    const { Readable } = await import('node:stream')
    expect(
      await code(
        addDocumentVersion(deps.db, deps.blobs, jobs, viewerActor, {
          documentId: 'nope',
          label: 'x',
          file: Readable.from([librettoBytes()]),
        }),
      ),
    ).toBe('not_found')
  })
})
