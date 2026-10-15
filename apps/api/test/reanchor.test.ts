import { createReadStream } from 'node:fs'
import { buildWordStream, findQuote, lineCentreY, snapToLine, type VersionText } from '@binder/core'
import { annotations, changeLog, cues, documents, documentVersions, pages } from '@binder/db'
import { FIXTURES } from '@binder/fixtures'
import { type Actor, type Anchor, newId, type VersionStatus } from '@binder/shared'
import type { Client } from '@modelcontextprotocol/client'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { AppError } from '../src/errors'
import { finishVersionIfDone, markPageFailed } from '../src/processing/pageJob'
import {
  handleDocumentDeadLetter,
  handlePageDeadLetter,
  handleReanchorDeadLetter,
} from '../src/processing/queue'
import { REANCHOR_AGENT, reanchorBatchId, reanchorVersion } from '../src/processing/reanchorJob'
import { sweepPendingReanchors } from '../src/processing/reanchorSweep'
import {
  addDocumentVersion,
  createAnnotation,
  createCue,
  createDocument,
  createToken,
  deleteAnnotations,
  deleteCues,
  getShow,
  revertBatch,
  revertChange,
  updateAnnotation,
  updateCue,
  updateShow,
} from '../src/services'
import { logChange } from '../src/services/changeLog'
import { loadVersionText } from '../src/services/wordLayers'
import { RecordingJobs } from './helpers'
import { setupMarkupShow } from './markupHelpers'
import { callTool, connectMcp, resultText } from './mcpHelpers'
import { missingTools, processVersion } from './processingHelpers'
import { skipWithoutTools } from './tools'

const skip = skipWithoutTools('re-anchoring tests', missingTools)

type Setup = Awaited<ReturnType<typeof setupMarkupShow>>
type Row = typeof changeLog.$inferSelect

let s: Setup
/** The real processed document: v1 the libretto, v2 the libretto with lines 201 to 240 cut. */
let A: { docId: string; v1: string; v2: string; reanchors: string[] }
let tplV1: Array<typeof pages.$inferSelect> = []
let tplV2: Array<typeof pages.$inferSelect> = []
const clients: Client[] = []

const db = () => s.deps.db
const deps = (jobs = new RecordingJobs()) => ({ db: s.deps.db, blobs: s.deps.blobs, jobs })
/** The user who uploaded every revision these tests make: the re-anchoring actor. */
const uploaderId = () => s.editor.id

const code = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e) => (e instanceof AppError ? e.code : 'other'),
  )
const message = (p: Promise<unknown>) =>
  p.then(
    () => '',
    (e) => (e instanceof Error ? e.message : String(e)),
  )

beforeAll(async () => {
  s = await setupMarkupShow()
  if (skip) return
  const { document, version: v1 } = await createDocument(
    s.deps.db,
    s.deps.blobs,
    s.jobs,
    s.ownerActor,
    {
      showId: s.show.id,
      kind: 'libretto',
      title: 'Pirates',
      file: createReadStream(FIXTURES.librettoPdf),
    },
  )
  await processVersion(deps(), v1.id)
  const v2 = await addDocumentVersion(s.deps.db, s.deps.blobs, s.jobs, s.ownerActor, {
    documentId: document.id,
    label: 'cut',
    file: createReadStream(FIXTURES.revisedCutPdf),
  })
  // Uploads are attributed to the uploader; the page jobs run as the system.
  await s.deps.db
    .update(documentVersions)
    .set({ uploadedBy: s.editor.id })
    .where(eq(documentVersions.id, v2.id))
  const jobs = new RecordingJobs()
  await processVersion(deps(jobs), v2.id)
  A = { docId: document.id, v1: v1.id, v2: v2.id, reanchors: [...jobs.enqueuedReanchors] }
  tplV1 = await s.deps.db.select().from(pages).where(eq(pages.documentVersionId, v1.id))
  tplV2 = await s.deps.db.select().from(pages).where(eq(pages.documentVersionId, v2.id))
}, 900_000)

afterAll(async () => {
  await Promise.all(clients.map((c) => c.close()))
})

/**
 * A document with a ready, current v1 and a v2 (ready unless said otherwise) that is not current,
 * built from the processed templates' page rows so no processing runs. Uploaded by `uploaderId()`.
 */
async function pair(over: { v2Status?: VersionStatus; showId?: string } = {}) {
  const showId = over.showId ?? s.show.id
  const docId = newId()
  const v1 = newId()
  const v2 = newId()
  await db().insert(documents).values({
    id: docId,
    showId,
    kind: 'libretto',
    title: 'Pirates',
    currentVersionId: v1,
    updatedBy: s.owner.id,
  })
  await db()
    .insert(documentVersions)
    .values([
      {
        id: v1,
        showId,
        documentId: docId,
        versionNumber: 1,
        originalKey: `test/${v1}.pdf`,
        pageCount: tplV1.length,
        uploadedBy: s.owner.id,
        status: 'ready',
      },
      {
        id: v2,
        showId,
        documentId: docId,
        versionNumber: 2,
        originalKey: `test/${v2}.pdf`,
        pageCount: tplV2.length,
        uploadedBy: uploaderId(),
        status: over.v2Status ?? 'ready',
      },
    ])
  for (const [versionId, tpl] of [
    [v1, tplV1],
    [v2, tplV2],
  ] as const) {
    await db()
      .insert(pages)
      .values(
        tpl.map((p) => ({
          ...p,
          id: newId(),
          documentVersionId: versionId,
          showId,
        })),
      )
  }
  return { docId, v1, v2 }
}

const currentOf = async (docId: string) =>
  (await db().select().from(documents).where(eq(documents.id, docId)))[0]?.currentVersionId

const anchorOfCue = async (id: string) =>
  (await db().select().from(cues).where(eq(cues.id, id)))[0]?.anchor as Anchor
const anchorOfNote = async (id: string) =>
  (await db().select().from(annotations).where(eq(annotations.id, id)))[0]?.anchor as Anchor

const rowsOfBatch = (batchId: string): Promise<Row[]> =>
  db().select().from(changeLog).where(eq(changeLog.batchId, batchId)).orderBy(changeLog.seq)

const totalLogs = async () =>
  (await db().select({ seq: changeLog.seq }).from(changeLog).where(eq(changeLog.showId, s.show.id)))
    .length

const noTextAnchor = (docId: string, versionId: string, pageIndex: number): Anchor => ({
  documentId: docId,
  documentVersionId: versionId,
  pageIndex,
  x: 100,
  y: 600,
  status: 'ok',
})

const mkCue = (anchor: Anchor | null, dept: 'LX' | 'SND' | 'TM' = 'LX', actor = s.actors.owner) =>
  createCue(db(), actor, {
    showId: s.show.id,
    departmentId: s.depts[dept].id,
    label: 'c',
    anchor,
  })

const mkNote = (
  anchor: Anchor,
  layer: { kind: 'department' | 'personal'; id: string },
  actor: Actor,
) =>
  createAnnotation(db(), actor, {
    showId: s.show.id,
    layerKind: layer.kind,
    layerId: layer.id,
    anchor,
    type: 'note',
    geometry: {},
    text: 'a note',
    style: {},
  })

/** A snapped anchor on a line of the page whose quote is unique in `versionId` and passes `accept`. */
async function lineAnchor(
  docId: string,
  versionId: string,
  pageIndex: number,
  accept: (quote: string) => boolean = () => true,
): Promise<Anchor> {
  const text = await loadVersionText(db(), s.deps.blobs, versionId)
  const layer = text.layers.get(pageIndex)
  if (!layer) throw new Error(`page ${pageIndex} has no words`)
  const stream = buildWordStream(text.layers)
  for (let lineIndex = 0; lineIndex < layer.lines.length; lineIndex++) {
    const line = (layer.lines[lineIndex] ?? []).filter((i) => layer.words[i])
    if (line.length < 5) continue
    const first = layer.words[line[0] as number]
    if (!first) continue
    const snapped = snapToLine(layer, { x: first.x, y: lineCentreY(layer, lineIndex) })
    if (!snapped) continue
    const quote = snapped.text.quote
    if (findQuote(stream, quote, 'exact').length !== 1 || !accept(quote)) continue
    return {
      documentId: docId,
      documentVersionId: versionId,
      pageIndex,
      x: first.x,
      y: snapped.y,
      text: snapped.text,
      status: 'ok',
    }
  }
  throw new Error(`no usable line on page ${pageIndex}`)
}

const streamOf = (text: VersionText) => buildWordStream(text.layers)

/** A unique-quote anchor on v1 whose quote is unique in v2 as well, so it ends `ok`. */
async function okAnchor(p: { docId: string; v1: string; v2: string }, pageIndex: number) {
  const v2 = streamOf(await loadVersionText(db(), s.deps.blobs, p.v2))
  return lineAnchor(p.docId, p.v1, pageIndex, (q) => findQuote(v2, q, 'exact').length === 1)
}

describe.skipIf(skip)('the re-anchoring run', () => {
  test('a revised libretto (lines cut) is re-anchored after its pages are ready, then becomes current', async () => {
    // processing v2 enqueued the re-anchor and left v1 current
    expect(A.reanchors).toEqual([A.v2])
    expect(await currentOf(A.docId)).toBe(A.v1)
    expect(tplV1.length).toBe(147)
    expect(tplV2.length).toBe(146)

    const ok1 = await okAnchor(A, 1)
    const ok30 = await okAnchor(A, 30)
    const ok100 = await okAnchor(A, 100)
    // inside lines 201 to 240 of pirates.txt (page 4 or 5): a quote the revision no longer has
    const v2Stream = streamOf(await loadVersionText(db(), s.deps.blobs, A.v2))
    const gone = (q: string) =>
      findQuote(v2Stream, q, 'exact').length === 0 &&
      findQuote(v2Stream, q, 'normalised').length === 0
    const cutAnchor = await lineAnchor(A.docId, A.v1, 4, gone).catch(() =>
      lineAnchor(A.docId, A.v1, 5, gone),
    )

    const cueOk1 = await mkCue(ok1, 'LX')
    const cueOk30 = await mkCue(ok30, 'SND')
    const cueOk100 = await mkCue(ok100, 'TM')
    const cueCut = await mkCue(cutAnchor, 'LX')
    const cueNoText = await mkCue(noTextAnchor(A.docId, A.v1, 10), 'LX')
    const cueUnplaced = await mkCue(null, 'LX')
    const note = await mkNote(ok30, { kind: 'personal', id: s.owner.id }, s.actors.owner)
    const batchId = reanchorBatchId(A.v2)

    const result = await reanchorVersion(deps(), A.v2)
    expect(result).toEqual({
      moved: 6,
      byStatus: { ok: 4, approximate: 0, unresolved: 2 },
    })
    expect(await currentOf(A.docId)).toBe(A.v2)

    for (const [cue, source] of [
      [cueOk1, ok1],
      [cueOk30, ok30],
      [cueOk100, ok100],
    ] as const) {
      const moved = await anchorOfCue(cue.id)
      expect(moved).toMatchObject({ documentVersionId: A.v2, status: 'ok' })
      expect(moved.text?.quote).toBe(source.text?.quote)
      expect(moved.text?.wordStart).toBeGreaterThanOrEqual(0)
    }
    // the cut line is gone and the page counts differ: unresolved, still a cue on the new version
    expect(await anchorOfCue(cueCut.id)).toMatchObject({
      documentVersionId: A.v2,
      status: 'unresolved',
    })
    expect(await anchorOfCue(cueNoText.id)).toMatchObject({
      documentVersionId: A.v2,
      pageIndex: 10,
      status: 'unresolved',
    })
    // never deleted, and an unplaced cue is untouched
    expect(await anchorOfCue(cueUnplaced.id)).toBeNull()
    // the personal note moved with the rest
    expect(await anchorOfNote(note.id)).toMatchObject({ documentVersionId: A.v2, status: 'ok' })

    const rows = await rowsOfBatch(batchId)
    expect(rows).toHaveLength(7)
    for (const r of rows) {
      expect(r).toMatchObject({
        via: 'web',
        agent: REANCHOR_AGENT,
        userId: uploaderId(),
        op: 'update',
      })
    }
    const anchorRows = rows.filter((r) => r.tableName !== 'documents')
    expect(anchorRows).toHaveLength(6)
    for (const r of anchorRows) {
      expect((r.before as { anchor: Anchor }).anchor.documentVersionId).toBe(A.v1)
      expect((r.after as { anchor: Anchor }).anchor.documentVersionId).toBe(A.v2)
    }
    const noteRow = rows.find((r) => r.rowId === note.id)
    expect(noteRow?.layer).toBe(`personal:${s.owner.id}`)
    expect(rows.find((r) => r.rowId === cueOk30.id)?.layer).toBe(`department:${s.depts.SND.id}`)
    const docRow = rows.find((r) => r.tableName === 'documents')
    expect(docRow).toMatchObject({
      rowId: A.docId,
      before: { currentVersionId: A.v1 },
      after: { currentVersionId: A.v2 },
    })
  }, 120_000)

  test('a second run changes nothing', async () => {
    const p = await pair()
    await mkCue(noTextAnchor(p.docId, p.v1, 3))
    expect(await reanchorVersion(deps(), p.v2)).toMatchObject({ moved: 1 })
    const before = await totalLogs()
    const batchRows = (await rowsOfBatch(reanchorBatchId(p.v2))).length
    expect(await reanchorVersion(deps(), p.v2)).toEqual({ skipped: 'already-run' })
    expect(await totalLogs()).toBe(before)
    expect((await rowsOfBatch(reanchorBatchId(p.v2))).length).toBe(batchRows)
    expect(await currentOf(p.docId)).toBe(p.v2)
  })

  test('two runs at once change things once: the loser sees the winner under the document lock', async () => {
    const p = await pair()
    const cue = await mkCue(noTextAnchor(p.docId, p.v1, 3))
    const results = await Promise.all([
      reanchorVersion(deps(), p.v2),
      reanchorVersion(deps(), p.v2),
      reanchorVersion(deps(), p.v2),
    ])
    expect(results.filter((r) => 'moved' in r)).toHaveLength(1)
    expect(results.filter((r) => 'skipped' in r)).toEqual([
      { skipped: 'already-run' },
      { skipped: 'already-run' },
    ])
    expect(await rowsOfBatch(reanchorBatchId(p.v2))).toHaveLength(2)
    expect((await anchorOfCue(cue.id)).documentVersionId).toBe(p.v2)
  })

  test('a version that is current, or older than the current one, is not needed', async () => {
    const p = await pair()
    expect(await reanchorVersion(deps(), p.v1)).toEqual({ skipped: 'not-needed' })
    // v3 current: v2 is older than the current version
    const v3 = newId()
    await db()
      .insert(documentVersions)
      .values({
        id: v3,
        showId: s.show.id,
        documentId: p.docId,
        versionNumber: 3,
        originalKey: `test/${v3}.pdf`,
        pageCount: 1,
        uploadedBy: uploaderId(),
        status: 'ready',
      })
    await db().update(documents).set({ currentVersionId: v3 }).where(eq(documents.id, p.docId))
    const before = await totalLogs()
    expect(await reanchorVersion(deps(), p.v2)).toEqual({ skipped: 'not-needed' })
    expect(await currentOf(p.docId)).toBe(v3)
    expect(await totalLogs()).toBe(before)
    // a version that is not ready is not re-anchored either
    const q = await pair({ v2Status: 'processing' })
    expect(await reanchorVersion(deps(), q.v2)).toEqual({ skipped: 'not-needed' })
    expect(await currentOf(q.docId)).toBe(q.v1)
  })

  test('an anchor whose page the target lacks ends unresolved and the run completes', async () => {
    const p = await pair()
    const lastPage = tplV1.length - 1 // v1 has 147 pages, v2 has 146
    const beyond = await mkCue(noTextAnchor(p.docId, p.v1, lastPage))
    const inside = await mkCue(noTextAnchor(p.docId, p.v1, 2))
    const result = await reanchorVersion(deps(), p.v2)
    expect(result).toEqual({ moved: 2, byStatus: { ok: 0, approximate: 0, unresolved: 2 } })
    expect(await anchorOfCue(beyond.id)).toMatchObject({
      documentVersionId: p.v2,
      pageIndex: tplV2.length - 1,
      status: 'unresolved',
    })
    expect(await anchorOfCue(inside.id)).toMatchObject({ documentVersionId: p.v2, pageIndex: 2 })
    expect(await currentOf(p.docId)).toBe(p.v2)
  })

  test('anchors of other documents and of newer versions are left alone', async () => {
    const p = await pair()
    const other = await pair()
    const elsewhere = await mkCue(noTextAnchor(other.docId, other.v1, 3))
    // a cue already placed on v3, a newer version than the one being run
    const v3 = newId()
    await db()
      .insert(documentVersions)
      .values({
        id: v3,
        showId: s.show.id,
        documentId: p.docId,
        versionNumber: 3,
        originalKey: `test/${v3}.pdf`,
        pageCount: 1,
        uploadedBy: uploaderId(),
        status: 'processing',
      })
    const onV3 = await mkCue({ ...noTextAnchor(p.docId, v3, 0) })
    const mine = await mkCue(noTextAnchor(p.docId, p.v1, 3))
    expect(await reanchorVersion(deps(), p.v2)).toMatchObject({ moved: 1 })
    expect((await anchorOfCue(elsewhere.id)).documentVersionId).toBe(other.v1)
    expect((await anchorOfCue(onV3.id)).documentVersionId).toBe(v3)
    expect((await anchorOfCue(mine.id)).documentVersionId).toBe(p.v2)
  })

  test('an archived show is read-only: nothing is re-anchored, and the sweep skips it', async () => {
    const t = await setupMarkupShow()
    // a separate show so archiving it does not disturb the others
    const showId = t.show.id
    const docId = newId()
    const v1 = newId()
    const v2 = newId()
    await t.deps.db.insert(documents).values({
      id: docId,
      showId,
      kind: 'libretto',
      title: 'L',
      currentVersionId: v1,
      updatedBy: t.owner.id,
    })
    await t.deps.db.insert(documentVersions).values([
      {
        id: v1,
        showId,
        documentId: docId,
        versionNumber: 1,
        originalKey: 'a',
        pageCount: 2,
        uploadedBy: t.owner.id,
        status: 'ready' as const,
      },
      {
        id: v2,
        showId,
        documentId: docId,
        versionNumber: 2,
        originalKey: 'b',
        pageCount: 2,
        uploadedBy: t.owner.id,
        status: 'ready' as const,
      },
    ])
    await t.deps.db.insert(pages).values(
      [v1, v2].flatMap((versionId) =>
        [0, 1].map((index) => ({
          id: newId(),
          showId,
          documentVersionId: versionId,
          index,
          width: 612,
          height: 792,
          rotation: 0,
          status: 'ready' as const,
        })),
      ),
    )
    const cue = await createCue(t.deps.db, t.actors.owner, {
      showId,
      departmentId: t.depts.LX.id,
      anchor: noTextAnchor(docId, v1, 0),
    })
    // the sweep sees it while the show is open
    expect(await sweepPendingReanchors({ db: t.deps.db, jobs: new RecordingJobs() })).toContain(v2)

    await updateShow(t.deps.db, t.actors.owner, { showId, patch: { status: 'archived' } })
    expect((await getShow(t.deps.db, t.actors.owner, { showId })).status).toBe('archived')
    const jobs = new RecordingJobs()
    expect(await sweepPendingReanchors({ db: t.deps.db, jobs })).not.toContain(v2)
    expect(jobs.enqueuedReanchors).not.toContain(v2)
    expect(await reanchorVersion({ db: t.deps.db, blobs: t.deps.blobs, jobs }, v2)).toEqual({
      skipped: 'not-needed',
    })
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    await handleReanchorDeadLetter(
      { db: t.deps.db },
      { data: { versionId: v2 }, sourceOutput: null },
    )
    expect(logged).not.toHaveBeenCalled()
    logged.mockRestore()
    const [doc] = await t.deps.db.select().from(documents).where(eq(documents.id, docId))
    expect(doc?.currentVersionId).toBe(v1)
    const [row] = await t.deps.db.select().from(cues).where(eq(cues.id, cue.id))
    expect(row?.anchor?.documentVersionId).toBe(v1)
  })
})

describe.skipIf(skip)('a source version that appears after the pre-load', () => {
  test('is read inside the transaction and its anchors still move', async () => {
    const p = await pair() // v1 current, v2 (the "late" source, number 2)
    const target = newId()
    await db()
      .insert(documentVersions)
      .values({
        id: target,
        showId: s.show.id,
        documentId: p.docId,
        versionNumber: 3,
        originalKey: `test/${target}.pdf`,
        pageCount: tplV2.length,
        uploadedBy: uploaderId(),
        status: 'ready',
      })
    await db()
      .insert(pages)
      .values(tplV2.map((pg) => ({ ...pg, id: newId(), documentVersionId: target })))
    const early = await mkCue(noTextAnchor(p.docId, p.v1, 3))
    let late: Promise<{ id: string }> | undefined
    const v1Keys = new Set(tplV1.map((pg) => pg.wordsKey))
    const blobs = new Proxy(s.deps.blobs, {
      get(t, k) {
        if (k !== 'get') {
          const v = Reflect.get(t, k)
          return typeof v === 'function' ? v.bind(t) : v
        }
        return async (key: string) => {
          // While v1's words are read (after the target's), a cue appears on the not yet read v2.
          if (v1Keys.has(key)) late ??= mkCue(noTextAnchor(p.docId, p.v2, 4))
          await late
          return t.get(key)
        }
      },
    })
    const result = await reanchorVersion({ db: db(), blobs, jobs: new RecordingJobs() }, target)
    expect(late).toBeDefined()
    expect(result).toMatchObject({ moved: 2 })
    expect((await anchorOfCue(early.id)).documentVersionId).toBe(target)
    expect((await anchorOfCue((await late)?.id as string)).documentVersionId).toBe(target)
    expect(await currentOf(p.docId)).toBe(target)
  })
})

describe.skipIf(skip)('finishing a version', () => {
  async function oneQueuedPage(p: { docId: string; v2: string }) {
    await db().update(pages).set({ status: 'ready' }).where(eq(pages.documentVersionId, p.v2))
    const [page] = await db().select().from(pages).where(eq(pages.documentVersionId, p.v2)).limit(1)
    await db()
      .update(pages)
      .set({ status: 'queued' })
      .where(eq(pages.id, page?.id as string))
    return page?.id as string
  }

  test('a version that fails processing never re-anchors and never becomes current', async () => {
    const p = await pair({ v2Status: 'processing' })
    const pageId = await oneQueuedPage(p)
    await handleDocumentDeadLetter(
      { db: db() },
      { data: { versionId: p.v2 }, sourceOutput: { message: 'ocrmypdf exploded' } },
    )
    const statusOf = async () =>
      (await db().select().from(documentVersions).where(eq(documentVersions.id, p.v2)))[0]?.status
    expect(await statusOf()).toBe('failed')

    // the version's last queued page then finishes through the page dead-letter path: the failed
    // version must not become ready, enqueue a re-anchor, or become current
    const jobs = new RecordingJobs()
    await markPageFailed({ db: db(), jobs }, pageId, 'boom')
    expect(await finishVersionIfDone({ db: db(), jobs }, p.v2)).toBe('not-done')
    expect(await statusOf()).toBe('failed')
    expect(jobs.enqueuedReanchors).toEqual([])
    expect(await sweepPendingReanchors({ db: db(), jobs })).not.toContain(p.v2)
    expect(await reanchorVersion(deps(jobs), p.v2)).toEqual({ skipped: 'not-needed' })
    expect(jobs.enqueuedReanchors).not.toContain(p.v2)
    expect(await currentOf(p.docId)).toBe(p.v1)
    expect(await rowsOfBatch(reanchorBatchId(p.v2))).toHaveLength(0)
  })

  test('finishVersionIfDone: ready for a first or lower version, needs-reanchor for a newer one', async () => {
    // a first version (no current version yet) becomes current and needs no re-anchoring
    const first = await pair({ v2Status: 'queued' })
    await db()
      .update(documents)
      .set({ currentVersionId: null })
      .where(eq(documents.id, first.docId))
    await db()
      .update(documentVersions)
      .set({ status: 'processing' })
      .where(eq(documentVersions.id, first.v1))
    const jobs1 = new RecordingJobs()
    expect(await finishVersionIfDone({ db: db(), jobs: jobs1 }, first.v1)).toBe('ready')
    expect(await currentOf(first.docId)).toBe(first.v1)
    expect(jobs1.enqueuedReanchors).toEqual([])
    // already done: not-done
    expect(await finishVersionIfDone({ db: db(), jobs: jobs1 }, first.v1)).toBe('not-done')

    // a newer version leaves the current one alone and queues the re-anchor
    const newer = await pair({ v2Status: 'processing' })
    const jobs2 = new RecordingJobs()
    expect(await finishVersionIfDone({ db: db(), jobs: jobs2 }, newer.v2)).toBe('needs-reanchor')
    expect(jobs2.enqueuedReanchors).toEqual([newer.v2])
    expect(await currentOf(newer.docId)).toBe(newer.v1)

    // a lower-numbered version finishing while a higher one is current changes nothing
    const late = await pair({ v2Status: 'ready' })
    await db()
      .update(documentVersions)
      .set({ status: 'processing' })
      .where(eq(documentVersions.id, late.v1))
    await db()
      .update(documents)
      .set({ currentVersionId: late.v2 })
      .where(eq(documents.id, late.docId))
    const jobs3 = new RecordingJobs()
    expect(await finishVersionIfDone({ db: db(), jobs: jobs3 }, late.v1)).toBe('ready')
    expect(await currentOf(late.docId)).toBe(late.v2)
    expect(jobs3.enqueuedReanchors).toEqual([])
  })

  test('a failed enqueue is logged and left to the sweep', async () => {
    const p = await pair({ v2Status: 'processing' })
    const jobs = new RecordingJobs()
    jobs.enqueueReanchor = async () => {
      throw new Error('queue is down')
    }
    const errors: unknown[] = []
    const original = console.error
    console.error = (...args: unknown[]) => errors.push(args)
    try {
      expect(await finishVersionIfDone({ db: db(), jobs }, p.v2)).toBe('needs-reanchor')
    } finally {
      console.error = original
    }
    expect(errors).toHaveLength(1)
    expect(await sweepPendingReanchors({ db: db(), jobs: new RecordingJobs() })).toContain(p.v2)
  })

  test('a last page finished by markPageFailed enqueues the re-anchor', async () => {
    const p = await pair({ v2Status: 'processing' })
    const pageId = await oneQueuedPage(p)
    const jobs = new RecordingJobs()
    await markPageFailed({ db: db(), jobs }, pageId, 'boom')
    expect(jobs.enqueuedReanchors).toEqual([p.v2])
    const [v2] = await db().select().from(documentVersions).where(eq(documentVersions.id, p.v2))
    expect(v2?.status).toBe('ready')
    expect(await currentOf(p.docId)).toBe(p.v1)
  })

  test('a last page finished by the page dead-letter handler enqueues the re-anchor', async () => {
    const p = await pair({ v2Status: 'processing' })
    const pageId = await oneQueuedPage(p)
    const jobs = new RecordingJobs()
    await handlePageDeadLetter(
      { db: db(), jobs },
      { data: { pageId }, sourceOutput: { message: 'x' } },
    )
    expect(jobs.enqueuedReanchors).toEqual([p.v2])
  })

  test('sweepPendingReanchors finds a ready, newer, non-current version and enqueues it once', async () => {
    // v2 marked ready directly, as after a crash between the ready commit and the enqueue
    const p = await pair({ v2Status: 'processing' })
    await db()
      .update(documentVersions)
      .set({ status: 'ready' })
      .where(eq(documentVersions.id, p.v2))
    const jobs = new RecordingJobs()
    const swept = await sweepPendingReanchors({ db: db(), jobs })
    expect(swept).toContain(p.v2)
    expect(jobs.enqueuedReanchors.filter((id) => id === p.v2)).toEqual([p.v2])
    // the current version, and versions that are still processing, are not swept
    expect(swept).not.toContain(p.v1)
    await reanchorVersion(deps(), p.v2)
    expect(await sweepPendingReanchors({ db: db(), jobs: new RecordingJobs() })).not.toContain(p.v2)
  })

  test('the sweep leaves processing and failed versions, and a lower version than the current one', async () => {
    const processing = await pair({ v2Status: 'processing' })
    const failed = await pair({ v2Status: 'failed' })
    const lower = await pair({ v2Status: 'ready' })
    await db()
      .update(documents)
      .set({ currentVersionId: lower.v2 })
      .where(eq(documents.id, lower.docId))
    const swept = await sweepPendingReanchors({ db: db(), jobs: new RecordingJobs() })
    for (const id of [processing.v2, failed.v2, lower.v1, lower.v2]) expect(swept).not.toContain(id)
  })
})

describe.skipIf(skip)('the sweep with a failing queue', () => {
  test('one failed enqueue is logged and skipped; the rest are enqueued and returned', async () => {
    const bad = await pair()
    const good = await pair()
    const jobs = new RecordingJobs()
    jobs.enqueueReanchor = async (versionId) => {
      if (versionId === bad.v2) throw new Error('queue refused this one')
      jobs.enqueuedReanchors.push(versionId)
    }
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const swept = await sweepPendingReanchors({ db: db(), jobs })
    expect(logged).toHaveBeenCalledTimes(1)
    expect(String(logged.mock.calls[0]?.[0])).toContain(bad.v2)
    logged.mockRestore()
    expect(swept).toContain(good.v2)
    expect(swept).not.toContain(bad.v2)
    expect(jobs.enqueuedReanchors).toEqual(swept)
    // the failed one is still owed, so the next sweep tries it again
    const again = await sweepPendingReanchors({ db: db(), jobs: new RecordingJobs() })
    expect(again).toContain(bad.v2)
  })
})

describe.skipIf(skip)('the dead-letter handler', () => {
  test('makes the version current without moving anchors, and a second delivery does nothing', async () => {
    const p = await pair()
    const cue = await mkCue(noTextAnchor(p.docId, p.v1, 3))
    const input = { data: { versionId: p.v2 }, sourceOutput: { message: 'boom' } }
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    await handleReanchorDeadLetter({ db: db() }, input)
    // the run that adopted the version says why, once
    expect(logged).toHaveBeenCalledTimes(1)
    expect(String(logged.mock.calls[0]?.[0])).toContain(
      `re-anchoring ${p.v2} failed after retries: boom`,
    )
    expect(await currentOf(p.docId)).toBe(p.v2)
    expect((await anchorOfCue(cue.id)).documentVersionId).toBe(p.v1)
    const rows = await rowsOfBatch(reanchorBatchId(p.v2))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      tableName: 'documents',
      rowId: p.docId,
      via: 'web',
      agent: REANCHOR_AGENT,
      userId: uploaderId(),
      before: { currentVersionId: p.v1 },
      after: { currentVersionId: p.v2 },
    })
    await handleReanchorDeadLetter({ db: db() }, input)
    expect(logged).toHaveBeenCalledTimes(1) // the second delivery found nothing to do: silent
    logged.mockRestore()
    expect(await rowsOfBatch(reanchorBatchId(p.v2))).toHaveLength(1)
    // the sweep and a replayed job leave it alone
    expect(await sweepPendingReanchors({ db: db(), jobs: new RecordingJobs() })).not.toContain(p.v2)
    expect(await reanchorVersion(deps(), p.v2)).toEqual({ skipped: 'already-run' })
  })

  test('does nothing when a higher-numbered version is already current', async () => {
    const p = await pair()
    const v3 = newId()
    await db()
      .insert(documentVersions)
      .values({
        id: v3,
        showId: s.show.id,
        documentId: p.docId,
        versionNumber: 3,
        originalKey: `test/${v3}.pdf`,
        pageCount: 1,
        uploadedBy: uploaderId(),
        status: 'ready',
      })
    await db().update(documents).set({ currentVersionId: v3 }).where(eq(documents.id, p.docId))
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    await handleReanchorDeadLetter({ db: db() }, { data: { versionId: p.v2 }, sourceOutput: null })
    expect(logged).not.toHaveBeenCalled()
    logged.mockRestore()
    expect(await currentOf(p.docId)).toBe(v3)
    expect(await rowsOfBatch(reanchorBatchId(p.v2))).toHaveLength(0)
  })

  test('does nothing for a version that is not ready, or already current', async () => {
    const p = await pair({ v2Status: 'failed' })
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    await handleReanchorDeadLetter({ db: db() }, { data: { versionId: p.v2 }, sourceOutput: null })
    expect(await currentOf(p.docId)).toBe(p.v1)
    await handleReanchorDeadLetter({ db: db() }, { data: { versionId: p.v1 }, sourceOutput: null })
    expect(logged).not.toHaveBeenCalled()
    logged.mockRestore()
    expect(await rowsOfBatch(reanchorBatchId(p.v1))).toHaveLength(0)
  })
})

/** A run over a pair with one cue per department and notes on three layers. */
async function runWithMarkup() {
  const p = await pair()
  const lx = await mkCue(noTextAnchor(p.docId, p.v1, 3), 'LX')
  const snd = await mkCue(noTextAnchor(p.docId, p.v1, 4), 'SND')
  const tm = await mkCue(noTextAnchor(p.docId, p.v1, 5), 'TM')
  const ownerNote = await mkNote(
    noTextAnchor(p.docId, p.v1, 6),
    { kind: 'personal', id: s.owner.id },
    s.actors.owner,
  )
  const viewerNote = await mkNote(
    noTextAnchor(p.docId, p.v1, 7),
    { kind: 'personal', id: s.viewer.id },
    s.actors.viewer,
  )
  const lxNote = await mkNote(
    noTextAnchor(p.docId, p.v1, 8),
    { kind: 'department', id: s.depts.LX.id },
    s.actors.owner,
  )
  const originals = {
    lx: await anchorOfCue(lx.id),
    snd: await anchorOfCue(snd.id),
    tm: await anchorOfCue(tm.id),
    ownerNote: await anchorOfNote(ownerNote.id),
    viewerNote: await anchorOfNote(viewerNote.id),
    lxNote: await anchorOfNote(lxNote.id),
  }
  await reanchorVersion(deps(), p.v2)
  return { p, lx, snd, tm, ownerNote, viewerNote, lxNote, originals }
}

const revertRun = (
  actor: Actor,
  v2: string,
  over: { force?: boolean; dryRun?: boolean; showId?: string } = {},
) =>
  revertBatch(db(), actor, {
    showId: over.showId ?? s.show.id,
    batchId: reanchorBatchId(v2),
    userId: uploaderId(),
    force: over.force,
    dryRun: over.dryRun,
  })

describe.skipIf(skip)('reverting a re-anchoring run', () => {
  test('the run is one revertable batch: an editor scoped to LX reverts it and every anchor and the current version return', async () => {
    const r = await runWithMarkup()
    expect(await currentOf(r.p.docId)).toBe(r.p.v2)
    const result = await revertRun(s.actors.editorLx, r.p.v2)

    expect(result.reverted).toBe(7)
    expect(result.skipped).toEqual([])
    expect(await currentOf(r.p.docId)).toBe(r.p.v1)
    expect(await anchorOfCue(r.lx.id)).toEqual(r.originals.lx)
    // cues in departments the editor cannot edit return too: the run is a document operation
    expect(await anchorOfCue(r.snd.id)).toEqual(r.originals.snd)
    expect(await anchorOfCue(r.tm.id)).toEqual(r.originals.tm)
    expect(await anchorOfNote(r.lxNote.id)).toEqual(r.originals.lxNote)
    // so do other members' personal notes (the run wrote them)
    expect(await anchorOfNote(r.ownerNote.id)).toEqual(r.originals.ownerNote)
    expect(await anchorOfNote(r.viewerNote.id)).toEqual(r.originals.viewerNote)

    // the revert is an ordinary logged batch by the reverter, under a new batch id
    const rows = await rowsOfBatch(result.batchId)
    expect(rows).toHaveLength(7)
    for (const row of rows) {
      expect(row).toMatchObject({ via: 'web', agent: null, userId: s.editorLx.id, op: 'update' })
    }
    expect(result.batchId).not.toBe(reanchorBatchId(r.p.v2))
    // personal rows keep their private layer in the log
    expect(rows.find((x) => x.rowId === r.ownerNote.id)?.layer).toBe(`personal:${s.owner.id}`)
  })

  test('reverting the revert is an ordinary batch: it restores what the reverter can see', async () => {
    const r = await runWithMarkup()
    const first = await revertRun(s.actors.owner, r.p.v2)
    expect(await currentOf(r.p.docId)).toBe(r.p.v1)
    const again = await revertBatch(db(), s.actors.owner, {
      showId: s.show.id,
      batchId: first.batchId,
      userId: s.owner.id,
    })
    // seven rows were written, one of them the viewer's personal note, which the owner cannot see:
    // an ordinary batch revert leaves it alone (it surfaces in the review list, Task 19)
    expect(again.reverted).toBe(6)
    expect(await currentOf(r.p.docId)).toBe(r.p.v2)
    expect((await anchorOfCue(r.snd.id)).documentVersionId).toBe(r.p.v2)
    expect((await anchorOfNote(r.ownerNote.id)).documentVersionId).toBe(r.p.v2)
    expect(await anchorOfNote(r.viewerNote.id)).toEqual(r.originals.viewerNote)
  })

  test('the result, skipped list and conflict message never expose another member’s personal rows', async () => {
    const r = await runWithMarkup()
    const hidden = [r.ownerNote.id, r.viewerNote.id]
    const dry = await revertRun(s.actors.editorLx, r.p.v2, { dryRun: true })
    expect(dry.reverted).toBe(7)
    expect(await currentOf(r.p.docId)).toBe(r.p.v2)

    // the owner moves their note after the run, and the viewer deletes theirs
    await updateAnnotation(db(), s.actors.owner, {
      annotationId: r.ownerNote.id,
      patch: { anchor: noTextAnchor(r.p.docId, r.p.v2, 20) },
    })
    await deleteAnnotations(db(), s.actors.viewer, { annotationIds: [r.viewerNote.id] })

    const conflict = await message(revertRun(s.actors.editorLx, r.p.v2))
    expect(conflict).toMatch(/^1 row has changed since this re-anchoring run/)
    for (const id of hidden) expect(conflict).not.toContain(id)
    expect(conflict).not.toMatch(/annotation/i)
    expect(await code(revertRun(s.actors.editorLx, r.p.v2))).toBe('conflict')
    // nothing was written
    expect(await currentOf(r.p.docId)).toBe(r.p.v2)
    expect((await anchorOfCue(r.lx.id)).documentVersionId).toBe(r.p.v2)

    // forcing over another member's drifted personal row is an owner's call, not a scoped editor's
    const refused = await message(revertRun(s.actors.editorLx, r.p.v2, { force: true }))
    expect(await code(revertRun(s.actors.editorLx, r.p.v2, { force: true }))).toBe('forbidden')
    expect(refused).toMatch(/^1 row changed since this re-anchoring run on layers you cannot edit/)
    for (const id of hidden) expect(refused).not.toContain(id)
    expect(await currentOf(r.p.docId)).toBe(r.p.v2)
    expect(await anchorOfNote(r.ownerNote.id)).toMatchObject({ pageIndex: 20 })

    // the owner may; the viewer's deleted note belongs to someone else's layer and is not listed
    const forced = await revertRun(s.actors.owner, r.p.v2, { force: true })
    const text = JSON.stringify(forced)
    expect(text).not.toContain(r.viewerNote.id)
    expect(forced.skipped).toEqual([])
    expect(forced.reverted).toBe(6) // 7 rows, minus the deleted note
    expect(await anchorOfNote(r.ownerNote.id)).toEqual(r.originals.ownerNote)
    expect(await currentOf(r.p.docId)).toBe(r.p.v1)
  })

  test('an undrifted run is restored by an LX editor with no hidden id in the result, even when a hidden note is gone', async () => {
    const r = await runWithMarkup()
    await deleteAnnotations(db(), s.actors.viewer, { annotationIds: [r.viewerNote.id] })
    const result = await revertRun(s.actors.editorLx, r.p.v2)
    const text = JSON.stringify(result)
    for (const id of [r.ownerNote.id, r.viewerNote.id]) expect(text).not.toContain(id)
    expect(result.skipped).toEqual([])
    expect(result.reverted).toBe(6)
    expect(await anchorOfNote(r.ownerNote.id)).toEqual(r.originals.ownerNote)
  })

  test('with force, an LX-scoped editor cannot overwrite a drifted SND cue; the owner can', async () => {
    const r = await runWithMarkup()
    const drifted = noTextAnchor(r.p.docId, r.p.v2, 30)
    await updateCue(db(), s.actors.owner, { cueId: r.snd.id, patch: { anchor: drifted } })
    const before = await totalLogs()

    expect(await code(revertRun(s.actors.editorLx, r.p.v2))).toBe('conflict')
    const refused = await message(revertRun(s.actors.editorLx, r.p.v2, { force: true }))
    expect(await code(revertRun(s.actors.editorLx, r.p.v2, { force: true }))).toBe('forbidden')
    expect(refused).toMatch(/^1 row changed since this re-anchoring run on layers you cannot edit/)
    expect(refused).not.toContain(r.snd.id)
    // the dry run refuses too, and nothing was written by any of them
    expect(await code(revertRun(s.actors.editorLx, r.p.v2, { force: true, dryRun: true }))).toBe(
      'forbidden',
    )
    expect(await totalLogs()).toBe(before)
    expect(await currentOf(r.p.docId)).toBe(r.p.v2)
    expect((await anchorOfCue(r.lx.id)).documentVersionId).toBe(r.p.v2)
    expect((await anchorOfCue(r.snd.id)).pageIndex).toBe(30)
  })

  test('with force, an LX-scoped editor may overwrite drift in a department they edit', async () => {
    const r = await runWithMarkup()
    await updateCue(db(), s.actors.owner, {
      cueId: r.lx.id,
      patch: { anchor: noTextAnchor(r.p.docId, r.p.v2, 30) },
    })
    expect(await code(revertRun(s.actors.editorLx, r.p.v2))).toBe('conflict')
    const forced = await revertRun(s.actors.editorLx, r.p.v2, { force: true })
    expect(forced.reverted).toBe(7)
    expect(await anchorOfCue(r.lx.id)).toEqual(r.originals.lx)
    expect(await currentOf(r.p.docId)).toBe(r.p.v1)
  })

  test('with force, the owner overwrites a drifted SND cue', async () => {
    const r = await runWithMarkup()
    await updateCue(db(), s.actors.owner, {
      cueId: r.snd.id,
      patch: { anchor: noTextAnchor(r.p.docId, r.p.v2, 30) },
    })
    const forced = await revertRun(s.actors.owner, r.p.v2, { force: true })
    expect(forced.reverted).toBe(7)
    expect(await anchorOfCue(r.snd.id)).toEqual(r.originals.snd)
    expect(await currentOf(r.p.docId)).toBe(r.p.v1)
  })

  test('a visible row that is gone is listed as skipped; an editor’s own drift is named only by count', async () => {
    const r = await runWithMarkup()
    await deleteCues(db(), s.actors.owner, { cueIds: [r.lx.id] })
    const result = await revertRun(s.actors.editorLx, r.p.v2)
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0]).toMatchObject({ reason: 'row-gone' })
    expect(result.reverted).toBe(6)
  })

  test('the revert needs editor on the show, and an archived show refuses it', async () => {
    const r = await runWithMarkup()
    expect(await code(revertRun(s.actors.viewer, r.p.v2))).toBe('forbidden')
    expect(await code(revertRun({ userId: s.outsider.id, via: 'web', agent: null }, r.p.v2))).toBe(
      'not_found',
    )
    expect(await currentOf(r.p.docId)).toBe(r.p.v2)

    // a throwaway show: archive it
    const t = await setupMarkupShow()
    const docId = newId()
    const v1 = newId()
    const v2 = newId()
    const showId = t.show.id
    await t.deps.db.insert(documents).values({
      id: docId,
      showId,
      kind: 'libretto',
      title: 'L',
      currentVersionId: v1,
      updatedBy: t.owner.id,
    })
    await t.deps.db.insert(documentVersions).values([
      {
        id: v1,
        showId,
        documentId: docId,
        versionNumber: 1,
        originalKey: 'a',
        pageCount: 1,
        uploadedBy: t.owner.id,
        status: 'ready' as const,
      },
      {
        id: v2,
        showId,
        documentId: docId,
        versionNumber: 2,
        originalKey: 'b',
        pageCount: 1,
        uploadedBy: t.owner.id,
        status: 'ready' as const,
      },
    ])
    await t.deps.db.insert(pages).values(
      [v1, v2].map((versionId) => ({
        id: newId(),
        showId,
        documentVersionId: versionId,
        index: 0,
        width: 612,
        height: 792,
        rotation: 0,
        status: 'ready' as const,
      })),
    )
    await createCue(t.deps.db, t.actors.owner, {
      showId,
      departmentId: t.depts.LX.id,
      anchor: noTextAnchor(docId, v1, 0),
    })
    await reanchorVersion({ db: t.deps.db, blobs: t.deps.blobs, jobs: new RecordingJobs() }, v2)
    await updateShow(t.deps.db, t.actors.owner, { showId, patch: { status: 'archived' } })
    for (const dryRun of [false, true]) {
      expect(
        await code(
          revertBatch(t.deps.db, t.actors.owner, {
            showId,
            batchId: reanchorBatchId(v2),
            userId: t.owner.id,
            dryRun,
          }),
        ),
      ).toBe('forbidden')
    }
    const [doc] = await t.deps.db.select().from(documents).where(eq(documents.id, docId))
    expect(doc?.currentVersionId).toBe(v2)
  })

  test('a dry run counts the rows and changes nothing', async () => {
    const r = await runWithMarkup()
    const before = await totalLogs()
    const dry = await revertRun(s.actors.owner, r.p.v2, { dryRun: true })
    expect(dry).toMatchObject({ reverted: 7, rows: 7, deletes: 0 })
    expect(await currentOf(r.p.docId)).toBe(r.p.v2)
    expect(await totalLogs()).toBe(before)
  })

  test('drift is a conflict unless forced, for visible rows too', async () => {
    const r = await runWithMarkup()
    await updateCue(db(), s.actors.owner, {
      cueId: r.snd.id,
      patch: { anchor: noTextAnchor(r.p.docId, r.p.v2, 30) },
    })
    expect(await message(revertRun(s.actors.owner, r.p.v2))).toMatch(
      /^1 row has changed since this re-anchoring run/,
    )
    expect(await currentOf(r.p.docId)).toBe(r.p.v2)
    const forced = await revertRun(s.actors.owner, r.p.v2, { force: true })
    expect(forced.reverted).toBe(7)
    expect(await anchorOfCue(r.snd.id)).toEqual(r.originals.snd)
  })

  test('a single row of the run cannot revert the current version on its own', async () => {
    const r = await runWithMarkup()
    const rows = await rowsOfBatch(reanchorBatchId(r.p.v2))
    const docRow = rows.find((x) => x.tableName === 'documents') as Row
    expect(await code(revertChange(db(), s.actors.owner, { seq: docRow.seq }))).toBe('invalid')
    expect(await currentOf(r.p.docId)).toBe(r.p.v2)
    // an anchor row reverts like any other change, with the usual layer rights
    const sndRow = rows.find((x) => x.rowId === r.snd.id) as Row
    expect(await code(revertChange(db(), s.actors.editorLx, { seq: sndRow.seq }))).toBe('forbidden')
    expect(await code(revertChange(db(), s.actors.owner, { seq: sndRow.seq }))).toBe('ok')
  })

  test('a reverted run is never re-run by the sweep or a replayed job', async () => {
    const r = await runWithMarkup()
    await revertRun(s.actors.editorLx, r.p.v2)
    expect(await currentOf(r.p.docId)).toBe(r.p.v1)
    expect(await sweepPendingReanchors({ db: db(), jobs: new RecordingJobs() })).not.toContain(
      r.p.v2,
    )
    expect(await reanchorVersion(deps(), r.p.v2)).toEqual({ skipped: 'already-run' })
    expect(await currentOf(r.p.docId)).toBe(r.p.v1)
  })
})

describe.skipIf(skip)('batches that only claim to be the re-anchoring run', () => {
  test('a batch that merely claims the agent through MCP gets per-row layer checks', async () => {
    const { token } = await createToken(db(), s.actors.owner, { name: 'imposter', showScope: '*' })
    const client = await connectMcp(s.app, token, { name: REANCHOR_AGENT, version: '1.0.0' })
    clients.push(client)
    const made = await callTool(client, 'create_cue', {
      showId: s.show.id,
      department: 'SND',
      number: '5',
      label: 'imposter',
    })
    expect(made.isError).toBeFalsy()
    const cueId = made.structuredContent?.id as string
    const moved = await callTool(client, 'update_cue', { cueId, label: 'moved by an mcp client' })
    expect(moved.isError, resultText(moved)).toBeFalsy()
    const [row] = await db()
      .select()
      .from(changeLog)
      .where(and(eq(changeLog.rowId, cueId), eq(changeLog.op, 'update')))
    expect(row).toMatchObject({ via: 'mcp', userId: s.owner.id })
    expect(row?.agent).toContain(REANCHOR_AGENT)
    expect(row?.batchId).toBeTruthy()

    // an LX-scoped editor cannot revert SND cue rows, whatever the batch claims to be
    expect(
      await code(
        revertBatch(db(), s.actors.editorLx, {
          showId: s.show.id,
          batchId: row?.batchId as string,
          userId: s.owner.id,
        }),
      ),
    ).toBe('forbidden')
    const [cue] = await db().select().from(cues).where(eq(cues.id, cueId))
    expect(cue?.label).toBe('moved by an mcp client')
  })

  test('a REST bearer request whose User-Agent is exactly the re-anchoring agent still gets per-row layer checks', async () => {
    // an SND cue the owner changed, then reverted over REST with the agent as User-Agent
    const cue = await mkCue(null, 'SND')
    await updateCue(db(), s.actors.owner, { cueId: cue.id, patch: { label: 'changed' } })
    const [change] = await db()
      .select()
      .from(changeLog)
      .where(and(eq(changeLog.rowId, cue.id), eq(changeLog.op, 'update')))
    const { token } = await createToken(db(), s.actors.owner, { name: 'rest', showScope: '*' })
    const res = await s.app.request(`/api/shows/${s.show.id}/revert`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'user-agent': REANCHOR_AGENT,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ seq: change?.seq }),
    })
    expect(res.status).toBe(200)
    const { batchId } = (await res.json()) as { batchId: string }
    const rows = await rowsOfBatch(batchId)
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) expect(r).toMatchObject({ via: 'mcp', agent: REANCHOR_AGENT })

    expect(
      await code(
        revertBatch(db(), s.actors.editorLx, { showId: s.show.id, batchId, userId: s.owner.id }),
      ),
    ).toBe('forbidden')
    // the owner may, as an ordinary batch
    expect(
      await code(
        revertBatch(db(), s.actors.owner, { showId: s.show.id, batchId, userId: s.owner.id }),
      ),
    ).toBe('ok')
  })

  test('the rule needs every row: a batch with one real-looking row among others gets per-row checks', async () => {
    const p = await pair()
    const run: Actor = { userId: s.owner.id, via: 'web', agent: REANCHOR_AGENT }
    const human: Actor = { userId: s.owner.id, via: 'web', agent: null }
    const cueRun = await mkCue(noTextAnchor(p.docId, p.v1, 3), 'SND')
    const cueHuman = await mkCue(noTextAnchor(p.docId, p.v1, 4), 'SND')
    const v1Run = await anchorOfCue(cueRun.id)
    const v1Human = await anchorOfCue(cueHuman.id)
    const move = (actor: Actor, batchId: string, id: string, from: Anchor, to: Anchor) =>
      db().transaction(async (tx) => {
        await tx.update(cues).set({ anchor: to }).where(eq(cues.id, id))
        await logChange(tx, {
          showId: s.show.id,
          actor,
          batchId,
          table: 'cues',
          rowId: id,
          op: 'update',
          before: { anchor: from },
          after: { anchor: to },
          layer: `department:${s.depts.SND.id}`,
        })
      })
    const onV2 = (a: Anchor, page: number): Anchor => ({
      ...a,
      documentVersionId: p.v2,
      pageIndex: page,
    })

    // one row says it is the re-anchoring run, the other is a person: an ordinary batch
    const mixed = `mixed-${newId()}`
    await move(run, mixed, cueRun.id, v1Run, onV2(v1Run, 3))
    await move(human, mixed, cueHuman.id, v1Human, onV2(v1Human, 4))
    const asEditor = () =>
      revertBatch(db(), s.actors.editorLx, {
        showId: s.show.id,
        batchId: mixed,
        userId: s.owner.id,
      })
    expect(await code(asEditor())).toBe('forbidden')
    expect((await anchorOfCue(cueRun.id)).documentVersionId).toBe(p.v2)
    expect((await anchorOfCue(cueHuman.id)).documentVersionId).toBe(p.v2)
    // the owner may revert an ordinary batch: both rows return
    const byOwner = await revertBatch(db(), s.actors.owner, {
      showId: s.show.id,
      batchId: mixed,
      userId: s.owner.id,
    })
    expect(byOwner.reverted).toBe(2)
    expect(await anchorOfCue(cueRun.id)).toEqual(v1Run)
    expect(await anchorOfCue(cueHuman.id)).toEqual(v1Human)

    // every row claims the agent: a document operation, so the same editor restores both with a real write
    const all = `all-${newId()}`
    await move(run, all, cueRun.id, v1Run, onV2(v1Run, 3))
    await move(run, all, cueHuman.id, v1Human, onV2(v1Human, 4))
    const restored = await revertBatch(db(), s.actors.editorLx, {
      showId: s.show.id,
      batchId: all,
      userId: s.owner.id,
    })
    expect(restored.reverted).toBe(2)
    expect(restored.skipped).toEqual([])
    expect(await anchorOfCue(cueRun.id)).toEqual(v1Run)
    expect(await anchorOfCue(cueHuman.id)).toEqual(v1Human)
    const written = await rowsOfBatch(restored.batchId)
    expect(written).toHaveLength(2)
    for (const row of written) expect(row).toMatchObject({ userId: s.editorLx.id, agent: null })
  })
})
