import type { Anchor, CueFields } from '@binder/shared'
import { beforeEach, expect, test, vi } from 'vitest'
import {
  deleteCue,
  type EditSource,
  fromCueRow,
  insertCue,
  JSON_COLUMNS,
  type LocalEdit,
  MarkupError,
  subscribeLocalEdits,
  toCueRow,
  updateCue,
  updateCues,
} from './mutations'

type Row = Record<string, unknown>

/** An in-memory stand-in for the local database: it understands the four statement shapes used. */
function fakeDb() {
  const rows = new Map<string, Row>()
  let transactions = 0
  const tx = {
    async execute(sql: string, params: unknown[] = []) {
      let m = /^INSERT INTO cues \(([^)]+)\) VALUES/.exec(sql)
      if (m) {
        const cols = (m[1] as string).split(',').map((c) => c.trim())
        const row: Row = {}
        cols.forEach((c, i) => {
          row[c] = params[i]
        })
        rows.set(row.id as string, row)
        return
      }
      m = /^UPDATE cues SET (.+) WHERE id = \?$/.exec(sql)
      if (m) {
        const cols = (m[1] as string).split(',').map((c) => c.trim().replace(/ = \?$/, ''))
        const row = rows.get(params[params.length - 1] as string)
        cols.forEach((c, i) => {
          if (row) row[c] = params[i]
        })
        return
      }
      if (/^DELETE FROM cues WHERE id = \?$/.test(sql)) {
        rows.delete(params[0] as string)
        return
      }
      throw new Error(`unexpected sql: ${sql}`)
    },
    async getOptional(sql: string, params: unknown[] = []) {
      if (!/^SELECT \* FROM cues WHERE id = \?$/.test(sql))
        throw new Error(`unexpected sql: ${sql}`)
      const row = rows.get(params[0] as string)
      return row ? { ...row } : null
    },
  }
  const db = {
    async writeTransaction<T>(fn: (t: typeof tx) => Promise<T>): Promise<T> {
      transactions++
      return fn(tx)
    },
  }
  return { db, rows, transactions: () => transactions }
}

const anchor: Anchor = {
  documentId: 'd1',
  documentVersionId: 'v1',
  pageIndex: 2,
  x: 100,
  y: 400,
  status: 'ok',
}
const fields: CueFields = {
  departmentId: 'lx',
  major: 10,
  minor: 50,
  label: 'Dim',
  type: 'go',
  notes: '',
  colour: null,
  anchor,
}
const ctx = { showId: 's1', userId: 'u1', scope: { role: 'owner' as const, departments: ['*'] } }

let seen: Array<{ edits: LocalEdit[]; source: EditSource }>
beforeEach(() => {
  seen = []
  const off = subscribeLocalEdits((edits, source) => seen.push({ edits, source }))
  return off
})

test('toCueRow and fromCueRow round-trip with the anchor as JSON text', () => {
  const row = toCueRow(fields)
  expect(row).toMatchObject({ department_id: 'lx', major: 10, minor: 50, label: 'Dim', type: 'go' })
  expect(typeof row.anchor).toBe('string')
  expect(JSON.parse(row.anchor as string)).toEqual(anchor)
  expect(fromCueRow(row)).toEqual(fields)
  expect(toCueRow({ ...fields, anchor: null }).anchor).toBeNull()
  expect(fromCueRow({ ...row, anchor: null }).anchor).toBeNull()
  expect(JSON_COLUMNS.cues).toEqual(['anchor', 'payload'])
})

test('insertCue writes snake_case columns, stamps the user and time, and emits an insert', async () => {
  const { db, rows } = fakeDb()
  const id = await insertCue(db as never, ctx, fields)
  const row = rows.get(id) as Row
  expect(row).toMatchObject({
    id,
    show_id: 's1',
    department_id: 'lx',
    major: 10,
    minor: 50,
    updated_by: 'u1',
    payload: '{}',
  })
  expect(row.created_at).toBe(row.updated_at)
  expect(Number.isNaN(Date.parse(row.updated_at as string))).toBe(false)
  expect(seen).toHaveLength(1)
  expect(seen[0]?.source).toBe('user')
  expect(seen[0]?.edits).toEqual([{ table: 'cues', id, op: 'insert', before: null, after: row }])
})

test('updateCue writes only the changed columns and emits before and after', async () => {
  const { db, rows } = fakeDb()
  const id = await insertCue(db as never, ctx, fields)
  seen.length = 0
  await updateCue(
    db as never,
    { ...ctx, userId: 'u2' },
    id,
    { label: 'Dim down', anchor: { ...anchor, y: 300 } },
    { source: 'undo' },
  )
  const row = rows.get(id) as Row
  expect(row).toMatchObject({ label: 'Dim down', updated_by: 'u2', major: 10 })
  expect(JSON.parse(row.anchor as string).y).toBe(300)
  const [group] = seen
  expect(group?.source).toBe('undo')
  const edit = group?.edits[0]
  expect(edit?.op).toBe('update')
  expect(edit?.before?.label).toBe('Dim')
  expect(edit?.after?.label).toBe('Dim down')
  expect(JSON.parse(edit?.before?.anchor as string).y).toBe(400)
})

test('an update that changes nothing writes nothing and emits nothing', async () => {
  const { db } = fakeDb()
  const id = await insertCue(db as never, ctx, fields)
  seen.length = 0
  await updateCue(db as never, ctx, id, { label: 'Dim', anchor: { ...anchor } })
  expect(seen).toEqual([])
})

test('updateCues emits one group with one edit per cue, in one transaction', async () => {
  const { db, transactions } = fakeDb()
  const a = await insertCue(db as never, ctx, fields)
  const b = await insertCue(db as never, ctx, { ...fields, major: 11 })
  seen.length = 0
  const before = transactions()
  await updateCues(db as never, ctx, [
    { id: a, patch: { minor: 0 } },
    { id: b, patch: { minor: 25 } },
  ])
  expect(transactions() - before).toBe(1)
  expect(seen).toHaveLength(1)
  expect(seen[0]?.edits.map((e) => [e.id, e.op, e.after?.minor])).toEqual([
    [a, 'update', 0],
    [b, 'update', 25],
  ])
})

test('deleteCue removes the row and emits the row it removed', async () => {
  const { db, rows } = fakeDb()
  const id = await insertCue(db as never, ctx, fields)
  const existing = { ...(rows.get(id) as Row) }
  seen.length = 0
  await deleteCue(db as never, ctx, id, { source: 'redo' })
  expect(rows.has(id)).toBe(false)
  expect(seen).toEqual([
    { edits: [{ table: 'cues', id, op: 'delete', before: existing, after: null }], source: 'redo' },
  ])
  await deleteCue(db as never, ctx, id)
  expect(seen).toHaveLength(1)
})

test('unsubscribing stops delivery', async () => {
  const { db } = fakeDb()
  const got: number[] = []
  const off = subscribeLocalEdits(() => got.push(1))
  await insertCue(db as never, ctx, fields)
  off()
  await insertCue(db as never, ctx, fields)
  expect(got).toEqual([1])
})

test('a throwing listener never fails a committed mutation, and later listeners still hear it', async () => {
  const { db, rows } = fakeDb()
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  const heard: number[] = []
  const offBad = subscribeLocalEdits(() => {
    throw new Error('listener bug')
  })
  const offGood = subscribeLocalEdits(() => heard.push(1))
  const id = await insertCue(db as never, ctx, fields)
  offBad()
  offGood()
  expect(rows.has(id)).toBe(true)
  expect(heard).toEqual([1])
  expect(errors).toHaveBeenCalled()
})

test('a text column changing between JSON-looking strings is still written', async () => {
  const { db, rows } = fakeDb()
  const id = await insertCue(db as never, ctx, { ...fields, label: '{"a":1}', notes: '[1,2]' })
  seen.length = 0
  await updateCue(db as never, ctx, id, { label: '{ "a": 1 }', notes: '[1, 2]' })
  expect(rows.get(id)).toMatchObject({ label: '{ "a": 1 }', notes: '[1, 2]' })
  expect(seen[0]?.edits[0]?.after?.label).toBe('{ "a": 1 }')
})

const lxOnly = { ...ctx, scope: { role: 'editor' as const, departments: ['lx'] } }
const snd = { ...fields, departmentId: 'snd' }

test('an LX-scoped context cannot insert, update, move or delete an SND cue', async () => {
  const { db, rows } = fakeDb()
  await expect(insertCue(db as never, lxOnly, snd)).rejects.toMatchObject({ code: 'forbidden' })
  expect(rows.size).toBe(0)
  const sndId = await insertCue(db as never, ctx, snd)
  const lxId = await insertCue(db as never, ctx, fields)
  seen.length = 0
  const snapshot = structuredClone([...rows.values()])
  await expect(updateCue(db as never, lxOnly, sndId, { label: 'x' })).rejects.toMatchObject({
    code: 'forbidden',
  })
  // moving an LX cue into SND is also refused, and so is moving an SND cue out
  await expect(updateCue(db as never, lxOnly, lxId, { departmentId: 'snd' })).rejects.toMatchObject(
    { code: 'forbidden' },
  )
  await expect(updateCue(db as never, lxOnly, sndId, { departmentId: 'lx' })).rejects.toMatchObject(
    { code: 'forbidden' },
  )
  await expect(deleteCue(db as never, lxOnly, sndId)).rejects.toMatchObject({ code: 'forbidden' })
  expect([...rows.values()]).toEqual(snapshot)
  expect(seen).toEqual([])
})

test('a batch with one forbidden cue writes none of them', async () => {
  const { db, rows } = fakeDb()
  const lxId = await insertCue(db as never, ctx, fields)
  const sndId = await insertCue(db as never, ctx, snd)
  seen.length = 0
  await expect(
    updateCues(db as never, lxOnly, [
      { id: lxId, patch: { label: 'changed' } },
      { id: sndId, patch: { label: 'changed' } },
    ]),
  ).rejects.toMatchObject({ code: 'forbidden' })
  expect(rows.get(lxId)?.label).toBe('Dim')
  expect(seen).toEqual([])
})

test('a scoped context may edit its own department', async () => {
  const { db, rows } = fakeDb()
  const id = await insertCue(db as never, lxOnly, fields)
  await updateCue(db as never, lxOnly, id, { label: 'mine' })
  expect(rows.get(id)?.label).toBe('mine')
  await deleteCue(db as never, lxOnly, id)
  expect(rows.has(id)).toBe(false)
})

test('invalid fields are refused before anything is written', async () => {
  const { db, rows } = fakeDb()
  await expect(insertCue(db as never, ctx, { ...fields, minor: 120 })).rejects.toMatchObject({
    code: 'invalid',
  })
  await expect(insertCue(db as never, ctx, { ...fields, label: 'a\u0000b' })).rejects.toMatchObject(
    { code: 'invalid' },
  )
  expect(rows.size).toBe(0)
  const id = await insertCue(db as never, ctx, fields)
  seen.length = 0
  await expect(updateCue(db as never, ctx, id, { minor: 120 })).rejects.toMatchObject({
    code: 'invalid',
  })
  await expect(updateCue(db as never, ctx, id, { label: 'a\u0000b' })).rejects.toMatchObject({
    code: 'invalid',
  })
  expect(rows.get(id)?.minor).toBe(50)
  expect(seen).toEqual([])
  const err = await insertCue(db as never, ctx, { ...fields, minor: 120 }).catch((e) => e)
  expect(err).toBeInstanceOf(MarkupError)
  expect(err.message).toMatch(/minor/)
})
