import { createReadStream, existsSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { changeLog, cues, documents, documentVersions, pages, shows } from '@binder/db'
import { FIXTURES } from '@binder/fixtures'
import { type Actor, newId } from '@binder/shared'
import { and, asc, eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { searchableBlobKey } from '../src/blob/keys'
import { AppError } from '../src/errors'
import { markVersionFailed, processDocumentVersion } from '../src/processing/documentJob'
import type { ProcessingDeps } from '../src/processing/types'
import {
  addDocumentVersion,
  cancelVersionProcessing,
  createDocument,
  listDepartments,
  removeVersion,
  retryVersion,
  revertBatch,
  revertChange,
} from '../src/services'
import { asJson, librettoBytes, setupShow } from './documentHelpers'
import { APP_ORIGIN, RecordingJobs } from './helpers'
import { anchorAt } from './markupHelpers'
import { missingTools, processVersion } from './processingHelpers'
import { skipWithoutTools } from './tools'

const skip = skipWithoutTools('processing controls tests', missingTools)

type Setup = Awaited<ReturnType<typeof setupShow>>
let s: Setup
let editor: Actor
let viewer: Actor
let work: string

beforeAll(async () => {
  s = await setupShow()
  editor = { userId: s.editor.id, via: 'web', agent: null }
  viewer = { userId: s.viewer.id, via: 'web', agent: null }
  work = await mkdtemp(join(tmpdir(), 'binder-controls-test-'))
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})
afterAll(async () => {
  await rm(work, { recursive: true, force: true })
})

const db = () => s.deps.db
const blobs = () => s.deps.blobs
const jobs = () => s.jobs

const code = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e) => (e instanceof AppError ? e.code : `other: ${e}`),
  )

/** A new libretto document (version 1, queued, original stored). */
async function upload(title = 'Script') {
  return createDocument(db(), blobs(), jobs(), s.ownerActor, {
    showId: s.show.id,
    kind: 'libretto',
    title,
    file: Readable.from([librettoBytes()]),
  })
}

async function addVersion(documentId: string, label = 'Rev') {
  return addDocumentVersion(db(), blobs(), jobs(), s.ownerActor, {
    documentId,
    showId: s.show.id,
    label,
    file: Readable.from([librettoBytes()]),
  })
}

const setStatus = (
  versionId: string,
  status: 'queued' | 'processing' | 'ready' | 'failed',
  extra: Partial<typeof documentVersions.$inferInsert> = {},
) =>
  db()
    .update(documentVersions)
    .set({ status, ...extra })
    .where(eq(documentVersions.id, versionId))

const loadVersion = async (versionId: string) =>
  (await db().select().from(documentVersions).where(eq(documentVersions.id, versionId)))[0]
const loadPages = (versionId: string) =>
  db().select().from(pages).where(eq(pages.documentVersionId, versionId)).orderBy(asc(pages.index))
const loadDocument = async (documentId: string) =>
  (await db().select().from(documents).where(eq(documents.id, documentId)))[0]

async function addPage(versionId: string, index = 0, keys: { thumbKey?: string } = {}) {
  await db()
    .insert(pages)
    .values({ id: newId(), showId: s.show.id, documentVersionId: versionId, index, ...keys })
}

const logFor = (rowId: string) =>
  db().select().from(changeLog).where(eq(changeLog.rowId, rowId)).orderBy(asc(changeLog.seq))

const processingDeps = (): ProcessingDeps & { jobs: RecordingJobs } => ({
  db: db(),
  blobs: blobs(),
  jobs: new RecordingJobs(),
})

/** A version that failed the way a dead letter fails it. */
async function failedVersion(failureCode: 'unknown' | 'timeout' | 'unreadable' = 'unknown') {
  const created = await upload(`failed ${newId()}`)
  await markVersionFailed(
    db(),
    created.version.id,
    'Processing failed after retries: boom',
    failureCode,
  )
  return created
}

describe('cancelVersionProcessing', () => {
  test('cancel flips a queued version to failed/cancelled, deletes pages, logs', async () => {
    const { version } = await upload()
    await addPage(version.id)
    await addPage(version.id, 1)

    const cancelled = await cancelVersionProcessing(db(), s.ownerActor, { versionId: version.id })

    expect(cancelled).toMatchObject({
      id: version.id,
      status: 'failed',
      failureCode: 'cancelled',
      error: 'Cancelled',
      updatedBy: s.owner.id,
    })
    expect(await loadPages(version.id)).toHaveLength(0)
    const log = (await logFor(version.id)).filter((r) => r.op === 'update')
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({
      tableName: 'document_versions',
      userId: s.owner.id,
      before: { status: 'queued' },
      after: { status: 'failed', failureCode: 'cancelled' },
    })
  })

  test('cancelling twice returns the cancelled version and logs once', async () => {
    const { version } = await upload()
    await cancelVersionProcessing(db(), s.ownerActor, { versionId: version.id })
    const again = await cancelVersionProcessing(db(), s.ownerActor, { versionId: version.id })
    expect(again.failureCode).toBe('cancelled')
    expect((await logFor(version.id)).filter((r) => r.op === 'update')).toHaveLength(1)
  })

  test('cancel on a ready version is conflict', async () => {
    const { version } = await upload()
    await setStatus(version.id, 'ready')
    await expect(
      cancelVersionProcessing(db(), s.ownerActor, { versionId: version.id }),
    ).rejects.toMatchObject({ code: 'conflict', message: 'This upload has already finished' })
    expect((await loadVersion(version.id))?.status).toBe('ready')
  })

  test('cancel on a version that failed for another reason is conflict', async () => {
    const { version } = await failedVersion('timeout')
    expect(await code(cancelVersionProcessing(db(), s.ownerActor, { versionId: version.id }))).toBe(
      'conflict',
    )
  })

  test('an editor may cancel, a viewer and an outsider may not, and neither can reach another show', async () => {
    const mine = await upload()
    expect(await code(cancelVersionProcessing(db(), viewer, { versionId: mine.version.id }))).toBe(
      'forbidden',
    )
    expect(
      await code(
        cancelVersionProcessing(
          db(),
          { userId: s.outsider.id, via: 'web', agent: null },
          { versionId: mine.version.id },
        ),
      ),
    ).toBe('not_found')
    expect(
      await code(
        cancelVersionProcessing(db(), s.ownerActor, {
          versionId: mine.version.id,
          showId: 'some-other-show',
        }),
      ),
    ).toBe('not_found')
    expect((await loadVersion(mine.version.id))?.status).toBe('queued')
    await cancelVersionProcessing(db(), editor, { versionId: mine.version.id })
    expect((await loadVersion(mine.version.id))?.failureCode).toBe('cancelled')
  })

  test('cancel in an archived show is refused', async () => {
    const other = await setupShow()
    const { version } = await createDocument(
      other.deps.db,
      other.deps.blobs,
      other.jobs,
      other.ownerActor,
      {
        showId: other.show.id,
        kind: 'libretto',
        title: 'S',
        file: Readable.from([librettoBytes()]),
      },
    )
    await other.deps.db.update(shows).set({ status: 'archived' }).where(eq(shows.id, other.show.id))
    expect(
      await code(
        cancelVersionProcessing(other.deps.db, other.ownerActor, { versionId: version.id }),
      ),
    ).toBe('forbidden')
    expect(
      (
        await other.deps.db
          .select()
          .from(documentVersions)
          .where(eq(documentVersions.id, version.id))
      )[0]?.status,
    ).toBe('queued')
  })

  test.skipIf(skip)(
    'cancel during OCR kills ocrmypdf within about 3 s',
    async () => {
      const pidFile = join(work, 'ocr.pid')
      vi.stubEnv('PIDFILE', pidFile)
      const bin = join(work, 'stand-in')
      await mkdir(bin, { recursive: true })
      await writeFile(
        join(bin, 'ocrmypdf'),
        '#!/bin/sh\nsleep 300 &\necho $! > "$PIDFILE"\nwait\n',
        { mode: 0o755 },
      )
      vi.stubEnv('PATH', `${bin}:${process.env.PATH}`)
      const created = await createDocument(db(), blobs(), jobs(), s.ownerActor, {
        showId: s.show.id,
        kind: 'libretto',
        title: 'scan',
        file: createReadStream(FIXTURES.scanPdf),
      })
      const deps = processingDeps()
      let sleeper: number | undefined
      try {
        const job = processDocumentVersion(deps, created.version.id)
        const start = Date.now()
        while (!existsSync(pidFile) || readFileSync(pidFile, 'utf8').trim() === '') {
          if (Date.now() - start > 20_000) throw new Error('the stand-in never started')
          await new Promise((r) => setTimeout(r, 25))
        }
        sleeper = Number(readFileSync(pidFile, 'utf8').trim())
        process.kill(sleeper, 0)

        const cancelledAt = Date.now()
        await cancelVersionProcessing(db(), s.ownerActor, { versionId: created.version.id })
        await job
        expect(Date.now() - cancelledAt).toBeLessThan(4000)
        await vi.waitFor(
          () => {
            expect(() => process.kill(sleeper as number, 0)).toThrow()
          },
          { timeout: 2000 },
        )
      } finally {
        if (sleeper !== undefined)
          try {
            process.kill(sleeper, 'SIGKILL')
          } catch {}
      }
      const after = await loadVersion(created.version.id)
      expect(after).toMatchObject({
        status: 'failed',
        failureCode: 'cancelled',
        searchableKey: null,
      })
      expect(deps.jobs.enqueuedPages).toHaveLength(0)
    },
    60_000,
  )
})

describe('retryVersion', () => {
  test.skipIf(skip)(
    'retry requeues the same blob and a new job processes it to ready',
    async () => {
      const created = await upload('retry me')
      const { version } = created
      await markVersionFailed(db(), version.id, 'Processing failed after retries: boom', 'unknown')
      await addPage(version.id) // a stale row from a half-finished run
      const queue = new RecordingJobs()

      const retried = await retryVersion(db(), blobs(), queue, s.ownerActor, {
        versionId: version.id,
      })

      expect(retried).toMatchObject({
        id: version.id,
        status: 'queued',
        error: null,
        failureCode: null,
        failureDpi: null,
        originalKey: version.originalKey,
        updatedBy: s.owner.id,
      })
      expect(queue.enqueued).toEqual([version.id])
      expect(await loadPages(version.id)).toHaveLength(0)
      const log = (await logFor(version.id)).filter((r) => r.op === 'update')
      expect(log.at(-1)).toMatchObject({
        before: { status: 'failed', failureCode: 'unknown' },
        after: { status: 'queued', failureCode: null },
      })

      const deps = { ...processingDeps(), jobs: queue }
      await processVersion(deps, version.id)
      const done = await loadVersion(version.id)
      expect(done?.status).toBe('ready')
      expect((await loadPages(version.id)).length).toBeGreaterThan(0)
    },
    120_000,
  )

  test('retry works for a cancelled version', async () => {
    const { version } = await upload()
    await cancelVersionProcessing(db(), s.ownerActor, { versionId: version.id })
    const queue = new RecordingJobs()
    const retried = await retryVersion(db(), blobs(), queue, editor, { versionId: version.id })
    expect(retried.status).toBe('queued')
    expect(queue.enqueued).toEqual([version.id])
  })

  test('retry when the original blob is missing is conflict', async () => {
    const { version } = await failedVersion()
    await blobs().delete(version.originalKey)
    const queue = new RecordingJobs()
    await expect(
      retryVersion(db(), blobs(), queue, s.ownerActor, { versionId: version.id }),
    ).rejects.toMatchObject({
      code: 'conflict',
      message: 'The uploaded file is no longer stored; upload it again',
    })
    expect((await loadVersion(version.id))?.status).toBe('failed')
    expect(queue.enqueued).toEqual([])
  })

  test('retry of a non-newest version is conflict', async () => {
    const { document, version } = await failedVersion()
    await addVersion(document.id)
    await expect(
      retryVersion(db(), blobs(), new RecordingJobs(), s.ownerActor, { versionId: version.id }),
    ).rejects.toMatchObject({
      code: 'conflict',
      message: 'A newer version exists; upload again or remove this one',
    })
  })

  test('retry of a version that is not failed is conflict', async () => {
    const { version } = await upload()
    expect(
      await code(
        retryVersion(db(), blobs(), new RecordingJobs(), s.ownerActor, { versionId: version.id }),
      ),
    ).toBe('conflict')
    await setStatus(version.id, 'ready')
    expect(
      await code(
        retryVersion(db(), blobs(), new RecordingJobs(), s.ownerActor, { versionId: version.id }),
      ),
    ).toBe('conflict')
  })

  test('retry marks enqueue_failed if the queue throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { version } = await failedVersion('timeout')
    const failing = {
      enqueueDocumentProcess: async () => {
        throw new Error('queue is down')
      },
      enqueuePageProcess: async () => {},
      enqueueReanchor: async () => {},
    }
    const result = await retryVersion(db(), blobs(), failing, s.ownerActor, {
      versionId: version.id,
    })
    expect(result).toMatchObject({
      status: 'failed',
      failureCode: 'enqueue_failed',
      error: 'Could not queue processing',
    })
    expect((await loadVersion(version.id))?.failureCode).toBe('enqueue_failed')
  })

  test('a viewer may not retry', async () => {
    const { version } = await failedVersion()
    expect(
      await code(
        retryVersion(db(), blobs(), new RecordingJobs(), viewer, { versionId: version.id }),
      ),
    ).toBe('forbidden')
  })
})

describe('removeVersion', () => {
  test('remove of a failed only-version deletes the document too and its blobs', async () => {
    const { document, version } = await failedVersion('unreadable')
    // An orphan from a cancelled-then-retried-then-failed run: the row's searchable_key is empty,
    // but the deterministic searchable blob exists.
    const searchable = searchableBlobKey(version.showId, version.documentId, version.id)
    await blobs().put(
      searchable,
      Readable.from([Buffer.from('%PDF-1.4 orphan')]),
      'application/pdf',
    )
    expect((await loadVersion(version.id))?.searchableKey).toBeNull()
    expect(await blobs().exists(version.originalKey)).toBe(true)

    const result = await removeVersion(db(), blobs(), s.ownerActor, { versionId: version.id })

    expect(result).toEqual({
      versionId: version.id,
      documentId: document.id,
      documentRemoved: true,
    })
    expect(await loadVersion(version.id)).toBeUndefined()
    expect(await loadDocument(document.id)).toBeUndefined()
    expect(await blobs().exists(version.originalKey)).toBe(false)
    expect(await blobs().exists(searchable)).toBe(false)
  })

  test("remove also deletes the row's own searchable key and any page blobs", async () => {
    const { version } = await failedVersion()
    const own = `shows/${version.showId}/documents/${version.documentId}/versions/${version.id}/custom.pdf`
    const thumb = `shows/${version.showId}/documents/${version.documentId}/versions/${version.id}/pages/0/thumb.png`
    await blobs().put(own, Readable.from([Buffer.from('%PDF-1.4')]), 'application/pdf')
    await blobs().put(thumb, Readable.from([Buffer.from('png')]), 'image/png')
    await setStatus(version.id, 'failed', { searchableKey: own })
    await addPage(version.id, 0, { thumbKey: thumb })

    await removeVersion(db(), blobs(), s.ownerActor, { versionId: version.id })

    expect(await blobs().exists(own)).toBe(false)
    expect(await blobs().exists(thumb)).toBe(false)
    expect(await loadPages(version.id)).toHaveLength(0)
  })

  test('remove of a failed v2 keeps v1 current', async () => {
    const { document, version: v1 } = await upload('two versions')
    await setStatus(v1.id, 'ready')
    const v2 = await addVersion(document.id)
    await markVersionFailed(db(), v2.id, 'boom', 'unknown')

    const result = await removeVersion(db(), blobs(), s.ownerActor, { versionId: v2.id })

    expect(result.documentRemoved).toBe(false)
    expect(await loadVersion(v2.id)).toBeUndefined()
    expect(await blobs().exists(v2.originalKey)).toBe(false)
    expect((await loadVersion(v1.id))?.status).toBe('ready')
    expect((await loadDocument(document.id))?.currentVersionId).toBe(v1.id)
    // No document-level change was needed, so none is logged for the document.
    const docLog = (await logFor(document.id)).filter((r) => r.op !== 'insert')
    expect(docLog).toHaveLength(0)
  })

  test('removing the current failed version moves current to the highest ready, else none', async () => {
    const { document, version: v1 } = await upload('current failed')
    await markVersionFailed(db(), v1.id, 'boom', 'unknown')
    const v2 = await addVersion(document.id)
    await setStatus(v2.id, 'ready')
    expect((await loadDocument(document.id))?.currentVersionId).toBe(v1.id)

    await removeVersion(db(), blobs(), s.ownerActor, { versionId: v1.id })
    expect((await loadDocument(document.id))?.currentVersionId).toBe(v2.id)
    const docLog = (await logFor(document.id)).filter((r) => r.op === 'update')
    expect(docLog.at(-1)).toMatchObject({
      before: { currentVersionId: v1.id },
      after: { currentVersionId: v2.id },
    })

    // Now a failed current with only another failed version: nothing is ready, so current is null.
    const a = await upload('none ready')
    await markVersionFailed(db(), a.version.id, 'boom', 'unknown')
    const b = await addVersion(a.document.id)
    await markVersionFailed(db(), b.id, 'boom', 'unknown')
    await removeVersion(db(), blobs(), s.ownerActor, { versionId: a.version.id })
    expect((await loadDocument(a.document.id))?.currentVersionId).toBeNull()
  })

  test('remove of a ready version is conflict, and so is one still processing', async () => {
    const { version } = await upload()
    expect(await code(removeVersion(db(), blobs(), s.ownerActor, { versionId: version.id }))).toBe(
      'conflict',
    )
    await setStatus(version.id, 'ready')
    expect(await code(removeVersion(db(), blobs(), s.ownerActor, { versionId: version.id }))).toBe(
      'conflict',
    )
    expect(await loadVersion(version.id)).toBeDefined()
    expect(await blobs().exists(version.originalKey)).toBe(true)
  })

  test('remove refuses when a cue is anchored to the version', async () => {
    const { document, version } = await failedVersion()
    const [dept] = await listDepartments(db(), s.ownerActor, { showId: s.show.id })
    const cueId = newId()
    await db()
      .insert(cues)
      .values({
        id: cueId,
        showId: s.show.id,
        departmentId: dept.id,
        major: 1,
        anchor: anchorAt(document.id, version.id, 0),
        updatedBy: s.owner.id,
      })
    expect(await code(removeVersion(db(), blobs(), s.ownerActor, { versionId: version.id }))).toBe(
      'conflict',
    )
    expect(await loadVersion(version.id)).toBeDefined()
    expect(await blobs().exists(version.originalKey)).toBe(true)
    await db().delete(cues).where(eq(cues.id, cueId))
  })

  test('a viewer may not remove, an editor may, and the second remove is not_found', async () => {
    const { version } = await failedVersion()
    expect(await code(removeVersion(db(), blobs(), viewer, { versionId: version.id }))).toBe(
      'forbidden',
    )
    await removeVersion(db(), blobs(), editor, { versionId: version.id })
    expect(await code(removeVersion(db(), blobs(), editor, { versionId: version.id }))).toBe(
      'not_found',
    )
  })
})

describe('change log', () => {
  test('change log records cancel, retry and remove; revert refuses them', async () => {
    const { document, version } = await upload('logged')
    const batchOf = async (rowId: string, op: 'update' | 'delete') =>
      (await logFor(rowId)).filter((r) => r.op === op).at(-1)

    await cancelVersionProcessing(db(), s.ownerActor, { versionId: version.id })
    const cancelRow = await batchOf(version.id, 'update')
    expect(cancelRow).toMatchObject({ after: { failureCode: 'cancelled' } })

    await retryVersion(db(), blobs(), new RecordingJobs(), s.ownerActor, { versionId: version.id })
    const retryRow = await batchOf(version.id, 'update')
    expect(retryRow?.seq).toBeGreaterThan(cancelRow?.seq ?? 0)
    expect(retryRow).toMatchObject({ before: { status: 'failed' }, after: { status: 'queued' } })

    await cancelVersionProcessing(db(), s.ownerActor, { versionId: version.id })
    await removeVersion(db(), blobs(), s.ownerActor, { versionId: version.id })
    const removeRow = await batchOf(version.id, 'delete')
    expect(removeRow).toMatchObject({
      tableName: 'document_versions',
      userId: s.owner.id,
      before: { failureCode: 'cancelled', documentId: document.id, versionNumber: 1 },
      after: null,
    })
    const docDelete = await batchOf(document.id, 'delete')
    expect(docDelete).toMatchObject({ tableName: 'documents', after: null })
    // The document delete and the version delete are one batch, so the feed counts one removal.
    expect(docDelete?.batchId).toBe(removeRow?.batchId)

    for (const row of [cancelRow, retryRow, removeRow, docDelete]) {
      expect(
        await code(revertChange(db(), s.ownerActor, { seq: row?.seq ?? 0, showId: s.show.id })),
        `revert of seq ${row?.seq}`,
      ).toBe('invalid')
    }
    expect(
      await code(
        revertBatch(db(), s.ownerActor, {
          batchId: removeRow?.batchId ?? '',
          showId: s.show.id,
          userId: s.owner.id,
        }),
      ),
    ).toBe('invalid')
  })
})

describe('routes', () => {
  const call = async (
    method: 'POST' | 'DELETE',
    cookie: string,
    path: string,
    showId = s.show.id,
  ) =>
    asJson(
      await s.app.request(`/api/shows/${showId}/versions/${path}`, {
        method,
        headers: { cookie, origin: APP_ORIGIN },
      }),
    )

  test('POST cancel returns the version, and 409 once it has finished', async () => {
    const { version } = await upload()
    const res = await call('POST', s.editor.cookie, `${version.id}/cancel`)
    expect(res.status).toBe(200)
    expect((await res.json()).version).toMatchObject({
      id: version.id,
      status: 'failed',
      failureCode: 'cancelled',
    })
    const ready = await upload()
    await setStatus(ready.version.id, 'ready')
    expect((await call('POST', s.editor.cookie, `${ready.version.id}/cancel`)).status).toBe(409)
  })

  test('POST retry requeues and returns the version', async () => {
    const { version } = await failedVersion('timeout')
    const before = s.jobs.enqueued.length
    const res = await call('POST', s.owner.cookie, `${version.id}/retry`)
    expect(res.status).toBe(200)
    expect((await res.json()).version).toMatchObject({ id: version.id, status: 'queued' })
    expect(s.jobs.enqueued.slice(before)).toEqual([version.id])
  })

  test('DELETE removes the version and says whether the document went too', async () => {
    const { document, version } = await failedVersion()
    const res = await call('DELETE', s.owner.cookie, version.id)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      removed: { versionId: version.id, documentId: document.id, documentRemoved: true },
    })
    expect((await call('DELETE', s.owner.cookie, version.id)).status).toBe(404)
  })

  test('403 for a viewer, 404 for an outsider or the wrong show, 409 for the wrong state', async () => {
    const { version } = await failedVersion()
    for (const [method, path] of [
      ['POST', `${version.id}/cancel`],
      ['POST', `${version.id}/retry`],
      ['DELETE', version.id],
    ] as const) {
      expect((await call(method, s.viewer.cookie, path)).status, `${method} ${path}`).toBe(403)
      expect((await call(method, s.outsider.cookie, path)).status, `${method} ${path}`).toBe(404)
      expect(
        (await call(method, s.owner.cookie, path, 'not-this-show')).status,
        `${method} ${path}`,
      ).toBe(404)
    }
    const ready = await upload()
    await setStatus(ready.version.id, 'ready')
    expect((await call('DELETE', s.owner.cookie, ready.version.id)).status).toBe(409)
    expect((await call('POST', s.owner.cookie, `${ready.version.id}/retry`)).status).toBe(409)
  })

  test('a version in another show is not reachable through this one', async () => {
    const other = await setupShow()
    const created = await createDocument(
      other.deps.db,
      other.deps.blobs,
      other.jobs,
      other.ownerActor,
      {
        showId: other.show.id,
        kind: 'libretto',
        title: 'Other',
        file: Readable.from([librettoBytes()]),
      },
    )
    const res = await call('POST', s.owner.cookie, `${created.version.id}/cancel`)
    expect(res.status).toBe(404)
    expect(
      (
        await other.deps.db
          .select({ status: documentVersions.status })
          .from(documentVersions)
          .where(and(eq(documentVersions.id, created.version.id)))
      )[0]?.status,
    ).toBe('queued')
  })
})
