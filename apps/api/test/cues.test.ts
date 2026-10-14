import { changeLog, cues, departments } from '@binder/db'
import { type Actor, newId } from '@binder/shared'
import { and, eq } from 'drizzle-orm'
import { describe, expect, test } from 'vitest'
import { AppError } from '../src/errors'
import {
  createCue,
  createShow,
  deleteCues,
  getCue,
  listCues,
  listOrganisations,
  updateCue,
  updateShow,
} from '../src/services'
import { addReadyDocument, anchorAt, setupMarkupShow } from './markupHelpers'

const code = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e) => (e instanceof AppError ? e.code : 'other'),
  )

const FIELD_KEYS = ['anchor', 'colour', 'departmentId', 'label', 'major', 'minor', 'notes', 'type']

const logRows = (db: Parameters<typeof createCue>[0], rowId: string) =>
  db.select().from(changeLog).where(eq(changeLog.rowId, rowId)).orderBy(changeLog.seq)

describe('cue writes', () => {
  test('an LX editor creates an LX cue; the change log insert has layer department:<LX> and every field', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const cue = await createCue(db, s.actors.editorLx, {
      showId: s.show.id,
      departmentId: s.depts.LX.id,
      number: { major: 12, minor: 50 },
      label: 'Sunrise',
      notes: 'slow',
      colour: '#112233',
      type: 'warn',
      anchor: anchorAt(s.docId, s.versionId, 3),
    })
    expect(cue).toMatchObject({ major: 12, minor: 50, label: 'Sunrise', type: 'warn', payload: {} })
    expect(cue.updatedBy).toBe(s.editorLx.id)
    const [row] = await logRows(db, cue.id)
    expect(row.op).toBe('insert')
    expect(row.layer).toBe(`department:${s.depts.LX.id}`)
    expect(row.tableName).toBe('cues')
    expect(row.before).toBeNull()
    expect(Object.keys(row.after ?? {}).sort()).toEqual(FIELD_KEYS)
    expect(row.after).toMatchObject({ label: 'Sunrise', major: 12, minor: 50, colour: '#112233' })
  })

  test('the LX editor cannot create, move into, or delete SND cues (forbidden); a viewer cannot create cues', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const input = { showId: s.show.id, number: { major: 1, minor: 0 } }
    expect(
      await code(createCue(db, s.actors.editorLx, { ...input, departmentId: s.depts.SND.id })),
    ).toBe('forbidden')
    expect(
      await code(createCue(db, s.actors.viewer, { ...input, departmentId: s.depts.LX.id })),
    ).toBe('forbidden')

    const lxCue = await createCue(db, s.actors.editorLx, { ...input, departmentId: s.depts.LX.id })
    const sndCue = await createCue(db, s.actors.owner, { ...input, departmentId: s.depts.SND.id })
    expect(
      await code(
        updateCue(db, s.actors.editorLx, {
          cueId: lxCue.id,
          patch: { departmentId: s.depts.SND.id },
        }),
      ),
    ).toBe('forbidden')
    expect(
      await code(updateCue(db, s.actors.editorLx, { cueId: sndCue.id, patch: { label: 'x' } })),
    ).toBe('forbidden')
    expect(await code(deleteCues(db, s.actors.editorLx, { cueIds: [lxCue.id, sndCue.id] }))).toBe(
      'forbidden',
    )
    // all or nothing: the LX cue survived the refused call
    expect((await getCue(db, s.actors.owner, { cueId: lxCue.id })).departmentId).toBe(s.depts.LX.id)
    expect(await deleteCues(db, s.actors.editorLx, { cueIds: [lxCue.id] })).toEqual({
      deleted: [lxCue.id],
    })
    // a full-scope editor may move between departments they can edit
    const moved = await updateCue(db, s.actors.editor, {
      cueId: sndCue.id,
      patch: { departmentId: s.depts.VID.id },
    })
    expect(moved.departmentId).toBe(s.depts.VID.id)
  })

  test("an anchor on another show's version, or pageIndex 20 on a 20-page version, is invalid", async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const [org] = await listOrganisations(db, s.ownerActor)
    const other = await createShow(db, s.ownerActor, { organisationId: org.id, title: 'Other' })
    const foreign = await addReadyDocument(db, other.id, s.owner.id)
    const base = { showId: s.show.id, departmentId: s.depts.LX.id, number: { major: 1, minor: 0 } }
    expect(
      await code(
        createCue(db, s.actors.owner, {
          ...base,
          anchor: anchorAt(foreign.docId, foreign.versionId, 0),
        }),
      ),
    ).toBe('invalid')
    expect(
      await code(
        createCue(db, s.actors.owner, { ...base, anchor: anchorAt(s.docId, s.versionId, 20) }),
      ),
    ).toBe('invalid')
    expect(
      await code(
        createCue(db, s.actors.owner, { ...base, anchor: anchorAt(s.docId, 'missing', 0) }),
      ),
    ).toBe('invalid')
    // the version does not belong to the named document
    expect(
      await code(
        createCue(db, s.actors.owner, { ...base, anchor: anchorAt(foreign.docId, s.versionId, 0) }),
      ),
    ).toBe('invalid')
    expect(
      await code(
        createCue(db, s.actors.owner, { ...base, anchor: anchorAt(s.docId, s.versionId, 19) }),
      ),
    ).toBe('ok')
    const cue = await createCue(db, s.actors.owner, base)
    expect(
      await code(
        updateCue(db, s.actors.owner, {
          cueId: cue.id,
          patch: { anchor: anchorAt(s.docId, s.versionId, 20) },
        }),
      ),
    ).toBe('invalid')
    // a department of another show is invalid too
    const depts = await db.select().from(departments).where(eq(departments.showId, other.id))
    expect(await code(createCue(db, s.actors.owner, { ...base, departmentId: depts[0].id }))).toBe(
      'invalid',
    )
  })

  test('minor 100, major -1, colour "red", and NUL in the label are invalid', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const base = { showId: s.show.id, departmentId: s.depts.LX.id }
    const bad = [
      { number: { major: 1, minor: 100 } },
      { number: { major: -1, minor: 0 } },
      { number: { major: 10000, minor: 0 } },
      { number: { major: 1.5, minor: 0 } },
      { number: { major: 1, minor: 0 }, colour: 'red' },
      { number: { major: 1, minor: 0 }, label: 'a\u0000b' },
      { number: { major: 1, minor: 0 }, notes: 'x'.repeat(10001) },
      { number: { major: 1, minor: 0 }, type: 'bogus' as 'go' },
    ]
    for (const extra of bad)
      expect(await code(createCue(db, s.actors.owner, { ...base, ...extra }))).toBe('invalid')
    const cue = await createCue(db, s.actors.owner, { ...base, number: { major: 1, minor: 0 } })
    for (const patch of [{ minor: 100 }, { major: -1 }, { colour: 'red' }, { label: 'a\u0000' }]) {
      expect(await code(updateCue(db, s.actors.owner, { cueId: cue.id, patch }))).toBe('invalid')
    }
    expect(await db.select().from(cues).where(eq(cues.showId, s.show.id))).toHaveLength(1)
  })

  test('without a number the cue takes suggestCueNumber from reading-order neighbours', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const make = (
      number: { major: number; minor: number },
      page: number,
      y: number,
      dept = s.depts.LX,
    ) =>
      createCue(db, s.actors.owner, {
        showId: s.show.id,
        departmentId: dept.id,
        number,
        anchor: anchorAt(s.docId, s.versionId, page, 100, y),
      })
    await make({ major: 10, minor: 0 }, 0, 700)
    await make({ major: 11, minor: 0 }, 1, 700)
    await make({ major: 50, minor: 0 }, 0, 100, s.depts.SND) // another department is not a neighbour
    const mid = await createCue(db, s.actors.owner, {
      showId: s.show.id,
      departmentId: s.depts.LX.id,
      anchor: anchorAt(s.docId, s.versionId, 0, 100, 300),
    })
    expect({ major: mid.major, minor: mid.minor }).toEqual({ major: 10, minor: 50 })
    // after the last cue in reading order: the next integer
    const last = await createCue(db, s.actors.owner, {
      showId: s.show.id,
      departmentId: s.depts.LX.id,
      anchor: anchorAt(s.docId, s.versionId, 5),
    })
    expect({ major: last.major, minor: last.minor }).toEqual({ major: 12, minor: 0 })
    // unplaced: prev is the department's highest number
    const unplaced = await createCue(db, s.actors.owner, {
      showId: s.show.id,
      departmentId: s.depts.LX.id,
    })
    expect({ major: unplaced.major, minor: unplaced.minor }).toEqual({ major: 13, minor: 0 })
    // the first cue of an empty department
    const first = await createCue(db, s.actors.owner, {
      showId: s.show.id,
      departmentId: s.depts.FLY.id,
    })
    expect({ major: first.major, minor: first.minor }).toEqual({ major: 10, minor: 0 })
  })

  test('a client id is used as given; reusing it is conflict; a non-UUID id is invalid', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const id = newId()
    const base = { showId: s.show.id, departmentId: s.depts.LX.id, number: { major: 1, minor: 0 } }
    const cue = await createCue(db, s.actors.owner, { ...base, id })
    expect(cue.id).toBe(id)
    expect(await code(createCue(db, s.actors.owner, { ...base, id }))).toBe('conflict')
    expect(await code(createCue(db, s.actors.owner, { ...base, id: 'not-a-uuid' }))).toBe('invalid')
    expect(await db.select().from(cues).where(eq(cues.id, id))).toHaveLength(1)
  })

  test('updateCue logs only changed columns and a no-op writes no row', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const anchor = {
      ...anchorAt(s.docId, s.versionId, 2),
      text: { quote: 'hello', wordStart: 1, wordEnd: 2 },
    }
    const cue = await createCue(db, s.actors.owner, {
      showId: s.show.id,
      departmentId: s.depts.LX.id,
      number: { major: 5, minor: 0 },
      label: 'a',
      anchor,
    })
    const before = (await logRows(db, cue.id)).length
    // same values, anchor with a different key order
    const reordered = {
      status: 'ok',
      y: 700,
      x: 100,
      pageIndex: 2,
      text: { wordEnd: 2, wordStart: 1, quote: 'hello' },
      documentVersionId: s.versionId,
      documentId: s.docId,
    } as typeof anchor
    await updateCue(db, s.actors.owner, {
      cueId: cue.id,
      patch: { label: 'a', major: 5, anchor: reordered },
    })
    expect(await logRows(db, cue.id)).toHaveLength(before)

    const updated = await updateCue(db, s.actors.owner, {
      cueId: cue.id,
      patch: { label: 'b', minor: 50, major: 5 },
    })
    expect(updated.label).toBe('b')
    const rows = await logRows(db, cue.id)
    expect(rows).toHaveLength(before + 1)
    const row = rows.at(-1)
    expect(row?.op).toBe('update')
    expect(row?.before).toEqual({ label: 'a', minor: 0 })
    expect(row?.after).toEqual({ label: 'b', minor: 50 })
    expect(row?.layer).toBe(`department:${s.depts.LX.id}`)

    const unplaced = await updateCue(db, s.actors.owner, { cueId: cue.id, patch: { anchor: null } })
    expect(unplaced.anchor).toBeNull()
    expect((await logRows(db, cue.id)).at(-1)?.before).toEqual({ anchor })
  })

  test('an archived show refuses cue writes', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const cue = await createCue(db, s.actors.owner, {
      showId: s.show.id,
      departmentId: s.depts.LX.id,
    })
    await updateShow(db, s.actors.owner, { showId: s.show.id, patch: { status: 'archived' } })
    const base = { showId: s.show.id, departmentId: s.depts.LX.id }
    expect(await code(createCue(db, s.actors.owner, base))).toBe('forbidden')
    expect(
      await code(updateCue(db, s.actors.owner, { cueId: cue.id, patch: { label: 'x' } })),
    ).toBe('forbidden')
    expect(await code(deleteCues(db, s.actors.owner, { cueIds: [cue.id] }))).toBe('forbidden')
    expect((await getCue(db, s.actors.owner, { cueId: cue.id })).label).toBe('')
  })

  test('deleting a department that still has cues fails at the database (RESTRICT)', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    await createCue(db, s.actors.owner, { showId: s.show.id, departmentId: s.depts.LX.id })
    const err = await db
      .delete(departments)
      .where(eq(departments.id, s.depts.LX.id))
      .then(
        () => null,
        (e: { cause?: { code?: string } }) => e,
      )
    expect(err?.cause?.code).toBe('23503')
    expect(
      await db
        .select()
        .from(departments)
        .where(and(eq(departments.id, s.depts.LX.id))),
    ).toHaveLength(1)
  })

  test('deleteCues logs every field in before, on the cue layer', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const cue = await createCue(db, s.actors.owner, {
      showId: s.show.id,
      departmentId: s.depts.SND.id,
      label: 'bye',
    })
    expect(await code(deleteCues(db, s.actors.owner, { cueIds: [cue.id, newId()] }))).toBe(
      'not_found',
    )
    await deleteCues(db, s.actors.owner, { cueIds: [cue.id, cue.id] })
    const row = (await logRows(db, cue.id)).at(-1)
    expect(row?.op).toBe('delete')
    expect(row?.layer).toBe(`department:${s.depts.SND.id}`)
    expect(Object.keys(row?.before ?? {}).sort()).toEqual(FIELD_KEYS)
    expect(row?.after).toBeNull()
  })
})

describe('cue reads', () => {
  test('listCues sorts by (major, minor), flags duplicates, and formats per number format', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const mk = (
      dept: keyof typeof s.depts,
      major: number,
      minor: number,
      extra: { label?: string } = {},
    ) =>
      createCue(db, s.actors.owner, {
        showId: s.show.id,
        departmentId: s.depts[dept].id,
        number: { major, minor },
        ...extra,
      })
    await mk('TM', 14, 50)
    await mk('LX', 14, 50)
    await mk('LX', 12, 0)
    await mk('LX', 12, 0)
    await mk('LX', 3, 5)
    const all = await listCues(db, s.actors.viewer, { showId: s.show.id })
    expect(all.map((c) => `${c.departmentCode} ${c.display}`)).toEqual([
      'LX 3.05',
      'LX 12',
      'LX 12',
      'LX 14.5',
      'TM 14.50',
    ])
    expect(all.map((c) => c.duplicate)).toEqual([false, true, true, false, false])
    const lx = await listCues(db, s.actors.viewer, {
      showId: s.show.id,
      departmentId: s.depts.LX.id,
    })
    expect(lx).toHaveLength(4)
    const tm = await listCues(db, s.actors.viewer, {
      showId: s.show.id,
      departmentId: s.depts.TM.id,
    })
    expect(tm.map((c) => c.display)).toEqual(['14.50'])
  })

  test('listCues filters by document and placement', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const base = { showId: s.show.id, departmentId: s.depts.LX.id }
    const placed = await createCue(db, s.actors.owner, {
      ...base,
      anchor: anchorAt(s.docId, s.versionId, 1),
    })
    const loose = await createCue(db, s.actors.owner, base)
    const ids = async (f: { documentId?: string; placed?: boolean }) =>
      (await listCues(db, s.actors.owner, { showId: s.show.id, ...f })).map((c) => c.id)
    expect(await ids({ placed: true })).toEqual([placed.id])
    expect(await ids({ placed: false })).toEqual([loose.id])
    expect(await ids({ documentId: s.docId })).toEqual([placed.id])
    expect(await ids({ documentId: newId() })).toEqual([])
  })

  test('a token scoped to another show cannot read these cues (forbidden)', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const cue = await createCue(db, s.actors.owner, {
      showId: s.show.id,
      departmentId: s.depts.LX.id,
    })
    const scoped: Actor = {
      ...s.actors.owner,
      via: 'mcp',
      agent: 'x',
      showScope: ['some-other-show'],
    }
    expect(await code(listCues(db, scoped, { showId: s.show.id }))).toBe('forbidden')
    expect(await code(getCue(db, scoped, { cueId: cue.id }))).toBe('forbidden')
    expect(
      await code(createCue(db, scoped, { showId: s.show.id, departmentId: s.depts.LX.id })),
    ).toBe('forbidden')
    // a non-member cannot tell the cue exists
    const outsider: Actor = { userId: s.outsider.id, via: 'web', agent: null }
    expect(await code(getCue(db, outsider, { cueId: cue.id }))).toBe('not_found')
    expect(await code(getCue(db, s.actors.owner, { cueId: newId() }))).toBe('not_found')
  })
})
