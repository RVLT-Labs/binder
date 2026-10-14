import { annotations as annotationsTable, changeLog } from '@binder/db'
import { type Actor, type AnnotationFields, DEFAULT_STAMPS, newId, stampSet } from '@binder/shared'
import { eq } from 'drizzle-orm'
import { describe, expect, test } from 'vitest'
import { AppError } from '../src/errors'
import {
  createAnnotation,
  createShow,
  deleteAnnotations,
  getAnnotation,
  getShow,
  listAnnotations,
  listDepartments,
  listOrganisations,
  updateAnnotation,
  updateShow,
} from '../src/services'
import { addReadyDocument, anchorAt, setupMarkupShow } from './markupHelpers'

const code = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e) => (e instanceof AppError ? e.code : 'other'),
  )

const FIELD_KEYS = ['anchor', 'geometry', 'layerId', 'layerKind', 'style', 'text', 'type']

const logRows = (db: Parameters<typeof createAnnotation>[0], rowId: string) =>
  db.select().from(changeLog).where(eq(changeLog.rowId, rowId)).orderBy(changeLog.seq)

const rowsOf = (db: Parameters<typeof createAnnotation>[0], showId: string) =>
  db.select().from(annotationsTable).where(eq(annotationsTable.showId, showId))

type Setup = Awaited<ReturnType<typeof setupMarkupShow>>

/** Annotation fields on `layer`, defaulting to a note on page 0. */
const fields = (
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

const personal = (userId: string) => ({ kind: 'personal' as const, id: userId })

describe('personal layers are private', () => {
  test('a viewer adds a personal note; nobody else can list, get, update, or delete it (not_found), owners included', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const note = await createAnnotation(db, s.actors.viewer, {
      showId: s.show.id,
      ...fields(s, personal(s.viewer.id), { text: 'mine' }),
    })
    expect(note).toMatchObject({ layerKind: 'personal', layerId: s.viewer.id, text: 'mine' })

    // The owner sees the show but not the viewer's layer.
    expect(
      (await listAnnotations(db, s.actors.owner, { showId: s.show.id })).map((a) => a.id),
    ).not.toContain(note.id)
    for (const who of [s.actors.owner, s.actors.editor, s.actors.editorLx]) {
      for (const attempt of [
        () => getAnnotation(db, who, { annotationId: note.id }),
        () => updateAnnotation(db, who, { annotationId: note.id, patch: { text: 'x' } }),
        () => deleteAnnotations(db, who, { annotationIds: [note.id] }),
        () => listAnnotations(db, who, { showId: s.show.id, layer: personal(s.viewer.id) }),
      ]) {
        expect(await code(attempt())).toBe('not_found')
      }
    }
    // Nothing was changed by the refused attempts, and the owner of the layer still reads it.
    const mine = await getAnnotation(db, s.actors.viewer, { annotationId: note.id })
    expect(mine.text).toBe('mine')
    expect(
      (await listAnnotations(db, s.actors.viewer, { showId: s.show.id })).map((a) => a.id),
    ).toEqual([note.id])
    expect(
      (
        await listAnnotations(db, s.actors.viewer, {
          showId: s.show.id,
          layer: personal(s.viewer.id),
        })
      ).map((a) => a.id),
    ).toEqual([note.id])
    expect(await logRows(db, note.id)).toHaveLength(1)
  })

  test("another member's personal annotation is indistinguishable from a missing id, and a non-member sees not_found for any of them", async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const note = await createAnnotation(db, s.actors.viewer, {
      showId: s.show.id,
      ...fields(s, personal(s.viewer.id)),
    })
    const outsider: Actor = { userId: s.outsider.id, via: 'web', agent: null }
    const missing = newId()
    for (const id of [note.id, missing]) {
      const asOwner = await getAnnotation(db, s.actors.owner, { annotationId: id }).catch(
        (e: AppError) => e,
      )
      const asOutsider = await getAnnotation(db, outsider, { annotationId: id }).catch(
        (e: AppError) => e,
      )
      expect((asOwner as AppError).code).toBe('not_found')
      expect((asOutsider as AppError).code).toBe('not_found')
    }
    expect(await code(listAnnotations(db, outsider, { showId: s.show.id }))).toBe('not_found')
  })

  test('the not_found message is identical for a missing id, an id in a show the caller is not in, and a foreign personal row', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const lx = { kind: 'department' as const, id: s.depts.LX.id }
    const shared = await createAnnotation(db, s.actors.owner, {
      showId: s.show.id,
      ...fields(s, lx),
    })
    const theirs = await createAnnotation(db, s.actors.viewer, {
      showId: s.show.id,
      ...fields(s, personal(s.viewer.id)),
    })
    const outsider: Actor = { userId: s.outsider.id, via: 'web', agent: null }
    const message = (p: Promise<unknown>) =>
      p.then(
        () => 'ok',
        (e) => (e instanceof AppError ? `${e.code}: ${e.message}` : 'other'),
      )
    const attempts = (who: Actor, annotationId: string) => [
      message(getAnnotation(db, who, { annotationId })),
      message(updateAnnotation(db, who, { annotationId, patch: { text: 'x' } })),
      message(deleteAnnotations(db, who, { annotationIds: [annotationId] })),
    ]
    const missing = await Promise.all(attempts(s.actors.owner, newId()))
    expect(missing).toEqual(Array(3).fill('not_found: Annotation not found'))
    // Existing in a show the outsider is not in; and the viewer's personal row seen by the owner.
    expect(await Promise.all(attempts(outsider, shared.id))).toEqual(missing)
    expect(await Promise.all(attempts(s.actors.owner, theirs.id))).toEqual(missing)
  })

  test("creating a personal annotation on someone else's layer id is forbidden", async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const base = { showId: s.show.id }
    // The owner cannot write into the viewer's layer, and the viewer not into the owner's.
    expect(
      await code(
        createAnnotation(db, s.actors.owner, { ...base, ...fields(s, personal(s.viewer.id)) }),
      ),
    ).toBe('forbidden')
    expect(
      await code(
        createAnnotation(db, s.actors.viewer, { ...base, ...fields(s, personal(s.owner.id)) }),
      ),
    ).toBe('forbidden')
    expect(
      await code(
        createAnnotation(db, s.actors.viewer, { ...base, ...fields(s, personal(newId())) }),
      ),
    ).toBe('forbidden')
    expect(await rowsOf(db, s.show.id)).toHaveLength(0)
    // Their own layer is fine for everyone, owner included.
    expect(
      await code(
        createAnnotation(db, s.actors.owner, { ...base, ...fields(s, personal(s.owner.id)) }),
      ),
    ).toBe('ok')
  })

  test("a personal annotation cannot be moved onto another user's layer or a department the actor cannot edit", async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const note = await createAnnotation(db, s.actors.editorLx, {
      showId: s.show.id,
      ...fields(s, personal(s.editorLx.id)),
    })
    expect(
      await code(
        updateAnnotation(db, s.actors.editorLx, {
          annotationId: note.id,
          patch: { layerId: s.owner.id },
        }),
      ),
    ).toBe('forbidden')
    expect(
      await code(
        updateAnnotation(db, s.actors.editorLx, {
          annotationId: note.id,
          patch: { layerKind: 'department', layerId: s.depts.SND.id },
        }),
      ),
    ).toBe('forbidden')
    // Moving to LX needs edit rights on both layers, which the LX editor has.
    const moved = await updateAnnotation(db, s.actors.editorLx, {
      annotationId: note.id,
      patch: { layerKind: 'department', layerId: s.depts.LX.id },
    })
    expect(moved).toMatchObject({ layerKind: 'department', layerId: s.depts.LX.id })
    const log = (await logRows(db, note.id)).at(-1)
    expect(log?.layer).toBe(`department:${s.depts.LX.id}`)
    expect(log?.before).toEqual({ layerKind: 'personal', layerId: s.editorLx.id })
  })

  test('a viewer cannot move a department annotation to their personal layer (no edit rights on the source)', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const note = await createAnnotation(db, s.actors.owner, {
      showId: s.show.id,
      ...fields(s, { kind: 'department', id: s.depts.LX.id }),
    })
    expect(
      await code(
        updateAnnotation(db, s.actors.viewer, {
          annotationId: note.id,
          patch: { layerKind: 'personal', layerId: s.viewer.id },
        }),
      ),
    ).toBe('forbidden')
    expect((await getAnnotation(db, s.actors.viewer, { annotationId: note.id })).layerKind).toBe(
      'department',
    )
  })
})

describe('department layers', () => {
  test('the LX editor draws on LX, not SND; moving an LX annotation to SND is forbidden', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const lx = { kind: 'department' as const, id: s.depts.LX.id }
    const snd = { kind: 'department' as const, id: s.depts.SND.id }
    const rect = await createAnnotation(db, s.actors.editorLx, {
      showId: s.show.id,
      ...fields(s, lx, { type: 'rect', geometry: { w: 120, h: 40 }, text: '' }),
    })
    expect(rect.updatedBy).toBe(s.editorLx.id)
    expect(
      await code(createAnnotation(db, s.actors.editorLx, { showId: s.show.id, ...fields(s, snd) })),
    ).toBe('forbidden')
    expect(
      await code(
        updateAnnotation(db, s.actors.editorLx, {
          annotationId: rect.id,
          patch: { layerId: s.depts.SND.id },
        }),
      ),
    ).toBe('forbidden')
    // An SND annotation is visible to the LX editor but not editable or deletable by them.
    const sound = await createAnnotation(db, s.actors.editor, {
      showId: s.show.id,
      ...fields(s, snd),
    })
    expect(
      (await listAnnotations(db, s.actors.editorLx, { showId: s.show.id })).map((a) => a.id),
    ).toContain(sound.id)
    expect(
      await code(
        updateAnnotation(db, s.actors.editorLx, { annotationId: sound.id, patch: { text: 'x' } }),
      ),
    ).toBe('forbidden')
    expect(
      await code(deleteAnnotations(db, s.actors.editorLx, { annotationIds: [sound.id] })),
    ).toBe('forbidden')
    // Owners edit every layer.
    expect(
      await code(
        updateAnnotation(db, s.actors.owner, { annotationId: sound.id, patch: { text: 'ok' } }),
      ),
    ).toBe('ok')
  })

  test('a viewer cannot create on a department layer; a department of another show is invalid', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const lx = { kind: 'department' as const, id: s.depts.LX.id }
    expect(
      await code(createAnnotation(db, s.actors.viewer, { showId: s.show.id, ...fields(s, lx) })),
    ).toBe('forbidden')
    const [org] = await listOrganisations(db, s.ownerActor)
    const other = await createShow(db, s.ownerActor, { organisationId: org.id, title: 'Other' })
    const [otherDept] = await listDepartments(db, s.ownerActor, { showId: other.id })
    expect(
      await code(
        createAnnotation(db, s.actors.owner, {
          showId: s.show.id,
          ...fields(s, { kind: 'department', id: otherDept.id }),
        }),
      ),
    ).toBe('invalid')
  })

  test("an anchor on another show's version, or pageIndex 20 on a 20-page version, is invalid", async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const lx = { kind: 'department' as const, id: s.depts.LX.id }
    const [org] = await listOrganisations(db, s.ownerActor)
    const other = await createShow(db, s.ownerActor, { organisationId: org.id, title: 'Other' })
    const foreign = await addReadyDocument(db, other.id, s.owner.id)
    const create = (anchor: AnnotationFields['anchor']) =>
      code(
        createAnnotation(db, s.actors.owner, { showId: s.show.id, ...fields(s, lx, { anchor }) }),
      )
    expect(await create(anchorAt(foreign.docId, foreign.versionId, 0))).toBe('invalid')
    expect(await create(anchorAt(s.docId, s.versionId, 20))).toBe('invalid')
    expect(await create(anchorAt(s.docId, s.versionId, 19))).toBe('ok')
    const note = await createAnnotation(db, s.actors.owner, { showId: s.show.id, ...fields(s, lx) })
    expect(
      await code(
        updateAnnotation(db, s.actors.owner, {
          annotationId: note.id,
          patch: { anchor: anchorAt(s.docId, s.versionId, 20) },
        }),
      ),
    ).toBe('invalid')
  })

  test('an archived show refuses annotation writes, personal ones included', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const mine = await createAnnotation(db, s.actors.viewer, {
      showId: s.show.id,
      ...fields(s, personal(s.viewer.id)),
    })
    await updateShow(db, s.actors.owner, { showId: s.show.id, patch: { status: 'archived' } })
    expect(
      await code(
        createAnnotation(db, s.actors.viewer, {
          showId: s.show.id,
          ...fields(s, personal(s.viewer.id)),
        }),
      ),
    ).toBe('forbidden')
    expect(
      await code(
        updateAnnotation(db, s.actors.viewer, { annotationId: mine.id, patch: { text: 'x' } }),
      ),
    ).toBe('forbidden')
    expect(await code(deleteAnnotations(db, s.actors.viewer, { annotationIds: [mine.id] }))).toBe(
      'forbidden',
    )
    expect((await getAnnotation(db, s.actors.viewer, { annotationId: mine.id })).text).toBe(
      'a note',
    )
  })
})

describe('validation', () => {
  test('geometry is checked per type', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const lx = { kind: 'department' as const, id: s.depts.LX.id }
    const hl = (wordStart: number) => ({
      ...anchorAt(s.docId, s.versionId, 0),
      text: { quote: 'to be or', wordStart, wordEnd: wordStart + 2 },
    })
    const cases: [string, Partial<AnnotationFields>, string][] = [
      ['rect w 0', { type: 'rect', geometry: { w: 0, h: 5 }, text: '' }, 'invalid'],
      ['rect too wide', { type: 'rect', geometry: { w: 14401, h: 5 }, text: '' }, 'invalid'],
      ['ellipse missing h', { type: 'ellipse', geometry: { w: 5 }, text: '' }, 'invalid'],
      ['arrow zero', { type: 'arrow', geometry: { dx: 0, dy: 0 }, text: '' }, 'invalid'],
      ['line without geometry', { type: 'line', geometry: {}, text: '' }, 'invalid'],
      ['note with geometry', { type: 'note', geometry: { w: 5, h: 5 } }, 'invalid'],
      ['highlight without text', { type: 'highlight', text: '' }, 'invalid'],
      ['highlight wordStart -1', { type: 'highlight', anchor: hl(-1), text: '' }, 'invalid'],
      ['note empty', { type: 'note', text: '' }, 'invalid'],
      ['stamp empty', { type: 'stamp', text: '' }, 'invalid'],
      ['stamp too long', { type: 'stamp', text: 'x'.repeat(41) }, 'invalid'],
      ['text NUL', { text: 'a\u0000b' }, 'invalid'],
      ['style colour', { style: { colour: 'red' } }, 'invalid'],
      ['rect ok', { type: 'rect', geometry: { w: 30, h: 5 }, text: '' }, 'ok'],
      ['arrow ok', { type: 'arrow', geometry: { dx: -30, dy: 0 }, text: '' }, 'ok'],
      ['highlight ok', { type: 'highlight', anchor: hl(4), text: '' }, 'ok'],
      ['stamp ok', { type: 'stamp', text: 'Fly in', style: { fontSize: 18 } }, 'ok'],
    ]
    for (const [name, over, expected] of cases) {
      expect(
        await code(
          createAnnotation(db, s.actors.owner, { showId: s.show.id, ...fields(s, lx, over) }),
        ),
        name,
      ).toBe(expected)
    }
  })

  test('an update is checked as a whole: a type change needs matching geometry', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const lx = { kind: 'department' as const, id: s.depts.LX.id }
    const rect = await createAnnotation(db, s.actors.owner, {
      showId: s.show.id,
      ...fields(s, lx, { type: 'rect', geometry: { w: 10, h: 10 }, text: '' }),
    })
    // A rect has w and h; making it an arrow without a new geometry is invalid, with one it is fine.
    expect(
      await code(
        updateAnnotation(db, s.actors.owner, { annotationId: rect.id, patch: { type: 'arrow' } }),
      ),
    ).toBe('invalid')
    expect(
      await code(
        updateAnnotation(db, s.actors.owner, {
          annotationId: rect.id,
          patch: { geometry: { w: 0, h: 1 } },
        }),
      ),
    ).toBe('invalid')
    const arrow = await updateAnnotation(db, s.actors.owner, {
      annotationId: rect.id,
      patch: { type: 'arrow', geometry: { dx: 5, dy: 5 } },
    })
    expect(arrow).toMatchObject({ type: 'arrow', geometry: { dx: 5, dy: 5 } })
  })

  test('an unbound highlight (wordStart -1) can be accepted (status ok) and moved by update', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const lx = { kind: 'department' as const, id: s.depts.LX.id }
    const bound = await createAnnotation(db, s.actors.owner, {
      showId: s.show.id,
      ...fields(s, lx, {
        type: 'highlight',
        text: '',
        anchor: {
          ...anchorAt(s.docId, s.versionId, 1),
          text: { quote: 'to be or', wordStart: 4, wordEnd: 6 },
        },
      }),
    })
    // Re-anchoring left it unbound and approximate (written as the re-anchor job would).
    const unboundAnchor = {
      ...bound.anchor,
      status: 'unresolved' as const,
      text: { quote: 'to be or', wordStart: -1, wordEnd: -1 },
    }
    await db
      .update(annotationsTable)
      .set({ anchor: unboundAnchor })
      .where(eq(annotationsTable.id, bound.id))
    const accepted = await updateAnnotation(db, s.actors.owner, {
      annotationId: bound.id,
      patch: { anchor: { ...unboundAnchor, status: 'ok' } },
    })
    expect(accepted.anchor).toMatchObject({ status: 'ok', text: { wordStart: -1, wordEnd: -1 } })
    const moved = await updateAnnotation(db, s.actors.owner, {
      annotationId: bound.id,
      patch: { anchor: { ...unboundAnchor, status: 'ok', pageIndex: 4, x: 50, y: 60 } },
    })
    expect(moved.anchor).toMatchObject({ pageIndex: 4, x: 50, y: 60, status: 'ok' })
    // A highlight whose anchor lost its text entirely is still refused.
    const { text: _dropped, ...noText } = unboundAnchor
    expect(
      await code(
        updateAnnotation(db, s.actors.owner, { annotationId: bound.id, patch: { anchor: noText } }),
      ),
    ).toBe('invalid')
  })

  test('a client id is used as given; reusing it is conflict; a non-UUID id is invalid', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const lx = { kind: 'department' as const, id: s.depts.LX.id }
    const id = newId()
    const made = await createAnnotation(db, s.actors.owner, {
      showId: s.show.id,
      id,
      ...fields(s, lx),
    })
    expect(made.id).toBe(id)
    expect(
      await code(createAnnotation(db, s.actors.owner, { showId: s.show.id, id, ...fields(s, lx) })),
    ).toBe('conflict')
    expect(
      await code(
        createAnnotation(db, s.actors.owner, {
          showId: s.show.id,
          id: 'not-a-uuid',
          ...fields(s, lx),
        }),
      ),
    ).toBe('invalid')
  })
})

describe('change log', () => {
  test('personal rows log layer personal:<userId>; department rows department:<id>', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const lx = { kind: 'department' as const, id: s.depts.LX.id }
    const mine = await createAnnotation(db, s.actors.viewer, {
      showId: s.show.id,
      ...fields(s, personal(s.viewer.id)),
    })
    const shared = await createAnnotation(db, s.actors.editorLx, {
      showId: s.show.id,
      ...fields(s, lx, { type: 'arrow', geometry: { dx: 10, dy: -4 }, text: 'x' }),
    })
    await updateAnnotation(db, s.actors.viewer, {
      annotationId: mine.id,
      patch: { text: 'edited' },
    })
    await deleteAnnotations(db, s.actors.editorLx, { annotationIds: [shared.id] })

    const personalLog = await logRows(db, mine.id)
    expect(personalLog.map((l) => [l.op, l.layer, l.tableName])).toEqual([
      ['insert', `personal:${s.viewer.id}`, 'annotations'],
      ['update', `personal:${s.viewer.id}`, 'annotations'],
    ])
    expect(Object.keys(personalLog[0].after ?? {}).sort()).toEqual(FIELD_KEYS)
    expect(personalLog[1]).toMatchObject({ before: { text: 'a note' }, after: { text: 'edited' } })

    const deptLog = await logRows(db, shared.id)
    expect(deptLog.map((l) => [l.op, l.layer])).toEqual([
      ['insert', `department:${s.depts.LX.id}`],
      ['delete', `department:${s.depts.LX.id}`],
    ])
    expect(Object.keys(deptLog[1].before ?? {}).sort()).toEqual(FIELD_KEYS)
    expect(deptLog[1].after).toBeNull()
  })

  test('updateAnnotation logs only changed columns; a no-op, even with reordered JSON keys, writes no row', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const lx = { kind: 'department' as const, id: s.depts.LX.id }
    const a = await createAnnotation(db, s.actors.owner, {
      showId: s.show.id,
      ...fields(s, lx, {
        type: 'rect',
        geometry: { w: 40, h: 20 },
        style: { colour: '#112233', strokeWidth: 2 },
        text: '',
      }),
    })
    expect(await logRows(db, a.id)).toHaveLength(1)
    await updateAnnotation(db, s.actors.owner, {
      annotationId: a.id,
      patch: {
        geometry: { h: 20, w: 40 },
        style: { strokeWidth: 2, colour: '#112233' },
        anchor: { ...a.anchor },
        text: '',
      },
    })
    expect(await logRows(db, a.id)).toHaveLength(1)

    const moved = await updateAnnotation(db, s.actors.owner, {
      annotationId: a.id,
      patch: { geometry: { w: 80, h: 20 }, text: '' },
    })
    expect(moved.geometry).toEqual({ w: 80, h: 20 })
    const log = await logRows(db, a.id)
    expect(log).toHaveLength(2)
    expect(log[1]).toMatchObject({
      op: 'update',
      before: { geometry: { w: 40, h: 20 } },
      after: { geometry: { w: 80, h: 20 } },
    })
  })

  test('deleteAnnotations is all or nothing and shares one batch id', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const lx = { kind: 'department' as const, id: s.depts.LX.id }
    const snd = { kind: 'department' as const, id: s.depts.SND.id }
    const a = await createAnnotation(db, s.actors.owner, { showId: s.show.id, ...fields(s, lx) })
    const b = await createAnnotation(db, s.actors.owner, { showId: s.show.id, ...fields(s, snd) })
    const c = await createAnnotation(db, s.actors.owner, { showId: s.show.id, ...fields(s, lx) })
    // The LX editor can delete LX rows but not the SND one: nothing is deleted.
    expect(
      await code(deleteAnnotations(db, s.actors.editorLx, { annotationIds: [a.id, b.id] })),
    ).toBe('forbidden')
    expect(
      await code(deleteAnnotations(db, s.actors.owner, { annotationIds: [a.id, newId()] })),
    ).toBe('not_found')
    expect(await rowsOf(db, s.show.id)).toHaveLength(3)
    const done = await deleteAnnotations(db, s.actors.owner, { annotationIds: [a.id, c.id, a.id] })
    expect(done.deleted.sort()).toEqual([a.id, c.id].sort())
    const batches = new Set(
      (await logRows(db, a.id))
        .concat(await logRows(db, c.id))
        .filter((l) => l.op === 'delete')
        .map((l) => l.batchId),
    )
    expect(batches.size).toBe(1)
  })
})

describe('reading', () => {
  test('listAnnotations filters by layer and document; sorted by creation', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const lx = { kind: 'department' as const, id: s.depts.LX.id }
    const snd = { kind: 'department' as const, id: s.depts.SND.id }
    const second = await addReadyDocument(db, s.show.id, s.owner.id)
    const a = await createAnnotation(db, s.actors.owner, { showId: s.show.id, ...fields(s, lx) })
    const b = await createAnnotation(db, s.actors.owner, { showId: s.show.id, ...fields(s, snd) })
    const c = await createAnnotation(db, s.actors.owner, {
      showId: s.show.id,
      ...fields(s, lx, { anchor: anchorAt(second.docId, second.versionId, 2) }),
    })
    const own = await createAnnotation(db, s.actors.owner, {
      showId: s.show.id,
      ...fields(s, personal(s.owner.id)),
    })
    const ids = async (input: Parameters<typeof listAnnotations>[2], who = s.actors.owner) =>
      (await listAnnotations(db, who, input)).map((x) => x.id)
    expect(await ids({ showId: s.show.id })).toEqual([a.id, b.id, c.id, own.id])
    expect(await ids({ showId: s.show.id, layer: lx })).toEqual([a.id, c.id])
    expect(await ids({ showId: s.show.id, layer: personal(s.owner.id) })).toEqual([own.id])
    expect(await ids({ showId: s.show.id, documentId: second.docId })).toEqual([c.id])
    expect(await ids({ showId: s.show.id, layer: lx, documentId: s.docId })).toEqual([a.id])
    // The viewer sees department layers but not the owner's personal one.
    expect(await ids({ showId: s.show.id }, s.actors.viewer)).toEqual([a.id, b.id, c.id])
  })

  test('a token scoped to another show cannot read these annotations (forbidden)', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const note = await createAnnotation(db, s.actors.owner, {
      showId: s.show.id,
      ...fields(s, { kind: 'department', id: s.depts.LX.id }),
    })
    const scoped: Actor = {
      ...s.actors.owner,
      via: 'mcp',
      agent: 'x',
      showScope: ['some-other-show'],
    }
    expect(await code(listAnnotations(db, scoped, { showId: s.show.id }))).toBe('forbidden')
    expect(await code(getAnnotation(db, scoped, { annotationId: note.id }))).toBe('forbidden')
  })
})

describe('stamp set', () => {
  test('stampSet falls back to the defaults', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    expect(stampSet({})).toEqual([...DEFAULT_STAMPS])
    expect(stampSet({ stampSet: [] })).toEqual([...DEFAULT_STAMPS])
    // A fresh show has no stampSet, so it shows the defaults; the owner's own list replaces them.
    const fresh = await getShow(db, s.actors.owner, { showId: s.show.id })
    expect(stampSet(fresh.settings)).toEqual([...DEFAULT_STAMPS])
    await updateShow(db, s.actors.owner, {
      showId: s.show.id,
      patch: { settings: { ...fresh.settings, stampSet: ['Hold', 'Go'] } },
    })
    const edited = await getShow(db, s.actors.owner, { showId: s.show.id })
    expect(stampSet(edited.settings)).toEqual(['Hold', 'Go'])
  })
})
