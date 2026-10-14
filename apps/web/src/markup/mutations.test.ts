import type { Anchor, CueFields } from '@binder/shared'
import { beforeEach, expect, test } from 'vitest'
import {
  deleteCue,
  type EditSource,
  fromCueRow,
  insertCue,
  JSON_COLUMNS,
  type LocalEdit,
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
const ctx = { showId: 's1', userId: 'u1' }

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
