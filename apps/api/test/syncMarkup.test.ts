import { annotations, changeLog, cues, syncAppliedChunks } from '@binder/db'
import { type Actor, newId, type SyncCrudEntry } from '@binder/shared'
import { eq, inArray } from 'drizzle-orm'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { z } from 'zod'
import { conflict } from '../src/errors'
import { createCue, createShow, getCue, listOrganisations } from '../src/services'
import { applyCrudBatch, deleteAppliedChunksBefore } from '../src/sync/apply'
import { rowPolicy, SYNC_TABLES } from '../src/sync/policy'
import { APP_ORIGIN } from './helpers'
import { anchorAt, setupMarkupShow } from './markupHelpers'

const FIELD_KEYS = ['anchor', 'colour', 'departmentId', 'label', 'major', 'minor', 'notes', 'type']

const viaSync = (actor: Actor): Actor => ({ ...actor, via: 'sync' })

const put = (
  table: string,
  id: string,
  data: Record<string, unknown>,
  clientTs?: string,
): SyncCrudEntry => ({ table, id, op: 'PUT', data, ...(clientTs ? { clientTs } : {}) })

const patch = (
  table: string,
  id: string,
  data: Record<string, unknown>,
  clientTs?: string,
): SyncCrudEntry => ({ table, id, op: 'PATCH', data, ...(clientTs ? { clientTs } : {}) })

const del = (table: string, id: string): SyncCrudEntry => ({ table, id, op: 'DELETE' })

async function setup() {
  const s = await setupMarkupShow()
  const db = s.deps.db
  /** A cue as the client's local row: wire column names, SQLite encodings, plus columns sync ignores. */
  const cueRow = (over: Record<string, unknown> = {}) => ({
    show_id: s.show.id,
    department_id: s.depts.LX.id,
    major: 12,
    minor: 0,
    label: 'Lights up',
    anchor: null,
    type: 'go',
    notes: '',
    colour: null,
    payload: '{"cueList":"hack"}',
    created_at: '2026-10-15T10:00:00.000Z',
    updated_at: '2026-10-15T10:00:00.000Z',
    updated_by: 'someone-else',
    ...over,
  })
  const rowCount = async (id: string) =>
    (await db.select({ id: cues.id }).from(cues).where(eq(cues.id, id))).length
  const logRows = (rowId: string) =>
    db.select().from(changeLog).where(eq(changeLog.rowId, rowId)).orderBy(changeLog.seq)
  return {
    ...s,
    db,
    cueRow,
    rowCount,
    logRows,
    /** An annotation as the client's local row: JSON columns as text, as SQLite stores them. */
    annRow: (over: Record<string, unknown> = {}) => ({
      show_id: s.show.id,
      layer_kind: 'department',
      layer_id: s.depts.LX.id,
      anchor: JSON.stringify(anchorAt(s.docId, s.versionId, 1)),
      type: 'note',
      geometry: '{}',
      text: 'hello',
      style: '{}',
      created_at: '2026-10-15T10:00:00.000Z',
      updated_at: '2026-10-15T10:00:00.000Z',
      updated_by: 'someone-else',
      ...over,
    }),
    annRows: (id: string) => db.select().from(annotations).where(eq(annotations.id, id)),
    viewerSync: viaSync(s.actors.viewer),
    editorSync: viaSync(s.actors.editor),
    editorLxSync: viaSync(s.actors.editorLx),
    ownerSync: viaSync(s.actors.owner),
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('PUT', () => {
  test('PUT creates a cue with the client id and logs one insert', async () => {
    const { db, editor, editorSync, cueRow, logRows, show, depts } = await setup()
    const id = newId()
    const result = await applyCrudBatch(db, editorSync, {
      batchId: `${editor.id}:dev-1`,
      entries: [put('cues', id, cueRow({ minor: 50, colour: '#112233' }), '2026-10-15T10:00:00Z')],
    })
    expect(result).toEqual({ applied: 1, rejected: [] })
    const [row] = await db.select().from(cues).where(eq(cues.id, id))
    expect(row).toMatchObject({
      showId: show.id,
      departmentId: depts.LX.id,
      major: 12,
      minor: 50,
      label: 'Lights up',
      colour: '#112233',
      type: 'go',
      anchor: null,
      // Not writable through sync: the server's own values stand.
      payload: {},
      updatedBy: editor.id,
    })
    const logs = await logRows(id)
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({
      op: 'insert',
      tableName: 'cues',
      via: 'sync',
      userId: editor.id,
      batchId: `${editor.id}:dev-1`,
      layer: `department:${depts.LX.id}`,
      before: null,
    })
    expect(Object.keys(logs[0].after ?? {}).sort()).toEqual(FIELD_KEYS)
    expect(logs[0].clientTs?.toISOString()).toBe('2026-10-15T10:00:00.000Z')
  })

  test('a replayed batch after a lost response applies once and logs once', async () => {
    const { db, editor, editorSync, cueRow, rowCount, logRows } = await setup()
    const id = newId()
    const req = {
      batchId: `${editor.id}:dev-7`,
      entries: [put('cues', id, cueRow({ label: 'A' }))],
    }
    expect(await applyCrudBatch(db, editorSync, req)).toEqual({ applied: 1, rejected: [] })
    expect(await applyCrudBatch(db, editorSync, req)).toEqual({
      applied: 0,
      rejected: [],
      replay: true,
    })
    expect(await rowCount(id)).toBe(1)
    expect(await logRows(id)).toHaveLength(1)
  })

  test('concurrent PUTs of one id yield one row', async () => {
    const { db, editor, editorSync, cueRow, rowCount, logRows } = await setup()
    const id = newId()
    const reqA = { batchId: `${editor.id}:dev-a`, entries: [put('cues', id, cueRow())] }
    const reqB = {
      batchId: `${editor.id}:dev-b`,
      entries: [put('cues', id, cueRow({ notes: 'second' }))],
    }
    const results = await Promise.all([
      applyCrudBatch(db, editorSync, reqA),
      applyCrudBatch(db, editorSync, reqB),
    ])
    expect(results).toEqual([
      { applied: 1, rejected: [] },
      { applied: 1, rejected: [] },
    ])
    expect(await rowCount(id)).toBe(1)
    expect((await logRows(id)).filter((r) => r.op === 'insert')).toHaveLength(1)
  })

  test('a PUT that loses the insert race to another create is retried as the existing-row branch', async () => {
    const { db, actors, editor, editorSync, cueRow, rowCount, logRows, show, depts } = await setup()
    const id = newId()
    let release = () => {}
    const gate = new Promise<void>((r) => {
      release = r
    })
    let created = () => {}
    const holding = new Promise<void>((r) => {
      created = r
    })
    // Another transaction creates the same id and holds it uncommitted.
    const holder = db.transaction(async (tx) => {
      await createCue(tx, actors.editor, {
        showId: show.id,
        id,
        departmentId: depts.LX.id,
        number: { major: 12, minor: 0 },
        label: 'Lights up',
      })
      created()
      await gate
    })
    await holding
    // The PUT sees no row, so it inserts, and waits on the unique index.
    const putting = applyCrudBatch(db, editorSync, {
      batchId: `${editor.id}:race`,
      entries: [put('cues', id, cueRow({ notes: 'from the race' }))],
    })
    await vi.waitFor(
      async () => {
        const { rows } = await db.$client.query(
          `SELECT count(*)::int AS n FROM pg_stat_activity
           WHERE datname = current_database() AND wait_event_type = 'Lock'`,
        )
        expect(rows[0].n).toBeGreaterThan(0)
      },
      { timeout: 5_000, interval: 20 },
    )
    release()
    await holder
    // The 23505 is not a rejection: the entry is retried, finds the row, and updates it.
    expect(await putting).toEqual({ applied: 1, rejected: [] })
    expect(await rowCount(id)).toBe(1)
    const logs = await logRows(id)
    expect(logs.map((l) => l.op)).toEqual(['insert', 'update'])
    expect(logs[1]).toMatchObject({ before: { notes: '' }, after: { notes: 'from the race' } })
  })

  test("a replayed PUT does not overwrite a collaborator's newer label", async () => {
    const { db, actors, editor, owner, editorSync, ownerSync, cueRow, logRows } = await setup()
    const id = newId()
    const first = put('cues', id, cueRow({ label: 'A', notes: '' }), '2026-10-15T10:00:00Z')
    await applyCrudBatch(db, editorSync, { batchId: `${editor.id}:b-1`, entries: [first] })
    await applyCrudBatch(db, ownerSync, {
      batchId: `${owner.id}:b-2`,
      entries: [patch('cues', id, { label: 'B' }, '2026-10-15T10:01:00Z')],
    })
    // Re-sent in a new transaction (a different batch id), so chunk dedup does not catch it.
    expect(
      await applyCrudBatch(db, editorSync, { batchId: `${editor.id}:b-4`, entries: [first] }),
    ).toEqual({ applied: 1, rejected: [] })
    expect((await getCue(db, actors.owner, { cueId: id })).label).toBe('B')
    expect((await logRows(id)).map((l) => l.op)).toEqual(['insert', 'update'])
  })

  test("a replayed PUT still applies the columns nobody else changed, and skips the collaborator's", async () => {
    const { db, actors, editor, owner, editorSync, ownerSync, cueRow, logRows } = await setup()
    const id = newId()
    const at = '2026-10-15T10:00:00Z'
    await applyCrudBatch(db, editorSync, {
      batchId: `${editor.id}:c-1`,
      entries: [put('cues', id, cueRow({ label: 'A', notes: 'n1' }), at)],
    })
    await applyCrudBatch(db, ownerSync, {
      batchId: `${owner.id}:c-2`,
      entries: [patch('cues', id, { label: 'B' }, '2026-10-15T10:01:00Z')],
    })
    // The same create re-PUT with a different note (a local edit folded into the PUT).
    await applyCrudBatch(db, editorSync, {
      batchId: `${editor.id}:c-3`,
      entries: [put('cues', id, cueRow({ label: 'A', notes: 'n2' }), at)],
    })
    const cue = await getCue(db, actors.owner, { cueId: id })
    expect({ label: cue.label, notes: cue.notes }).toEqual({ label: 'B', notes: 'n2' })
    const last = (await logRows(id)).at(-1)
    expect(last).toMatchObject({ userId: editor.id, after: { notes: 'n2' } })
    expect(last?.after).not.toHaveProperty('label')
  })

  test("without a clientTs, a re-PUT skips columns others changed after the actor's last write", async () => {
    const { db, actors, editor, owner, editorSync, ownerSync, cueRow } = await setup()
    const id = newId()
    await applyCrudBatch(db, editorSync, {
      batchId: `${editor.id}:d-1`,
      entries: [put('cues', id, cueRow({ label: 'A', notes: 'x' }))],
    })
    await applyCrudBatch(db, ownerSync, {
      batchId: `${owner.id}:d-2`,
      entries: [patch('cues', id, { label: 'B' })],
    })
    await applyCrudBatch(db, editorSync, {
      batchId: `${editor.id}:d-3`,
      entries: [put('cues', id, cueRow({ label: 'A', notes: 'y' }))],
    })
    const cue = await getCue(db, actors.owner, { cueId: id })
    expect({ label: cue.label, notes: cue.notes }).toEqual({ label: 'B', notes: 'y' })
    // Once the actor has written after the collaborator, their next re-PUT wins again.
    await applyCrudBatch(db, editorSync, {
      batchId: `${editor.id}:d-4`,
      entries: [put('cues', id, cueRow({ label: 'C', notes: 'y' }))],
    })
    expect((await getCue(db, actors.owner, { cueId: id })).label).toBe('C')
  })

  test('PATCH after a rejected PUT is not_found and the batch is still 200', async () => {
    const { db, editorLx, editorLxSync, cueRow, rowCount, depts } = await setup()
    const id = newId()
    const r = await applyCrudBatch(db, editorLxSync, {
      batchId: `${editorLx.id}:b-3`,
      entries: [
        put('cues', id, cueRow({ department_id: depts.SND.id })),
        patch('cues', id, { label: 'x' }),
      ],
    })
    expect(r.applied).toBe(0)
    expect(r.rejected.map((x) => [x.index, x.reason])).toEqual([
      [0, 'forbidden'],
      [1, 'not_found'],
    ])
    expect(await rowCount(id)).toBe(0)
  })

  test('PUT for an existing id with changed columns is an update logging only the changes', async () => {
    const { db, editor, editorSync, cueRow, logRows, rowCount, depts } = await setup()
    const id = newId()
    await applyCrudBatch(db, editorSync, {
      batchId: `${editor.id}:e-1`,
      entries: [put('cues', id, cueRow())],
    })
    const r = await applyCrudBatch(db, editorSync, {
      batchId: `${editor.id}:e-2`,
      entries: [
        put('cues', id, cueRow({ label: 'Changed', minor: 50, department_id: depts.SND.id })),
      ],
    })
    expect(r).toEqual({ applied: 1, rejected: [] })
    expect(await rowCount(id)).toBe(1)
    const logs = await logRows(id)
    expect(logs.map((l) => l.op)).toEqual(['insert', 'update'])
    expect(logs[1].before).toEqual({ departmentId: depts.LX.id, label: 'Lights up', minor: 0 })
    expect(logs[1].after).toEqual({ departmentId: depts.SND.id, label: 'Changed', minor: 50 })
    // Identical values: applied, and no log row (R33).
    expect(
      await applyCrudBatch(db, editorSync, {
        batchId: `${editor.id}:e-3`,
        entries: [
          put('cues', id, cueRow({ label: 'Changed', minor: 50, department_id: depts.SND.id })),
        ],
      }),
    ).toEqual({ applied: 1, rejected: [] })
    expect(await logRows(id)).toHaveLength(2)
  })

  test('PUT of an id from a show the user is not in is not_found; from another of their shows it is invalid', async () => {
    const { db, owner, outsider, editorSync, ownerSync, editor, cueRow, actors, show } =
      await setup()
    const id = newId()
    await applyCrudBatch(db, editorSync, {
      batchId: `${editor.id}:f-1`,
      entries: [put('cues', id, cueRow({ label: 'Mine' }))],
    })
    const outsiderSync: Actor = { userId: outsider.id, via: 'sync', agent: null }
    const hidden = await applyCrudBatch(db, outsiderSync, {
      batchId: `${outsider.id}:f-2`,
      entries: [put('cues', id, cueRow({ label: 'Theirs' }))],
    })
    expect(hidden.rejected.map((r) => r.reason)).toEqual(['not_found'])

    const [org] = await listOrganisations(db, actors.owner)
    const other = await createShow(db, actors.owner, { organisationId: org.id, title: 'Other' })
    const moved = await applyCrudBatch(db, ownerSync, {
      batchId: `${owner.id}:f-3`,
      entries: [put('cues', id, cueRow({ show_id: other.id, label: 'Moved' }))],
    })
    expect(moved.rejected.map((r) => [r.reason, r.message])).toEqual([
      ['invalid', 'id belongs to another show'],
    ])
    const cue = await getCue(db, actors.owner, { cueId: id })
    expect({ showId: cue.showId, label: cue.label }).toEqual({ showId: show.id, label: 'Mine' })
  })

  test('PUT without show_id, or with a non-UUID id, is invalid', async () => {
    const { db, editor, editorSync, cueRow, rowCount } = await setup()
    const id = newId()
    const { show_id: _, ...noShow } = cueRow()
    const r = await applyCrudBatch(db, editorSync, {
      batchId: `${editor.id}:g-1`,
      entries: [
        put('cues', id, noShow),
        put('cues', 'not-a-uuid', cueRow()),
        put('cues', newId(), cueRow({ department_id: undefined })),
        { table: 'cues', id: newId(), op: 'PUT' },
      ],
    })
    expect(r.applied).toBe(0)
    expect(r.rejected.map((x) => x.reason)).toEqual(['invalid', 'invalid', 'invalid', 'invalid'])
    expect(await rowCount(id)).toBe(0)
  })

  test('PUT then PATCH then DELETE of one id in one batch apply in order', async () => {
    const { db, editor, editorSync, cueRow, rowCount, logRows } = await setup()
    const id = newId()
    const batchId = `${editor.id}:h-1`
    const r = await applyCrudBatch(db, editorSync, {
      batchId,
      entries: [
        put('cues', id, cueRow()),
        patch('cues', id, { label: 'Renamed', show_id: 'ignored', payload: '{}' }),
        del('cues', id),
      ],
    })
    expect(r).toEqual({ applied: 3, rejected: [] })
    expect(await rowCount(id)).toBe(0)
    const logs = await logRows(id)
    expect(logs.map((l) => [l.op, l.batchId])).toEqual([
      ['insert', batchId],
      ['update', batchId],
      ['delete', batchId],
    ])
    expect(logs[1].after).toEqual({ label: 'Renamed' })
    expect(logs[2].before).toMatchObject({ label: 'Renamed' })
  })

  test('DELETE of a missing row is applied with no log row; DELETE of a cue logs every field as before', async () => {
    const { db, editor, editorSync, cueRow, logRows, depts } = await setup()
    const missing = newId()
    expect(
      await applyCrudBatch(db, editorSync, {
        batchId: `${editor.id}:i-1`,
        entries: [del('cues', missing)],
      }),
    ).toEqual({ applied: 1, rejected: [] })
    expect(await logRows(missing)).toHaveLength(0)

    const id = newId()
    await applyCrudBatch(db, editorSync, {
      batchId: `${editor.id}:i-2`,
      entries: [put('cues', id, cueRow({ label: 'Doomed' }))],
    })
    expect(
      await applyCrudBatch(db, editorSync, {
        batchId: `${editor.id}:i-3`,
        entries: [del('cues', id)],
      }),
    ).toEqual({ applied: 1, rejected: [] })
    const last = (await logRows(id)).at(-1)
    expect(last).toMatchObject({
      op: 'delete',
      via: 'sync',
      after: null,
      layer: `department:${depts.LX.id}`,
    })
    expect(Object.keys(last?.before ?? {}).sort()).toEqual(FIELD_KEYS)
    expect(last?.before).toMatchObject({ label: 'Doomed' })
  })

  test('the LX editor cannot DELETE an SND cue; a viewer cannot PUT or PATCH', async () => {
    const {
      db,
      editor,
      editorLx,
      viewer,
      editorSync,
      editorLxSync,
      cueRow,
      rowCount,
      depts,
      actors,
    } = await setup()
    const id = newId()
    await applyCrudBatch(db, editorSync, {
      batchId: `${editor.id}:j-1`,
      entries: [put('cues', id, cueRow({ department_id: depts.SND.id }))],
    })
    const lx = await applyCrudBatch(db, editorLxSync, {
      batchId: `${editorLx.id}:j-2`,
      entries: [del('cues', id), patch('cues', id, { label: 'x' })],
    })
    expect(lx.rejected.map((r) => r.reason)).toEqual(['forbidden', 'forbidden'])
    const v = await applyCrudBatch(db, viaSync(actors.viewer), {
      batchId: `${viewer.id}:j-3`,
      entries: [put('cues', newId(), cueRow()), put('cues', id, cueRow())],
    })
    expect(v.rejected.map((r) => r.reason)).toEqual(['forbidden', 'forbidden'])
    expect(await rowCount(id)).toBe(1)
  })

  test('anchor text that is not JSON, minor 120, or NUL in the label is rejected invalid, never 503', async () => {
    const { db, editor, editorSync, cueRow, docId, versionId, logRows } = await setup()
    const ok = newId()
    const anchor = anchorAt(docId, versionId, 2)
    const r = await applyCrudBatch(db, editorSync, {
      batchId: `${editor.id}:k-1`,
      entries: [
        put('cues', newId(), cueRow({ anchor: '{not json' })),
        put('cues', newId(), cueRow({ minor: 120 })),
        put('cues', newId(), cueRow({ label: 'nul\u0000' })),
        put('cues', newId(), cueRow({ anchor: JSON.stringify({ ...anchor, x: -1 }) })),
        put('cues', newId(), cueRow({ anchor: '[1]' })),
        put('cues', newId(), cueRow({ major: '12' })),
        put('cues', newId(), cueRow({ type: 'cue' })),
        put('cues', newId(), cueRow({ colour: 'red' })),
        put('cues', newId(), cueRow({ notes: null })),
        { ...put('cues', newId(), cueRow()), clientTs: '1999-01-01T00:00:00Z' },
        patch('cues', newId(), { minor: 120 }),
        // Valid: the anchor as JSON text, as SQLite stores it.
        put('cues', ok, cueRow({ anchor: JSON.stringify(anchor) })),
      ],
    })
    expect(r.rejected.map((x) => [x.index, x.reason])).toEqual([
      [0, 'invalid'],
      [1, 'invalid'],
      [2, 'invalid'],
      [3, 'invalid'],
      [4, 'invalid'],
      [5, 'invalid'],
      [6, 'invalid'],
      [7, 'invalid'],
      [8, 'invalid'],
      [9, 'invalid'],
      [10, 'not_found'],
    ])
    expect(r.applied).toBe(1)
    const [row] = await db.select().from(cues).where(eq(cues.id, ok))
    expect(row.anchor).toEqual(anchor)
    expect(await logRows(ok)).toHaveLength(1)

    // An existing row: invalid patches are rejected, the row is unchanged.
    const p = await applyCrudBatch(db, editorSync, {
      batchId: `${editor.id}:k-2`,
      entries: [
        patch('cues', ok, { minor: 120 }),
        patch('cues', ok, { label: 'nul\u0000' }),
        patch('cues', ok, { anchor: 'nope' }),
        patch('cues', ok, { show_id: 'x' }),
        patch('cues', ok, { anchor: null, label: 'Unplaced' }),
      ],
    })
    expect(p.rejected.map((x) => x.reason)).toEqual(['invalid', 'invalid', 'invalid', 'invalid'])
    const [after] = await db.select().from(cues).where(eq(cues.id, ok))
    expect({ anchor: after.anchor, label: after.label, minor: after.minor }).toEqual({
      anchor: null,
      label: 'Unplaced',
      minor: 0,
    })
  })

  test('the LX editor PUTting an SND cue is forbidden; a service conflict becomes a conflict rejection', async () => {
    const { db, editorLx, editorLxSync, cueRow, depts } = await setup()
    const r = await applyCrudBatch(db, editorLxSync, {
      batchId: `${editorLx.id}:l-1`,
      entries: [put('cues', newId(), cueRow({ department_id: depts.SND.id }))],
    })
    expect(r.rejected.map((x) => x.reason)).toEqual(['forbidden'])

    vi.spyOn(SYNC_TABLES.cues, 'put').mockRejectedValueOnce(conflict('cue is being renumbered'))
    const id = newId()
    const c = await applyCrudBatch(db, editorLxSync, {
      batchId: `${editorLx.id}:l-2`,
      entries: [put('cues', id, cueRow()), put('cues', newId(), cueRow())],
    })
    expect(c.applied).toBe(1)
    expect(c.rejected).toEqual([
      { index: 0, table: 'cues', id, reason: 'conflict', message: 'cue is being renumbered' },
    ])
  })
})

describe('fix round 1', () => {
  test("a re-PUT whose clientTs is a day ahead (a skewed clock) still skips a collaborator's edit", async () => {
    const { db, actors, editor, owner, editorSync, ownerSync, cueRow, logRows } = await setup()
    const id = newId()
    await applyCrudBatch(db, editorSync, {
      batchId: `${editor.id}:skew-1`,
      entries: [put('cues', id, cueRow({ label: 'A' }), new Date().toISOString())],
    })
    await applyCrudBatch(db, ownerSync, {
      batchId: `${owner.id}:skew-2`,
      entries: [patch('cues', id, { label: 'B' })],
    })
    const ahead = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    expect(
      await applyCrudBatch(db, editorSync, {
        batchId: `${editor.id}:skew-3`,
        entries: [put('cues', id, cueRow({ label: 'A' }), ahead)],
      }),
    ).toEqual({ applied: 1, rejected: [] })
    expect((await getCue(db, actors.owner, { cueId: id })).label).toBe('B')
    expect((await logRows(id)).map((l) => l.op)).toEqual(['insert', 'update'])
  })

  test('DELETE of a row the actor cannot see is applied like a missing one: nothing deleted, nothing logged', async () => {
    const { db, editor, outsider, editorSync, cueRow, rowCount, logRows } = await setup()
    const id = newId()
    await applyCrudBatch(db, editorSync, {
      batchId: `${editor.id}:hide-1`,
      entries: [put('cues', id, cueRow())],
    })
    const outsiderSync: Actor = { userId: outsider.id, via: 'sync', agent: null }
    const missing = newId()
    const r = await applyCrudBatch(db, outsiderSync, {
      batchId: `${outsider.id}:hide-2`,
      entries: [del('cues', id), del('cues', missing)],
    })
    // Indistinguishable: an existing row in a show the outsider is not in answers like a missing id.
    expect(r).toEqual({ applied: 2, rejected: [] })
    expect(await rowCount(id)).toBe(1)
    expect((await logRows(id)).map((l) => l.op)).toEqual(['insert'])
  })

  test('DELETE of a row the actor can see but not edit is still forbidden', async () => {
    const { db, editor, editorLx, editorSync, editorLxSync, cueRow, rowCount, depts } =
      await setup()
    const id = newId()
    await applyCrudBatch(db, editorSync, {
      batchId: `${editor.id}:see-1`,
      entries: [put('cues', id, cueRow({ department_id: depts.SND.id }))],
    })
    const r = await applyCrudBatch(db, editorLxSync, {
      batchId: `${editorLx.id}:see-2`,
      entries: [del('cues', id)],
    })
    expect(r.rejected.map((x) => x.reason)).toEqual(['forbidden'])
    expect(await rowCount(id)).toBe(1)
  })

  test("rowPolicy hides another user's personal-layer row from DELETE; the actor's own personal row is deleted", async () => {
    const { db, actors, owner, editor, show } = await setup()
    const removed: string[] = []
    const rows: Record<string, { showId: string; layer: { kind: 'personal'; id: string } }> = {
      theirs: { showId: show.id, layer: { kind: 'personal', id: owner.id } },
      mine: { showId: show.id, layer: { kind: 'personal', id: editor.id } },
    }
    const policy = rowPolicy({
      table: 'notes',
      ops: ['DELETE'],
      shape: { text: z.string() },
      load: async (_db, id) => rows[id] ?? null,
      create: async () => {},
      update: async () => {},
      remove: async (_db, _actor, id) => {
        removed.push(id)
      },
    })
    const editorSync = viaSync(actors.editor)
    await policy.remove?.(db, editorSync, { id: 'theirs', batchId: 'x' })
    await policy.remove?.(db, editorSync, { id: 'gone', batchId: 'x' })
    await policy.remove?.(db, editorSync, { id: 'mine', batchId: 'x' })
    expect(removed).toEqual(['mine'])
  })
})

describe('chunks', () => {
  test('a chunk key seen before with different entries is not a replay: it applies and records the new digest', async () => {
    const { db, actors, editor, editorSync, cueRow, rowCount } = await setup()
    const [x, y] = [newId(), newId()]
    const batchId = `${editor.id}:rechunk`
    expect(
      await applyCrudBatch(db, editorSync, {
        batchId,
        chunk: { index: 0, count: 2 },
        entries: [put('cues', x, cueRow({ label: 'X' }))],
      }),
    ).toEqual({ applied: 1, rejected: [] })
    // The same transaction retried under new chunk boundaries: chunk 0 now carries x and y.
    const rechunked = {
      batchId,
      chunk: { index: 0, count: 1 },
      entries: [put('cues', x, cueRow({ label: 'X' })), put('cues', y, cueRow({ label: 'Y' }))],
    }
    expect(await applyCrudBatch(db, editorSync, rechunked)).toEqual({ applied: 2, rejected: [] })
    expect(await rowCount(y)).toBe(1)
    expect((await getCue(db, actors.owner, { cueId: y })).label).toBe('Y')
    // That content is now what the key remembers: sending it again is a replay.
    expect(await applyCrudBatch(db, editorSync, rechunked)).toEqual({
      applied: 0,
      rejected: [],
      replay: true,
    })
  })

  test('the digest ignores key order inside entries, so an identical retry is still a replay', async () => {
    const { db, editor, editorSync, cueRow } = await setup()
    const id = newId()
    const batchId = `${editor.id}:order`
    const data = cueRow()
    const reversed = Object.fromEntries(Object.entries(data).reverse())
    await applyCrudBatch(db, editorSync, { batchId, entries: [put('cues', id, data)] })
    expect(
      await applyCrudBatch(db, editorSync, { batchId, entries: [put('cues', id, reversed)] }),
    ).toEqual({ applied: 0, rejected: [], replay: true })
  })
  test("a replayed chunk is applied once: a collaborator's PATCH between the first apply and the retry survives", async () => {
    const { db, actors, editor, owner, editorSync, ownerSync, cueRow, logRows } = await setup()
    const [x, y] = [newId(), newId()]
    const batchId = `${editor.id}:dev-9`
    const chunk0 = {
      batchId,
      chunk: { index: 0, count: 2 },
      entries: [put('cues', x, cueRow({ label: 'A' })), patch('cues', x, { label: 'A2' })],
    }
    const chunk1 = {
      batchId,
      chunk: { index: 1, count: 2 },
      entries: [put('cues', y, cueRow({ label: 'Y' }))],
    }
    expect(await applyCrudBatch(db, editorSync, chunk0)).toEqual({ applied: 2, rejected: [] })
    // The second chunk fails transiently (the client sees a 503 and will retry the whole batch).
    vi.spyOn(SYNC_TABLES.cues, 'put').mockRejectedValueOnce(new Error('connection lost'))
    await expect(applyCrudBatch(db, editorSync, chunk1)).rejects.toThrow('connection lost')

    await applyCrudBatch(db, ownerSync, {
      batchId: `${owner.id}:o-1`,
      entries: [patch('cues', x, { label: 'B' })],
    })

    // The retry: chunk 0 is a replay and changes nothing, chunk 1 applies now.
    expect(await applyCrudBatch(db, editorSync, chunk0)).toEqual({
      applied: 0,
      rejected: [],
      replay: true,
    })
    expect(await applyCrudBatch(db, editorSync, chunk1)).toEqual({ applied: 1, rejected: [] })
    expect((await getCue(db, actors.owner, { cueId: x })).label).toBe('B')
    expect((await getCue(db, actors.owner, { cueId: y })).label).toBe('Y')
    const logs = await logRows(x)
    expect(logs.filter((l) => l.batchId === batchId).map((l) => l.op)).toEqual(['insert', 'update'])
    expect(await logRows(y)).toHaveLength(1)
  })

  test('a single-chunk request without chunk metadata is still deduplicated by batch id', async () => {
    const { db, editor, owner, editorSync, ownerSync, cueRow, rowCount, logRows } = await setup()
    const id = newId()
    const req = { batchId: `${editor.id}:solo`, entries: [put('cues', id, cueRow())] }
    expect(await applyCrudBatch(db, editorSync, req)).toEqual({ applied: 1, rejected: [] })
    // Absent chunk metadata is chunk 0 of 1.
    expect(await applyCrudBatch(db, editorSync, { ...req, chunk: { index: 0, count: 1 } })).toEqual(
      { applied: 0, rejected: [], replay: true },
    )
    expect(await applyCrudBatch(db, editorSync, req)).toEqual({
      applied: 0,
      rejected: [],
      replay: true,
    })
    expect(await rowCount(id)).toBe(1)
    expect(await logRows(id)).toHaveLength(1)
    // The key is the logged (user-scoped) batch id: another user's same client id is not a replay.
    expect(
      await applyCrudBatch(db, ownerSync, {
        batchId: `${owner.id}:solo`,
        entries: [patch('cues', id, { label: 'Owner' })],
      }),
    ).toEqual({ applied: 1, rejected: [] })
    const keys = await db
      .select()
      .from(syncAppliedChunks)
      .where(inArray(syncAppliedChunks.batchKey, [`${editor.id}:solo`, `${owner.id}:solo`]))
    expect(keys.map((k) => [k.batchKey, k.chunkIndex]).sort()).toEqual(
      [
        [`${editor.id}:solo`, 0],
        [`${owner.id}:solo`, 0],
      ].sort(),
    )
  })

  test('a batch that fails transiently leaves no chunk record, so its retry applies', async () => {
    const { db, editor, editorSync, cueRow, rowCount } = await setup()
    const id = newId()
    const req = { batchId: `${editor.id}:flaky`, entries: [put('cues', id, cueRow())] }
    vi.spyOn(SYNC_TABLES.cues, 'put').mockRejectedValueOnce(new Error('connection lost'))
    await expect(applyCrudBatch(db, editorSync, req)).rejects.toThrow('connection lost')
    expect(await applyCrudBatch(db, editorSync, req)).toEqual({ applied: 1, rejected: [] })
    expect(await rowCount(id)).toBe(1)
  })

  test('chunk records older than the cutoff are garbage-collected', async () => {
    const { db } = await setup()
    // Older than anything the other tests in this file record (they are stamped now()).
    await db.insert(syncAppliedChunks).values([
      { batchKey: 'u:old', chunkIndex: 0, appliedAt: new Date('2001-10-01T00:00:00Z') },
      { batchKey: 'u:old', chunkIndex: 1, appliedAt: new Date('2001-10-02T00:00:00Z') },
      { batchKey: 'u:new', chunkIndex: 0, appliedAt: new Date('2001-10-14T00:00:00Z') },
    ])
    expect(await deleteAppliedChunksBefore(db, new Date('2001-10-08T00:00:00Z'))).toBe(2)
    const left = await db
      .select()
      .from(syncAppliedChunks)
      .where(inArray(syncAppliedChunks.batchKey, ['u:old', 'u:new']))
    expect(left.map((r) => r.batchKey)).toEqual(['u:new'])
  })
})

describe('POST /api/sync/upload', () => {
  const post = (cookie: string, body: unknown) => ({
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: APP_ORIGIN, cookie },
    body: JSON.stringify(body),
  })

  test('HTTP: two users sending the same client batch id are logged under different batch ids; a batch id with ":" is 400', async () => {
    const { app, owner, editor, cueRow, logRows } = await setup()
    const [a, b] = [newId(), newId()]
    for (const [user, id] of [
      [owner, a],
      [editor, b],
    ] as const) {
      const res = await app.request(
        '/api/sync/upload',
        post(user.cookie, { batchId: 'dev-1', entries: [put('cues', id, cueRow())] }),
      )
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ applied: 1, rejected: [] })
    }
    expect((await logRows(a)).map((l) => l.batchId)).toEqual([`${owner.id}:dev-1`])
    expect((await logRows(b)).map((l) => l.batchId)).toEqual([`${editor.id}:dev-1`])

    const res = await app.request(
      '/api/sync/upload',
      post(owner.cookie, {
        batchId: `${owner.id}:dev-2`,
        entries: [put('cues', newId(), cueRow())],
      }),
    )
    expect(res.status).toBe(400)
  })

  test('HTTP: a replayed chunk answers 200 with replay: true; malformed chunk metadata is 400', async () => {
    const { app, owner, cueRow, rowCount } = await setup()
    const id = newId()
    const body = {
      batchId: 'dev-3',
      chunk: { index: 0, count: 2 },
      entries: [put('cues', id, cueRow())],
    }
    expect(await (await app.request('/api/sync/upload', post(owner.cookie, body))).json()).toEqual({
      applied: 1,
      rejected: [],
    })
    const again = await app.request('/api/sync/upload', post(owner.cookie, body))
    expect(again.status).toBe(200)
    expect(await again.json()).toEqual({ applied: 0, rejected: [], replay: true })
    expect(await rowCount(id)).toBe(1)

    for (const chunk of [
      { index: 2, count: 2 },
      { index: -1, count: 2 },
      { index: 0.5, count: 2 },
      { index: 0, count: 0 },
      { index: 0 },
      'first',
    ]) {
      const res = await app.request('/api/sync/upload', post(owner.cookie, { ...body, chunk }))
      expect(res.status, JSON.stringify(chunk)).toBe(400)
    }
  })
})

describe('annotations', () => {
  const highlight = (s: Awaited<ReturnType<typeof setup>>, over: Record<string, unknown> = {}) =>
    s.annRow({
      layer_kind: 'personal',
      layer_id: s.viewer.id,
      type: 'highlight',
      text: '',
      anchor: JSON.stringify({
        ...anchorAt(s.docId, s.versionId, 3),
        text: { quote: 'to be or', wordStart: 4, wordEnd: 6 },
      }),
      ...over,
    })

  test("a viewer PUTs a personal highlight; another member's DELETE, PATCH and re-PUT of it answer like a missing row", async () => {
    const s = await setup()
    const { db, viewer, viewerSync, ownerSync, editorSync, owner, annRows, logRows } = s
    const id = newId()
    expect(
      await applyCrudBatch(db, viewerSync, {
        batchId: `${viewer.id}:hl-1`,
        entries: [put('annotations', id, highlight(s), '2026-10-15T10:00:00Z')],
      }),
    ).toEqual({ applied: 1, rejected: [] })
    const [row] = await annRows(id)
    expect(row).toMatchObject({
      showId: s.show.id,
      layerKind: 'personal',
      layerId: viewer.id,
      type: 'highlight',
      geometry: {},
      style: {},
      updatedBy: viewer.id,
    })
    expect(row.anchor.text).toEqual({ quote: 'to be or', wordStart: 4, wordEnd: 6 })
    const [created] = await logRows(id)
    expect(created).toMatchObject({
      op: 'insert',
      tableName: 'annotations',
      via: 'sync',
      layer: `personal:${viewer.id}`,
    })

    // Owner and editor: DELETE is applied like a missing row's (nothing happens); PATCH and a
    // re-PUT of the id are not_found, exactly as for an id that does not exist.
    const missing = newId()
    for (const [who, user] of [
      [ownerSync, owner],
      [editorSync, s.editor],
    ] as const) {
      const r = await applyCrudBatch(db, who, {
        batchId: `${user.id}:hl-2`,
        entries: [
          del('annotations', id),
          del('annotations', missing),
          patch('annotations', id, { text: 'stolen' }),
          patch('annotations', missing, { text: 'stolen' }),
          put('annotations', id, highlight(s, { text: 'overwritten' })),
        ],
      })
      expect(r.applied).toBe(2)
      expect(r.rejected.map((x) => [x.index, x.reason])).toEqual([
        [2, 'not_found'],
        [3, 'not_found'],
        [4, 'not_found'],
      ])
    }
    expect((await annRows(id))[0]).toMatchObject({ text: '', layerId: viewer.id })
    expect(await logRows(id)).toHaveLength(1)

    // The owner of the layer deletes it.
    expect(
      await applyCrudBatch(db, viewerSync, {
        batchId: `${viewer.id}:hl-3`,
        entries: [del('annotations', id)],
      }),
    ).toEqual({ applied: 1, rejected: [] })
    expect(await annRows(id)).toHaveLength(0)
    expect((await logRows(id)).map((l) => l.op)).toEqual(['insert', 'delete'])
  })

  test('a PUT of an unbound unresolved highlight (a personal undo re-insert) applies; an unbound approximate one is invalid', async () => {
    const s = await setup()
    const { db, viewer, viewerSync, annRows } = s
    const unbound = (status: string) =>
      highlight(s, {
        anchor: JSON.stringify({
          ...anchorAt(s.docId, s.versionId, 3),
          status,
          text: { quote: 'to be or', wordStart: -1, wordEnd: -1 },
        }),
      })
    const ok = newId()
    const bad = newId()
    const r = await applyCrudBatch(db, viewerSync, {
      batchId: `${viewer.id}:undo-1`,
      entries: [
        put('annotations', ok, unbound('unresolved')),
        put('annotations', bad, unbound('approximate')),
      ],
    })
    expect(r.applied).toBe(1)
    expect(r.rejected.map((x) => [x.index, x.reason])).toEqual([[1, 'invalid']])
    expect((await annRows(ok))[0].anchor).toMatchObject({
      status: 'unresolved',
      text: { wordStart: -1, wordEnd: -1 },
    })
    expect(await annRows(bad)).toHaveLength(0)
  })

  test('a PATCH or re-PUT that moves a department annotation onto the personal layer is rejected invalid and the row is unchanged', async () => {
    const s = await setup()
    const { db, editorLx, editorLxSync, annRow, annRows, logRows } = s
    const id = newId()
    expect(
      await applyCrudBatch(db, editorLxSync, {
        batchId: `${editorLx.id}:mv-1`,
        entries: [put('annotations', id, annRow())],
      }),
    ).toEqual({ applied: 1, rejected: [] })
    const logs = (await logRows(id)).length
    const r = await applyCrudBatch(db, editorLxSync, {
      batchId: `${editorLx.id}:mv-2`,
      entries: [
        patch('annotations', id, { layer_kind: 'personal', layer_id: editorLx.id }),
        put('annotations', id, annRow({ layer_kind: 'personal', layer_id: editorLx.id })),
      ],
    })
    expect(r.applied).toBe(0)
    expect(r.rejected.map((x) => [x.index, x.reason])).toEqual([
      [0, 'invalid'],
      [1, 'invalid'],
    ])
    expect((await annRows(id))[0]).toMatchObject({
      layerKind: 'department',
      layerId: s.depts.LX.id,
    })
    expect(await logRows(id)).toHaveLength(logs)
  })

  test("a viewer cannot PUT onto another user's personal layer or a department layer", async () => {
    const s = await setup()
    const { db, viewer, viewerSync, annRow, annRows } = s
    const a = newId()
    const b = newId()
    const r = await applyCrudBatch(db, viewerSync, {
      batchId: `${viewer.id}:hl-4`,
      entries: [
        put('annotations', a, annRow({ layer_kind: 'personal', layer_id: s.owner.id })),
        put('annotations', b, annRow()),
      ],
    })
    expect(r.rejected.map((x) => [x.index, x.reason])).toEqual([
      [0, 'forbidden'],
      [1, 'forbidden'],
    ])
    expect(await annRows(a)).toHaveLength(0)
    expect(await annRows(b)).toHaveLength(0)
  })

  test('the LX editor PUTs on LX but not SND; a PATCH moving it to SND is forbidden', async () => {
    const s = await setup()
    const { db, editorLx, editorLxSync, annRow, annRows, depts } = s
    const ok = newId()
    const denied = newId()
    const r = await applyCrudBatch(db, editorLxSync, {
      batchId: `${editorLx.id}:lx-1`,
      entries: [
        put('annotations', ok, annRow()),
        put('annotations', denied, annRow({ layer_id: depts.SND.id })),
        patch('annotations', ok, { layer_id: depts.SND.id }),
        patch('annotations', ok, { text: 'edited' }),
      ],
    })
    expect(r.rejected.map((x) => [x.index, x.reason])).toEqual([
      [1, 'forbidden'],
      [2, 'forbidden'],
    ])
    expect(await annRows(denied)).toHaveLength(0)
    expect((await annRows(ok))[0]).toMatchObject({ layerId: depts.LX.id, text: 'edited' })
  })

  test('geometry as JSON text is parsed; geometry that is not an object is invalid', async () => {
    const s = await setup()
    const { db, editorLx, editorLxSync, annRow, annRows, logRows } = s
    const ok = newId()
    const r = await applyCrudBatch(db, editorLxSync, {
      batchId: `${editorLx.id}:geo-1`,
      entries: [
        put('annotations', ok, annRow({ type: 'rect', text: '', geometry: '{"w":30,"h":12}' })),
        put('annotations', newId(), annRow({ type: 'rect', text: '', geometry: '[30,12]' })),
        put('annotations', newId(), annRow({ type: 'rect', text: '', geometry: '"30x12"' })),
        put('annotations', newId(), annRow({ type: 'rect', text: '', geometry: '{bad' })),
        put('annotations', newId(), annRow({ type: 'rect', text: '', geometry: 12 })),
        put('annotations', newId(), annRow({ type: 'rect', text: '', geometry: '{"w":0,"h":3}' })),
        put(
          'annotations',
          newId(),
          annRow({ type: 'rect', text: '', geometry: '{"w":"3","h":3}' }),
        ),
        put('annotations', newId(), annRow({ style: '{"colour":"red"}' })),
        put('annotations', newId(), annRow({ anchor: '{not json' })),
        put('annotations', newId(), annRow({ text: 'nul\u0000' })),
        put('annotations', newId(), annRow({ type: 'laser' })),
        put('annotations', newId(), annRow({ type: 'highlight', text: '' })),
      ],
    })
    expect(r.rejected.map((x) => [x.index, x.reason])).toEqual(
      Array.from({ length: 11 }, (_, i) => [i + 1, 'invalid']),
    )
    expect(r.applied).toBe(1)
    expect((await annRows(ok))[0].geometry).toEqual({ w: 30, h: 12 })
    expect((await logRows(ok))[0].after).toMatchObject({ geometry: { w: 30, h: 12 } })

    // PATCH: JSON text is parsed, an invalid geometry is refused and leaves the row alone.
    const p = await applyCrudBatch(db, editorLxSync, {
      batchId: `${editorLx.id}:geo-2`,
      entries: [
        patch('annotations', ok, { geometry: '{"w":0,"h":3}' }),
        patch('annotations', ok, { geometry: '[1]' }),
        patch('annotations', ok, { geometry: '{"h":8,"w":99}', style: '{"strokeWidth":3}' }),
      ],
    })
    expect(p.rejected.map((x) => x.reason)).toEqual(['invalid', 'invalid'])
    expect((await annRows(ok))[0]).toMatchObject({
      geometry: { w: 99, h: 8 },
      style: { strokeWidth: 3 },
    })
  })

  test("a replayed PUT does not overwrite a collaborator's newer text", async () => {
    const s = await setup()
    const { db, editorLx, editorLxSync, ownerSync, annRow, annRows } = s
    const id = newId()
    const first = '2026-10-15T10:00:00Z'
    await applyCrudBatch(db, editorLxSync, {
      batchId: `${editorLx.id}:rp-1`,
      entries: [put('annotations', id, annRow({ text: 'first' }), first)],
    })
    await applyCrudBatch(db, ownerSync, {
      batchId: `${s.owner.id}:rp-2`,
      entries: [patch('annotations', id, { text: 'owner edit' })],
    })
    const r = await applyCrudBatch(db, editorLxSync, {
      batchId: `${editorLx.id}:rp-3`,
      entries: [put('annotations', id, annRow({ text: 'first', geometry: '{}' }), first)],
    })
    expect(r).toEqual({ applied: 1, rejected: [] })
    expect((await annRows(id))[0].text).toBe('owner edit')
  })

  test('PATCH of a cue or an annotation the actor cannot see answers exactly like a missing row', async () => {
    const s = await setup()
    const { db, editor, editorSync, outsider, cueRow, annRow, annRows, rowCount, logRows } = s
    const cueId = newId()
    const mine = newId()
    await applyCrudBatch(db, editorSync, {
      batchId: `${editor.id}:pv-1`,
      entries: [
        put('cues', cueId, cueRow({ label: 'secret' })),
        put('annotations', mine, annRow({ layer_kind: 'personal', layer_id: editor.id })),
      ],
    })
    const outsiderSync: Actor = { userId: outsider.id, via: 'sync', agent: null }
    const missing = newId()
    const results = await Promise.all(
      [
        [cueId, missing, 'cues'],
        [mine, missing, 'annotations'],
      ].flatMap(([seen, gone, table]) =>
        [seen, gone].map((id) =>
          applyCrudBatch(db, outsiderSync, {
            batchId: `${outsider.id}:pv-${id}`,
            entries: [patch(table, id, { [table === 'cues' ? 'label' : 'text']: 'x' })],
          }),
        ),
      ),
    )
    for (const r of results) {
      expect(r.applied).toBe(0)
      expect(r.rejected).toHaveLength(1)
      expect(r.rejected[0]).toMatchObject({ index: 0, reason: 'not_found' })
    }
    // The rejection message of an existing row equals a missing row's, apart from the table name.
    expect(results[0].rejected[0].message).toBe(results[1].rejected[0].message)
    expect(results[2].rejected[0].message).toBe(results[3].rejected[0].message)
    expect(await rowCount(cueId)).toBe(1)
    expect((await annRows(mine))[0].text).toBe('hello')
    expect((await logRows(cueId)).map((l) => l.op)).toEqual(['insert'])
  })

  test("PATCH of another user's personal annotation, even to take it over, is not_found", async () => {
    const s = await setup()
    const { db, viewer, viewerSync, ownerSync, annRow, annRows } = s
    const id = newId()
    await applyCrudBatch(db, viewerSync, {
      batchId: `${viewer.id}:pw-1`,
      entries: [put('annotations', id, annRow({ layer_kind: 'personal', layer_id: viewer.id }))],
    })
    const r = await applyCrudBatch(db, ownerSync, {
      batchId: `${s.owner.id}:pw-2`,
      entries: [patch('annotations', id, { layer_id: s.owner.id, text: 'mine now' })],
    })
    expect(r.rejected.map((x) => x.reason)).toEqual(['not_found'])
    expect((await annRows(id))[0]).toMatchObject({ layerId: viewer.id, text: 'hello' })
  })
})
