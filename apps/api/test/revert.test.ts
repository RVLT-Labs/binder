import { annotations, changeLog, cues, departments, documents, shows } from '@binder/db'
import { type Actor, type AnnotationFields, newId } from '@binder/shared'
import { and, eq } from 'drizzle-orm'
import { describe, expect, test, vi } from 'vitest'
import { AppError } from '../src/errors'
import {
  createAnnotation,
  createCue,
  deleteAnnotations,
  deleteCues,
  getAnnotation,
  getCue,
  listHistory,
  revertBatch,
  revertChange,
  updateAnnotation,
  updateCue,
  updateDepartment,
  updateDocument,
  updateShow,
} from '../src/services'
import { APP_ORIGIN } from './helpers'
import { anchorAt, setupMarkupShow } from './markupHelpers'

type Setup = Awaited<ReturnType<typeof setupMarkupShow>>

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

const asAgent = (a: Actor, agent: string): Actor => ({ ...a, via: 'mcp', agent })

const logsOf = (s: Setup, rowId: string) =>
  s.deps.db.select().from(changeLog).where(eq(changeLog.rowId, rowId)).orderBy(changeLog.seq)
const lastSeq = async (s: Setup, rowId: string, op?: 'insert' | 'update' | 'delete') => {
  const rows = (await logsOf(s, rowId)).filter((r) => !op || r.op === op)
  return rows[rows.length - 1].seq
}
const totalLogs = async (s: Setup) =>
  (
    await s.deps.db
      .select({ seq: changeLog.seq })
      .from(changeLog)
      .where(eq(changeLog.showId, s.show.id))
  ).length
const cueCount = async (s: Setup) =>
  (await s.deps.db.select({ id: cues.id }).from(cues).where(eq(cues.showId, s.show.id))).length

const mkCue = (s: Setup, actor: Actor, dept: 'LX' | 'SND' | 'TM', over = {}) =>
  createCue(s.deps.db, actor, {
    showId: s.show.id,
    departmentId: s.depts[dept].id,
    label: 'c',
    ...over,
  })

const noteFields = (
  s: Setup,
  layer: { kind: 'department' | 'personal'; id: string },
  over: Partial<AnnotationFields> = {},
): AnnotationFields => ({
  layerKind: layer.kind,
  layerId: layer.id,
  anchor: anchorAt(s.docId, s.versionId, 0),
  type: 'note',
  geometry: {},
  text: 'a note',
  style: {},
  ...over,
})
const lx = (s: Setup) => ({ kind: 'department' as const, id: s.depts.LX.id })

describe('revertChange: updates', () => {
  test('reverting a relabel restores the old label as a new logged write in a new batch', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const cue = await mkCue(s, s.actors.owner, 'LX', { label: 'Fly out' })
    await updateCue(db, s.actors.owner, {
      cueId: cue.id,
      patch: { label: 'Fly in' },
      batchId: 'relabel-batch',
    })
    const seq = await lastSeq(s, cue.id, 'update')

    const result = await revertChange(db, s.actors.editorLx, { seq })
    expect(result.batchId).not.toBe('relabel-batch')
    expect(result).toMatchObject({ reverted: 1, skipped: [] })
    expect((await getCue(db, s.actors.owner, { cueId: cue.id })).label).toBe('Fly out')

    const revertRow = (await logsOf(s, cue.id)).at(-1)
    expect(revertRow).toMatchObject({
      op: 'update',
      batchId: result.batchId,
      userId: s.editorLx.id,
      before: { label: 'Fly in' },
      after: { label: 'Fly out' },
      layer: `department:${s.depts.LX.id}`,
    })

    // the revert is itself revertable
    await revertChange(db, s.actors.owner, { seq: revertRow?.seq as number })
    expect((await getCue(db, s.actors.owner, { cueId: cue.id })).label).toBe('Fly in')
  })

  test('a revert through MCP is logged with the agent', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const cue = await mkCue(s, s.actors.owner, 'LX', { label: 'one' })
    await updateCue(db, s.actors.owner, { cueId: cue.id, patch: { label: 'two' } })
    await revertChange(db, asAgent(s.actors.owner, 'Claude Code/2.1.0'), {
      seq: await lastSeq(s, cue.id, 'update'),
    })
    expect((await logsOf(s, cue.id)).at(-1)).toMatchObject({
      via: 'mcp',
      agent: 'Claude Code/2.1.0',
    })
  })

  test('reverting restores every column the change touched, anchor included', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const cue = await mkCue(s, s.actors.owner, 'TM', {
      label: 'Preset',
      number: { major: 10, minor: 50 },
      anchor: anchorAt(s.docId, s.versionId, 0, 100, 700),
      notes: 'n',
    })
    await updateCue(db, s.actors.owner, {
      cueId: cue.id,
      patch: {
        major: 11,
        minor: 0,
        label: 'Moved',
        anchor: anchorAt(s.docId, s.versionId, 3, 50, 60),
        notes: 'changed',
      },
    })
    await revertChange(db, s.actors.owner, { seq: await lastSeq(s, cue.id, 'update') })
    expect(await getCue(db, s.actors.owner, { cueId: cue.id })).toMatchObject({
      major: 10,
      minor: 50,
      label: 'Preset',
      notes: 'n',
      anchor: anchorAt(s.docId, s.versionId, 0, 100, 700),
    })
  })

  test('reverting a department move puts the cue back and needs rights on both layers', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const cue = await mkCue(s, s.actors.owner, 'LX', { label: 'mover' })
    await updateCue(db, s.actors.owner, { cueId: cue.id, patch: { departmentId: s.depts.SND.id } })
    const seq = await lastSeq(s, cue.id, 'update')
    // the LX editor cannot edit SND, where the cue now sits
    expect(await code(revertChange(db, s.actors.editorLx, { seq }))).toBe('forbidden')
    expect((await getCue(db, s.actors.owner, { cueId: cue.id })).departmentId).toBe(s.depts.SND.id)
    await revertChange(db, s.actors.owner, { seq })
    expect((await getCue(db, s.actors.owner, { cueId: cue.id })).departmentId).toBe(s.depts.LX.id)
  })

  test('reverting a change whose field has since changed is conflict, and force reverts it', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const cue = await mkCue(s, s.actors.owner, 'LX', { label: 'Fly out' })
    const cueId = cue.id
    await updateCue(db, s.actors.owner, { cueId, patch: { label: 'Fly in' } })
    const seq = await lastSeq(s, cueId)
    await updateCue(db, s.actors.editor, { cueId, patch: { label: 'Fly in slowly' } })
    const before = await totalLogs(s)

    const err = await message(revertChange(db, s.actors.owner, { seq }))
    expect(await code(revertChange(db, s.actors.owner, { seq }))).toBe('conflict')
    expect(err).toContain('label')
    expect((await getCue(db, s.actors.owner, { cueId })).label).toBe('Fly in slowly')
    expect(await totalLogs(s)).toBe(before)

    await revertChange(db, s.actors.owner, { seq, force: true })
    expect((await getCue(db, s.actors.owner, { cueId })).label).toBe('Fly out')
  })

  test("drift on an untouched column is not a conflict; only the change's own columns are compared", async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const cue = await mkCue(s, s.actors.owner, 'LX', { label: 'a', notes: '' })
    await updateCue(db, s.actors.owner, { cueId: cue.id, patch: { label: 'b' } })
    const seq = await lastSeq(s, cue.id)
    await updateCue(db, s.actors.editor, { cueId: cue.id, patch: { notes: 'later note' } })
    await revertChange(db, s.actors.owner, { seq })
    expect(await getCue(db, s.actors.owner, { cueId: cue.id })).toMatchObject({
      label: 'a',
      notes: 'later note',
    })
  })

  test('force on a change whose old values are already back writes nothing and says so', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const cue = await mkCue(s, s.actors.owner, 'LX', { label: 'a' })
    await updateCue(db, s.actors.owner, { cueId: cue.id, patch: { label: 'b' } })
    const seq = await lastSeq(s, cue.id, 'update')
    await revertChange(db, s.actors.owner, { seq })
    const before = await totalLogs(s)
    const again = await revertChange(db, s.actors.owner, { seq, force: true })
    expect(again).toMatchObject({ reverted: 0, skipped: [{ seq, reason: 'already-reverted' }] })
    expect(await totalLogs(s)).toBe(before)
  })

  test('a single revert of an update whose row is gone is conflict', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const cue = await mkCue(s, s.actors.owner, 'LX', { label: 'a' })
    await updateCue(db, s.actors.owner, { cueId: cue.id, patch: { label: 'b' } })
    const seq = await lastSeq(s, cue.id, 'update')
    await deleteCues(db, s.actors.owner, { cueIds: [cue.id] })
    expect(await code(revertChange(db, s.actors.owner, { seq }))).toBe('conflict')
    expect(await cueCount(s)).toBe(0)
  })

  test('JSON columns are compared as values: a re-ordered anchor object is not drift', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const first = anchorAt(s.docId, s.versionId, 0, 10, 20)
    const cue = await mkCue(s, s.actors.owner, 'LX', { anchor: first })
    const second = anchorAt(s.docId, s.versionId, 1, 30, 40)
    await updateCue(db, s.actors.owner, { cueId: cue.id, patch: { anchor: second } })
    const seq = await lastSeq(s, cue.id, 'update')
    // rewrite the stored anchor with the same value, keys in another order
    const shuffled = Object.fromEntries(Object.entries(second).reverse())
    await s.deps.db
      .update(cues)
      .set({ anchor: shuffled as typeof second })
      .where(eq(cues.id, cue.id))
    await revertChange(db, s.actors.owner, { seq })
    expect((await getCue(db, s.actors.owner, { cueId: cue.id })).anchor).toEqual(first)
  })
})

describe('revertChange: inserts and deletes', () => {
  test('reverting an insert deletes the cue; reverting that delete re-creates it with the same id and fields', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const cue = await mkCue(s, s.actors.owner, 'TM', {
      label: 'Preset',
      number: { major: 14, minor: 50 },
      type: 'standby',
      notes: 'careful',
      colour: '#112233',
      anchor: anchorAt(s.docId, s.versionId, 2, 120, 500),
    })
    const gone = await revertChange(db, s.actors.owner, { seq: await lastSeq(s, cue.id, 'insert') })
    expect(gone.reverted).toBe(1)
    expect(await cueCount(s)).toBe(0)
    const deleteRow = (await logsOf(s, cue.id)).at(-1)
    expect(deleteRow).toMatchObject({ op: 'delete', batchId: gone.batchId })

    await revertChange(db, s.actors.owner, { seq: deleteRow?.seq as number })
    const back = await getCue(db, s.actors.owner, { cueId: cue.id })
    expect(back).toMatchObject({
      id: cue.id,
      departmentId: s.depts.TM.id,
      major: 14,
      minor: 50,
      label: 'Preset',
      type: 'standby',
      notes: 'careful',
      colour: '#112233',
      anchor: anchorAt(s.docId, s.versionId, 2, 120, 500),
    })
  })

  test('reverting an insert whose row has been edited since is conflict; force deletes it', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const cue = await mkCue(s, s.actors.owner, 'LX', { label: 'first' })
    await updateCue(db, s.actors.editor, { cueId: cue.id, patch: { label: 'edited' } })
    const seq = await lastSeq(s, cue.id, 'insert')
    expect(await code(revertChange(db, s.actors.owner, { seq }))).toBe('conflict')
    expect(await cueCount(s)).toBe(1)
    await revertChange(db, s.actors.owner, { seq, force: true })
    expect(await cueCount(s)).toBe(0)
  })

  test('reverting an insert whose row is already gone is skipped as already-reverted', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const cue = await mkCue(s, s.actors.owner, 'LX')
    await deleteCues(db, s.actors.owner, { cueIds: [cue.id] })
    const before = await totalLogs(s)
    const seq = await lastSeq(s, cue.id, 'insert')
    const result = await revertChange(db, s.actors.owner, { seq })
    expect(result).toMatchObject({ reverted: 0, skipped: [{ seq, reason: 'already-reverted' }] })
    expect(await totalLogs(s)).toBe(before)
  })

  test('reverting a delete when the row exists again is conflict, and force skips it', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const cue = await mkCue(s, s.actors.owner, 'LX', { label: 'original' })
    await deleteCues(db, s.actors.owner, { cueIds: [cue.id] })
    const seq = await lastSeq(s, cue.id, 'delete')
    await revertChange(db, s.actors.owner, { seq })
    expect(await code(revertChange(db, s.actors.owner, { seq }))).toBe('conflict')
    const forced = await revertChange(db, s.actors.owner, { seq, force: true })
    expect(forced).toMatchObject({ reverted: 0, skipped: [{ seq }] })
    expect(await cueCount(s)).toBe(1)
  })

  test('a deleted annotation is re-created with its id and fields', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const note = await createAnnotation(db, s.actors.owner, {
      showId: s.show.id,
      ...noteFields(s, lx(s), {
        type: 'rect',
        text: 'remember',
        geometry: { w: 40, h: 12 },
        style: { strokeWidth: 2 },
      }),
    })
    await deleteAnnotations(db, s.actors.owner, { annotationIds: [note.id] })
    await revertChange(db, s.actors.owner, { seq: await lastSeq(s, note.id, 'delete') })
    expect(await getAnnotation(db, s.actors.owner, { annotationId: note.id })).toMatchObject({
      id: note.id,
      layerKind: 'department',
      layerId: s.depts.LX.id,
      type: 'rect',
      text: 'remember',
      geometry: { w: 40, h: 12 },
      style: { strokeWidth: 2 },
    })
  })
})

describe('revertChange: unbound highlights', () => {
  test('reverting the delete of a re-anchored (unbound, unresolved) highlight re-creates it', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const bound = await createAnnotation(db, s.actors.owner, {
      showId: s.show.id,
      ...noteFields(s, lx(s), {
        type: 'highlight',
        text: '',
        anchor: {
          ...anchorAt(s.docId, s.versionId, 1),
          text: { quote: 'to be or', wordStart: 4, wordEnd: 6 },
        },
      }),
    })
    // Re-anchoring left it unbound and unresolved (written as the re-anchor job would).
    const unbound = {
      ...bound.anchor,
      status: 'unresolved' as const,
      text: { quote: 'to be or', wordStart: -1, wordEnd: -1 },
    }
    await db.update(annotations).set({ anchor: unbound }).where(eq(annotations.id, bound.id))
    await deleteAnnotations(db, s.actors.owner, { annotationIds: [bound.id] })
    await revertChange(db, s.actors.owner, { seq: await lastSeq(s, bound.id, 'delete') })
    expect(await getAnnotation(db, s.actors.owner, { annotationId: bound.id })).toMatchObject({
      id: bound.id,
      type: 'highlight',
      anchor: { status: 'unresolved', text: { wordStart: -1, wordEnd: -1 } },
    })
  })
})

describe('revertChange: other tables', () => {
  test('department, document, and show updates revert; their inserts and deletes do not', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    await updateDepartment(db, s.actors.owner, {
      departmentId: s.depts.LX.id,
      patch: { name: 'Lighting!', hidden: true },
    })
    await revertChange(db, s.actors.owner, {
      seq: await lastSeq(s, s.depts.LX.id, 'update'),
    })
    const [dept] = await db.select().from(departments).where(eq(departments.id, s.depts.LX.id))
    expect(dept).toMatchObject({ name: s.depts.LX.name, hidden: false })

    await updateDocument(db, s.actors.editor, { documentId: s.docId, patch: { title: 'Retitled' } })
    await revertChange(db, s.actors.editor, { seq: await lastSeq(s, s.docId, 'update') })
    const [doc] = await db.select().from(documents).where(eq(documents.id, s.docId))
    expect(doc.title).toBe('Libretto')

    await updateShow(db, s.actors.owner, {
      showId: s.show.id,
      patch: { title: 'New title', settings: { a: 1 } },
    })
    await revertChange(db, s.actors.owner, { seq: await lastSeq(s, s.show.id, 'update') })
    const [show] = await db.select().from(shows).where(eq(shows.id, s.show.id))
    expect(show).toMatchObject({ title: 'Show', settings: {} })

    // the department's own seeding insert, the show's insert, and a membership row are not revertable
    const deptInsert = await lastSeq(s, s.depts.LX.id, 'insert')
    expect(await code(revertChange(db, s.actors.owner, { seq: deptInsert }))).toBe('invalid')
    const showInsert = await lastSeq(s, s.show.id, 'insert')
    expect(await code(revertChange(db, s.actors.owner, { seq: showInsert }))).toBe('invalid')
    const [membership] = await db
      .select()
      .from(changeLog)
      .where(and(eq(changeLog.showId, s.show.id), eq(changeLog.tableName, 'show_memberships')))
    expect(await code(revertChange(db, s.actors.owner, { seq: membership.seq }))).toBe('invalid')
  })

  test('rights follow the table: an editor cannot revert a department rename; a viewer cannot revert a document edit', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    await updateDepartment(db, s.actors.owner, {
      departmentId: s.depts.SND.id,
      patch: { name: 'X' },
    })
    expect(
      await code(
        revertChange(db, s.actors.editor, { seq: await lastSeq(s, s.depts.SND.id, 'update') }),
      ),
    ).toBe('forbidden')
    await updateDocument(db, s.actors.editor, { documentId: s.docId, patch: { title: 'Mine' } })
    expect(
      await code(revertChange(db, s.actors.viewer, { seq: await lastSeq(s, s.docId, 'update') })),
    ).toBe('forbidden')
    const [doc] = await db.select().from(documents).where(eq(documents.id, s.docId))
    expect(doc.title).toBe('Mine')
  })
})

describe('revertBatch', () => {
  test('a batch is reverted newest first in one new batch; an insert followed by an update of the same cue ends with the cue gone', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const batchId = 'big-batch'
    const keep = await mkCue(s, s.actors.owner, 'LX', { label: 'old' })
    const fresh = await mkCue(s, s.actors.owner, 'LX', { label: 'fresh', batchId })
    await updateCue(db, s.actors.owner, { cueId: fresh.id, patch: { label: 'fresh 2' }, batchId })
    await updateCue(db, s.actors.owner, { cueId: keep.id, patch: { label: 'new' }, batchId })
    const result = await revertBatch(db, s.actors.owner, {
      showId: s.show.id,
      batchId,
      userId: s.owner.id,
    })
    expect(result).toMatchObject({ reverted: 3, skipped: [], rows: 3, deletes: 1 })
    expect(result.batchId).not.toBe(batchId)
    expect(await cueCount(s)).toBe(1)
    expect((await getCue(db, s.actors.owner, { cueId: keep.id })).label).toBe('old')
    // all three writes share the revert's batch id
    const written = await db.select().from(changeLog).where(eq(changeLog.batchId, result.batchId))
    expect(written).toHaveLength(3)
  })

  test('two users whose uploads reused a client batch id are reverted separately', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const ownersCue = await mkCue(s, s.actors.owner, 'LX', { label: 'before' })
    const editorsCue = await mkCue(s, s.actors.editor, 'LX', { label: 'editor before' })
    const upload = (cookie: string, id: string, label: string) =>
      s.app.request('/api/sync/upload', {
        method: 'POST',
        headers: { cookie, origin: APP_ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify({
          batchId: 'dev-1',
          entries: [{ table: 'cues', id, op: 'PATCH', data: { label } }],
        }),
      })
    expect((await upload(s.owner.cookie, ownersCue.id, 'owner label')).status).toBe(200)
    expect((await upload(s.editor.cookie, editorsCue.id, 'editor label')).status).toBe(200)

    await revertBatch(db, s.actors.owner, {
      showId: s.show.id,
      batchId: `${s.owner.id}:dev-1`,
      userId: s.owner.id,
    })
    expect((await getCue(db, s.actors.owner, { cueId: ownersCue.id })).label).toBe('before')
    expect((await getCue(db, s.actors.owner, { cueId: editorsCue.id })).label).toBe('editor label')
  })

  test('two users sharing a raw batch id: reverting one leaves the other', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const a = await mkCue(s, s.actors.owner, 'LX', { batchId: 'same' })
    const b = await mkCue(s, s.actors.editor, 'LX', { batchId: 'same' })
    const result = await revertBatch(db, s.actors.owner, {
      showId: s.show.id,
      batchId: 'same',
      userId: s.editor.id,
    })
    expect(result).toMatchObject({ reverted: 1, deletes: 1 })
    const left = await db.select({ id: cues.id }).from(cues).where(eq(cues.showId, s.show.id))
    expect(left.map((c) => c.id)).toEqual([a.id])
    expect(b.id).not.toBe(a.id)
  })

  test('revertBatch with the right batch id but another user id touches nothing', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const cue = await mkCue(s, s.actors.owner, 'LX', { label: 'x', batchId: 'mine' })
    const before = await totalLogs(s)
    for (const userId of [s.editor.id, s.viewer.id, newId()]) {
      expect(
        await code(revertBatch(db, s.actors.owner, { showId: s.show.id, batchId: 'mine', userId })),
      ).toBe('not_found')
    }
    // and the right user with another show's id or batch id
    expect(
      await code(
        revertBatch(db, s.actors.owner, { showId: s.show.id, batchId: 'nope', userId: s.owner.id }),
      ),
    ).toBe('not_found')
    expect(await cueCount(s)).toBe(1)
    expect((await getCue(db, s.actors.owner, { cueId: cue.id })).label).toBe('x')
    expect(await totalLogs(s)).toBe(before)
  })

  test('a batch of another show is not reachable through this one', async () => {
    const s = await setupMarkupShow()
    const other = await setupMarkupShow()
    await mkCue(other, other.actors.owner, 'LX', { batchId: 'theirs' })
    // the owner of show A has no membership in show B
    expect(
      await code(
        revertBatch(s.deps.db, s.actors.owner, {
          showId: other.show.id,
          batchId: 'theirs',
          userId: other.owner.id,
        }),
      ),
    ).toBe('not_found')
    expect(await cueCount(other)).toBe(1)
  })

  test('reverting the same batch twice is conflict the second time', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const cue = await mkCue(s, s.actors.owner, 'LX', { label: 'one' })
    await updateCue(db, s.actors.owner, { cueId: cue.id, patch: { label: 'two' }, batchId: 'once' })
    const input = { showId: s.show.id, batchId: 'once', userId: s.owner.id }
    await revertBatch(db, s.actors.owner, input)
    const before = await totalLogs(s)
    expect(await code(revertBatch(db, s.actors.owner, input))).toBe('conflict')
    expect(await totalLogs(s)).toBe(before)
    expect((await getCue(db, s.actors.owner, { cueId: cue.id })).label).toBe('one')
  })

  test('a batch revert skips rows that are gone and continues; a conflict anywhere writes nothing', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const a = await mkCue(s, s.actors.owner, 'LX', { label: 'a0' })
    const b = await mkCue(s, s.actors.owner, 'LX', { label: 'b0' })
    const c = await mkCue(s, s.actors.owner, 'LX', { label: 'c0' })
    for (const [cue, label] of [
      [a, 'a1'],
      [b, 'b1'],
      [c, 'c1'],
    ] as const) {
      await updateCue(db, s.actors.owner, { cueId: cue.id, patch: { label }, batchId: 'trio' })
    }
    const input = { showId: s.show.id, batchId: 'trio', userId: s.owner.id }
    await deleteCues(db, s.actors.owner, { cueIds: [b.id] })
    const bSeq = await lastSeq(s, b.id, 'update')

    // c drifted: the whole call is conflict and a and b's state is untouched
    await updateCue(db, s.actors.editor, { cueId: c.id, patch: { label: 'c2' } })
    expect(await code(revertBatch(db, s.actors.owner, input))).toBe('conflict')
    expect((await getCue(db, s.actors.owner, { cueId: a.id })).label).toBe('a1')

    const forced = await revertBatch(db, s.actors.owner, { ...input, force: true })
    expect(forced).toMatchObject({ reverted: 2, skipped: [{ seq: bSeq, reason: 'row-gone' }] })
    expect((await getCue(db, s.actors.owner, { cueId: a.id })).label).toBe('a0')
    expect((await getCue(db, s.actors.owner, { cueId: c.id })).label).toBe('c0')
  })

  test('the LX editor reverting a batch that touched SND is forbidden and nothing changes', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const l = await mkCue(s, s.actors.owner, 'LX', { label: 'l0' })
    const d = await mkCue(s, s.actors.owner, 'SND', { label: 'd0' })
    await updateCue(db, s.actors.owner, { cueId: d.id, patch: { label: 'd1' }, batchId: 'both' })
    await updateCue(db, s.actors.owner, { cueId: l.id, patch: { label: 'l1' }, batchId: 'both' })
    const before = await totalLogs(s)
    expect(
      await code(
        revertBatch(db, s.actors.editorLx, {
          showId: s.show.id,
          batchId: 'both',
          userId: s.owner.id,
        }),
      ),
    ).toBe('forbidden')
    expect((await getCue(db, s.actors.owner, { cueId: l.id })).label).toBe('l1')
    expect((await getCue(db, s.actors.owner, { cueId: d.id })).label).toBe('d1')
    expect(await totalLogs(s)).toBe(before)
    // the owner can
    await revertBatch(db, s.actors.owner, {
      showId: s.show.id,
      batchId: 'both',
      userId: s.owner.id,
    })
    expect((await getCue(db, s.actors.owner, { cueId: d.id })).label).toBe('d0')
  })

  test('dryRun counts rows and deletes and writes nothing', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const keep = await mkCue(s, s.actors.owner, 'LX', { label: 'k0' })
    for (let i = 0; i < 3; i++) await mkCue(s, s.actors.owner, 'LX', { batchId: 'dry' })
    await updateCue(db, s.actors.owner, { cueId: keep.id, patch: { label: 'k1' }, batchId: 'dry' })
    const before = await totalLogs(s)
    const seqBefore = await db
      .select({ seq: changeLog.seq })
      .from(changeLog)
      .where(eq(changeLog.showId, s.show.id))

    const dry = await revertBatch(db, s.actors.owner, {
      showId: s.show.id,
      batchId: 'dry',
      userId: s.owner.id,
      dryRun: true,
    })
    expect(dry).toMatchObject({ rows: 4, deletes: 3, reverted: 4, skipped: [] })
    expect(await cueCount(s)).toBe(4)
    expect((await getCue(db, s.actors.owner, { cueId: keep.id })).label).toBe('k1')
    expect(await totalLogs(s)).toBe(before)
    expect(
      (
        await db
          .select({ seq: changeLog.seq })
          .from(changeLog)
          .where(eq(changeLog.showId, s.show.id))
      )
        .map((r) => r.seq)
        .sort(),
    ).toEqual(seqBefore.map((r) => r.seq).sort())

    // a dry run still refuses what the real run would: no rights, then conflict
    expect(
      await code(
        revertBatch(db, s.actors.viewer, {
          showId: s.show.id,
          batchId: 'dry',
          userId: s.owner.id,
          dryRun: true,
        }),
      ),
    ).toBe('forbidden')
    await updateCue(db, s.actors.editor, { cueId: keep.id, patch: { label: 'k2' } })
    expect(
      await code(
        revertBatch(db, s.actors.owner, {
          showId: s.show.id,
          batchId: 'dry',
          userId: s.owner.id,
          dryRun: true,
        }),
      ),
    ).toBe('conflict')
  })
})

/** Resolves once some backend is waiting on a lock. */
const waitForLock = (s: Setup) =>
  vi.waitFor(
    async () => {
      const { rows } = await s.deps.db.$client.query(
        `SELECT count(*)::int AS n FROM pg_stat_activity
         WHERE datname = current_database() AND wait_event_type = 'Lock'`,
      )
      expect(rows[0].n).toBeGreaterThan(0)
    },
    { timeout: 5_000, interval: 20 },
  )

describe('concurrency', () => {
  test('a commit to a drifted column that lands while a revert waits is seen as drift (conflict), not overwritten', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const cue = await mkCue(s, s.actors.owner, 'LX', { label: 'a' })
    await updateCue(db, s.actors.owner, { cueId: cue.id, patch: { label: 'b' } })
    const seq = await lastSeq(s, cue.id, 'update')

    let release = () => {}
    const gate = new Promise<void>((r) => {
      release = r
    })
    let held = () => {}
    const holding = new Promise<void>((r) => {
      held = r
    })
    // A collaborator's edit is in flight: the row is locked and not yet committed.
    const holder = db.transaction(async (tx) => {
      await updateCue(tx, s.actors.editor, { cueId: cue.id, patch: { label: 'c' } })
      held()
      await gate
    })
    await holding
    const reverting = code(revertChange(db, s.actors.owner, { seq }))
    await waitForLock(s)
    release()
    await holder
    expect(await reverting).toBe('conflict')
    expect((await getCue(db, s.actors.owner, { cueId: cue.id })).label).toBe('c')
  })

  test('two batch reverts that touch the same rows in opposite orders do not deadlock', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const a = await mkCue(s, s.actors.owner, 'LX', { label: 'a0', notes: 'a0' })
    const b = await mkCue(s, s.actors.owner, 'LX', { label: 'b0', notes: 'b0' })
    // newest first, the owner's batch reverts b then a; the editor's reverts a then b
    await updateCue(db, s.actors.owner, { cueId: a.id, patch: { label: 'a1' }, batchId: 'ob' })
    await updateCue(db, s.actors.owner, { cueId: b.id, patch: { label: 'b1' }, batchId: 'ob' })
    await updateCue(db, s.actors.editor, { cueId: b.id, patch: { notes: 'b1' }, batchId: 'eb' })
    await updateCue(db, s.actors.editor, { cueId: a.id, patch: { notes: 'a1' }, batchId: 'eb' })
    const results = await Promise.allSettled([
      revertBatch(db, s.actors.owner, { showId: s.show.id, batchId: 'ob', userId: s.owner.id }),
      revertBatch(db, s.actors.owner, { showId: s.show.id, batchId: 'eb', userId: s.editor.id }),
    ])
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled'])
    expect(await getCue(db, s.actors.owner, { cueId: a.id })).toMatchObject({
      label: 'a0',
      notes: 'a0',
    })
    expect(await getCue(db, s.actors.owner, { cueId: b.id })).toMatchObject({
      label: 'b0',
      notes: 'b0',
    })
  })

  test('a delete revert that loses the re-create race to another create is conflict ("row exists again"), not a 500', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const cue = await mkCue(s, s.actors.owner, 'LX', { label: 'original' })
    await deleteCues(db, s.actors.owner, { cueIds: [cue.id] })
    const seq = await lastSeq(s, cue.id, 'delete')

    let release = () => {}
    const gate = new Promise<void>((r) => {
      release = r
    })
    let held = () => {}
    const holding = new Promise<void>((r) => {
      held = r
    })
    // Someone else re-creates the same id and has not committed yet, so the revert sees no row.
    const holder = db.transaction(async (tx) => {
      await createCue(tx, s.actors.editor, {
        showId: s.show.id,
        id: cue.id,
        departmentId: s.depts.LX.id,
        number: { major: cue.major, minor: cue.minor },
        label: 'recreated by someone else',
      })
      held()
      await gate
    })
    await holding
    const before = await totalLogs(s)
    const reverting = revertChange(db, s.actors.owner, { seq }).then(
      () => null,
      (e) => e,
    )
    await waitForLock(s)
    release()
    await holder
    const err = await reverting
    expect(err).toBeInstanceOf(AppError)
    expect(err.code).toBe('conflict')
    expect(err.message).toContain('row exists again')
    expect((await getCue(db, s.actors.owner, { cueId: cue.id })).label).toBe(
      'recreated by someone else',
    )
    // only the holder's insert was logged
    expect(await totalLogs(s)).toBe(before + 1)
  })
})

describe('personal layers', () => {
  test("reverting a change on someone else's personal annotation is not_found", async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const note = await createAnnotation(db, s.actors.viewer, {
      showId: s.show.id,
      ...noteFields(s, { kind: 'personal', id: s.viewer.id }, { text: 'mine' }),
      batchId: 'personal-batch',
    })
    await updateAnnotation(db, s.actors.viewer, {
      annotationId: note.id,
      patch: { text: 'mine, edited' },
    })
    const before = await totalLogs(s)
    for (const op of ['insert', 'update'] as const) {
      const seq = await lastSeq(s, note.id, op)
      expect(await code(revertChange(db, s.actors.owner, { seq }))).toBe('not_found')
      expect(await code(revertChange(db, s.actors.editor, { seq }))).toBe('not_found')
    }
    expect(
      await code(
        revertBatch(db, s.actors.owner, {
          showId: s.show.id,
          batchId: 'personal-batch',
          userId: s.viewer.id,
        }),
      ),
    ).toBe('not_found')
    expect(await totalLogs(s)).toBe(before)
    // the owner of the layer can revert their own edit
    await revertChange(db, s.actors.viewer, { seq: await lastSeq(s, note.id, 'update') })
    expect((await getAnnotation(db, s.actors.viewer, { annotationId: note.id })).text).toBe('mine')
  })

  test("rows on another user's personal layer are left out of a batch the reader can see; the visible rows revert", async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const cue = await mkCue(s, s.actors.editor, 'LX', { label: 'c0' })
    await updateCue(db, s.actors.editor, {
      cueId: cue.id,
      patch: { label: 'c1' },
      batchId: 'mixed',
    })
    const note = await createAnnotation(db, s.actors.editor, {
      showId: s.show.id,
      ...noteFields(s, { kind: 'personal', id: s.editor.id }),
      batchId: 'mixed',
    })
    const dry = await revertBatch(db, s.actors.owner, {
      showId: s.show.id,
      batchId: 'mixed',
      userId: s.editor.id,
      dryRun: true,
    })
    expect(dry).toMatchObject({ rows: 1, deletes: 0 })
    await revertBatch(db, s.actors.owner, {
      showId: s.show.id,
      batchId: 'mixed',
      userId: s.editor.id,
    })
    expect((await getCue(db, s.actors.owner, { cueId: cue.id })).label).toBe('c0')
    // the editor's private note is untouched
    expect(await getAnnotation(db, s.actors.editor, { annotationId: note.id })).toMatchObject({
      layerKind: 'personal',
    })
  })

  test("reverting a personal-to-department move: only the note's owner can, anyone else gets not_found and nothing is written", async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const note = await createAnnotation(db, s.actors.editor, {
      showId: s.show.id,
      ...noteFields(s, { kind: 'personal', id: s.editor.id }),
    })
    await updateAnnotation(db, s.actors.editor, {
      annotationId: note.id,
      patch: { layerKind: 'department', layerId: s.depts.LX.id },
      batchId: 'publish',
    })
    const seq = await lastSeq(s, note.id, 'update')
    const before = await totalLogs(s)
    for (const actor of [s.actors.owner, s.actors.editorLx, s.actors.viewer]) {
      expect(await code(revertChange(db, actor, { seq }))).toBe('not_found')
      expect(await code(revertChange(db, actor, { seq, force: true }))).toBe('not_found')
    }
    expect(
      await code(
        revertBatch(db, s.actors.owner, {
          showId: s.show.id,
          batchId: 'publish',
          userId: s.editor.id,
        }),
      ),
    ).toBe('not_found')
    expect(await totalLogs(s)).toBe(before)
    expect(
      (await db.select().from(annotations).where(eq(annotations.id, note.id)))[0],
    ).toMatchObject({ layerKind: 'department', layerId: s.depts.LX.id })

    // the owner of the personal layer moves it back
    await revertChange(db, s.actors.editor, { seq })
    expect(await getAnnotation(db, s.actors.editor, { annotationId: note.id })).toMatchObject({
      layerKind: 'personal',
      layerId: s.editor.id,
    })
  })
})

describe('guards', () => {
  test('an archived show refuses reverts (forbidden), dry runs included, and nothing changes', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const cue = await mkCue(s, s.actors.owner, 'LX', { label: 'a' })
    await updateCue(db, s.actors.owner, { cueId: cue.id, patch: { label: 'b' }, batchId: 'late' })
    const seq = await lastSeq(s, cue.id, 'update')
    await updateShow(db, s.actors.owner, { showId: s.show.id, patch: { status: 'archived' } })
    const before = await totalLogs(s)
    expect(await code(revertChange(db, s.actors.owner, { seq }))).toBe('forbidden')
    for (const dryRun of [false, true]) {
      expect(
        await code(
          revertBatch(db, s.actors.owner, {
            showId: s.show.id,
            batchId: 'late',
            userId: s.owner.id,
            dryRun,
          }),
        ),
      ).toBe('forbidden')
    }
    expect((await getCue(db, s.actors.owner, { cueId: cue.id })).label).toBe('b')
    expect(await totalLogs(s)).toBe(before)
  })

  test('an archived show refuses every revert before it looks at the rows: drift, non-revertable, or all skipped', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const drifted = await mkCue(s, s.actors.owner, 'LX', { label: 'a' })
    await updateCue(db, s.actors.owner, { cueId: drifted.id, patch: { label: 'b' }, batchId: 'dr' })
    await updateCue(db, s.actors.editor, { cueId: drifted.id, patch: { label: 'c' } })
    const driftSeq = await lastSeq(s, drifted.id, 'update')
    const gone = await mkCue(s, s.actors.owner, 'LX', { batchId: 'skip' })
    await deleteCues(db, s.actors.owner, { cueIds: [gone.id] })
    const insertSeq = await lastSeq(s, gone.id, 'insert')
    const deptInsert = await lastSeq(s, s.depts.LX.id, 'insert')
    await updateShow(db, s.actors.owner, { showId: s.show.id, patch: { status: 'archived' } })
    const before = await totalLogs(s)

    // drift would be conflict; a department insert would be invalid; both are forbidden here
    expect(await code(revertChange(db, s.actors.owner, { seq: driftSeq }))).toBe('forbidden')
    expect(await code(revertChange(db, s.actors.owner, { seq: deptInsert }))).toBe('forbidden')
    // the insert's row is gone: it would only be skipped, and the batch would succeed with reverted 0
    expect(await code(revertChange(db, s.actors.owner, { seq: insertSeq }))).toBe('forbidden')
    for (const input of [
      { batchId: 'dr', userId: s.owner.id },
      { batchId: 'skip', userId: s.owner.id },
    ]) {
      for (const dryRun of [false, true]) {
        expect(
          await code(revertBatch(db, s.actors.owner, { showId: s.show.id, ...input, dryRun })),
        ).toBe('forbidden')
      }
    }
    // a non-member still gets not_found, not a hint that the show is archived
    const outsider: Actor = { userId: s.outsider.id, via: 'web', agent: null }
    expect(await code(revertChange(db, outsider, { seq: driftSeq }))).toBe('not_found')
    expect(
      await code(
        revertBatch(db, outsider, { showId: s.show.id, batchId: 'skip', userId: s.owner.id }),
      ),
    ).toBe('not_found')
    expect(await totalLogs(s)).toBe(before)
  })

  test('a log row on a malformed personal layer ("personal:" with no id) is private to everyone', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const [row] = await db
      .insert(changeLog)
      .values({
        showId: s.show.id,
        userId: s.editor.id,
        via: 'web',
        batchId: 'odd',
        tableName: 'cues',
        rowId: newId(),
        op: 'delete',
        before: { label: 'x' },
        after: null,
        layer: 'personal:',
      })
      .returning()
    expect(await code(revertChange(db, s.actors.owner, { seq: row.seq }))).toBe('not_found')
    expect(
      await code(
        revertBatch(db, s.actors.owner, { showId: s.show.id, batchId: 'odd', userId: s.editor.id }),
      ),
    ).toBe('not_found')
    const history = await listHistory(db, s.actors.owner, { showId: s.show.id, rowId: row.rowId })
    expect(history.entries).toEqual([])
  })

  test('viewers can read history but cannot revert shared layers; non-members and unknown seqs are not_found', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const cue = await mkCue(s, s.actors.owner, 'LX', { label: 'a' })
    await updateCue(db, s.actors.owner, { cueId: cue.id, patch: { label: 'b' } })
    const seq = await lastSeq(s, cue.id, 'update')
    expect(await code(revertChange(db, s.actors.viewer, { seq }))).toBe('forbidden')
    const outsider: Actor = { userId: s.outsider.id, via: 'web', agent: null }
    expect(await code(revertChange(db, outsider, { seq }))).toBe('not_found')
    expect(await code(revertChange(db, s.actors.owner, { seq: 999_999_999 }))).toBe('not_found')
    expect(await code(revertChange(db, s.actors.owner, { seq: 0 }))).toBe('invalid')
    expect(await code(revertChange(db, s.actors.owner, { seq: 1.5 }))).toBe('invalid')
    const scoped: Actor = { ...s.actors.owner, via: 'mcp', agent: 'x', showScope: ['other'] }
    expect(await code(revertChange(db, scoped, { seq }))).toBe('forbidden')
    expect(
      await code(revertBatch(db, scoped, { showId: s.show.id, batchId: 'x', userId: s.owner.id })),
    ).toBe('forbidden')
    expect((await getCue(db, s.actors.owner, { cueId: cue.id })).label).toBe('b')
    // history stays readable for the viewer
    expect(
      (await listHistory(db, s.actors.viewer, { showId: s.show.id, rowId: cue.id })).entries,
    ).toHaveLength(2)
  })
})

describe('HTTP', () => {
  const post = (s: Setup, body: unknown, cookie = s.owner.cookie, showId = s.show.id) =>
    s.app.request(`/api/shows/${showId}/revert`, {
      method: 'POST',
      headers: { cookie, origin: APP_ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

  test('POST /api/shows/:id/revert with a batchId returns the new batch id', async () => {
    const s = await setupMarkupShow()
    const cue = await mkCue(s, s.actors.owner, 'LX', { label: 'a' })
    await updateCue(s.deps.db, s.actors.owner, {
      cueId: cue.id,
      patch: { label: 'b' },
      batchId: 'http-batch',
    })
    const res = await post(s, { batchId: 'http-batch', userId: s.owner.id })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { batchId: string; reverted: number; skipped: unknown[] }
    expect(body).toMatchObject({ reverted: 1, skipped: [] })
    expect(typeof body.batchId).toBe('string')
    expect((await getCue(s.deps.db, s.actors.owner, { cueId: cue.id })).label).toBe('a')
    expect((await logsOf(s, cue.id)).at(-1)?.batchId).toBe(body.batchId)
  })

  test('POST with a seq reverts one change; force and conflict map to status codes', async () => {
    const s = await setupMarkupShow()
    const cue = await mkCue(s, s.actors.owner, 'LX', { label: 'a' })
    await updateCue(s.deps.db, s.actors.owner, { cueId: cue.id, patch: { label: 'b' } })
    const seq = await lastSeq(s, cue.id, 'update')
    await updateCue(s.deps.db, s.actors.editor, { cueId: cue.id, patch: { label: 'c' } })
    const conflict = await post(s, { seq })
    expect(conflict.status).toBe(409)
    expect(((await conflict.json()) as { error: string }).error).toBe('conflict')
    const forced = await post(s, { seq, force: true })
    expect(forced.status).toBe(200)
    expect((await getCue(s.deps.db, s.actors.owner, { cueId: cue.id })).label).toBe('a')
  })

  test('bad bodies are 400, a seq from another show is 404, a viewer is 403, a non-member is 404, no session is 401', async () => {
    const s = await setupMarkupShow()
    const other = await setupMarkupShow()
    const cue = await mkCue(s, s.actors.owner, 'LX', { label: 'a' })
    await updateCue(s.deps.db, s.actors.owner, { cueId: cue.id, patch: { label: 'b' } })
    const seq = await lastSeq(s, cue.id, 'update')
    for (const body of [
      {},
      { seq: 'x' },
      { seq: 0 },
      { batchId: 'b' },
      { seq, batchId: 'b', userId: 'u' },
    ]) {
      expect((await post(s, body)).status, JSON.stringify(body)).toBe(400)
    }
    expect((await post(other, { seq }, other.owner.cookie)).status).toBe(404)
    expect((await post(s, { seq }, s.viewer.cookie)).status).toBe(403)
    expect((await post(s, { seq }, s.outsider.cookie)).status).toBe(404)
    const anon = await s.app.request(`/api/shows/${s.show.id}/revert`, {
      method: 'POST',
      headers: { origin: APP_ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ seq }),
    })
    expect(anon.status).toBe(401)
    expect((await getCue(s.deps.db, s.actors.owner, { cueId: cue.id })).label).toBe('b')
  })
})
