import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { LocalEdit, MarkupTable } from '../markup/mutations'
import { type ApplyFns, UndoStack } from './undoStack'

type Row = Record<string, unknown>

function memory() {
  const store = new Map<string, Row>()
  const key = (t: MarkupTable, id: string) => `${t}:${id}`
  const transaction = vi.fn(async (fn: () => Promise<void>) => fn())
  const writes: string[] = []
  const apply: ApplyFns = {
    read: async (t, id) => {
      const r = store.get(key(t, id))
      return r ? { ...r } : null
    },
    insert: async (t, row) => {
      writes.push(`insert ${String(row.id)}`)
      store.set(key(t, String(row.id)), { ...row })
    },
    update: async (t, id, cols) => {
      writes.push(`update ${id}`)
      store.set(key(t, id), { ...store.get(key(t, id)), ...cols })
    },
    remove: async (t, id) => {
      writes.push(`remove ${id}`)
      store.delete(key(t, id))
    },
    transaction,
  }
  return {
    apply,
    transaction,
    writes,
    get: (id: string) => store.get(key('cues', id)) as Row,
    has: (id: string) => store.has(key('cues', id)),
    set: (id: string, row: Row) => store.set(key('cues', id), row),
  }
}

const id = 'c1'
const base = { id, label: 'A', notes: '', updated_at: 't0', updated_by: 'me' }
let m: ReturnType<typeof memory>
let stack: UndoStack
beforeEach(() => {
  m = memory()
  stack = new UndoStack(m.apply)
})

const insert = (row: Row): LocalEdit => ({
  table: 'cues',
  id: String(row.id),
  op: 'insert',
  before: null,
  after: row,
})

test('undo of an insert removes the row nobody changed', async () => {
  m.set(id, base)
  stack.record([insert(base)])
  expect(await stack.undo()).toEqual({ status: 'done' })
  expect(m.has(id)).toBe(false)
})

test('undo of an insert is blocked when someone else changed the row', async () => {
  m.set(id, { ...base, label: 'X' })
  stack.record([insert(base)])
  expect(await stack.undo()).toEqual({ status: 'blocked', reason: 'changed-by-someone-else' })
  expect(m.has(id)).toBe(true)
  expect(stack.canUndo).toBe(false)
})

test('undo of an insert whose row is gone is blocked row-gone', async () => {
  stack.record([insert(base)])
  expect(await stack.undo()).toEqual({ status: 'blocked', reason: 'row-gone' })
})

test('undo of an update restores only the columns still holding our value', async () => {
  m.set(id, { ...base, label: 'B', notes: 'theirs' })
  stack.record([
    {
      table: 'cues',
      id,
      op: 'update',
      before: { ...base, label: 'A' },
      after: { ...base, label: 'B' },
    },
  ])
  expect(await stack.undo()).toEqual({ status: 'done' })
  expect(m.get(id).label).toBe('A')
  expect(m.get(id).notes).toBe('theirs')
})

test('undo of an update whose column someone else changed is blocked and writes nothing', async () => {
  stack.record([{ table: 'cues', id, op: 'update', before: { label: 'A' }, after: { label: 'B' } }])
  m.set(id, { ...base, label: 'C' })
  expect(await stack.undo()).toEqual({ status: 'blocked', reason: 'changed-by-someone-else' })
  expect(m.get(id).label).toBe('C')
  expect(m.writes).toEqual([])
})

test('a re-spaced, re-ordered anchor after a sync round trip still counts as ours', async () => {
  m.set(id, { ...base, anchor: '{"y": 2, "x": 1, "pageIndex": 1}' })
  stack.record([
    {
      table: 'cues',
      id,
      op: 'update',
      before: { anchor: '{"pageIndex":0,"x":1,"y":2}' },
      after: { anchor: '{"pageIndex":1,"x":1,"y":2}' },
    },
  ])
  expect(await stack.undo()).toEqual({ status: 'done' })
  expect(m.get(id).anchor).toBe('{"pageIndex":0,"x":1,"y":2}')
})

test('undo of a delete re-inserts the row with the same id', async () => {
  stack.record([{ table: 'cues', id, op: 'delete', before: base, after: null }])
  expect(await stack.undo()).toEqual({ status: 'done' })
  expect(m.get(id)).toEqual(base)
})

test('undo of a delete is blocked when the id is present again', async () => {
  m.set(id, base)
  stack.record([{ table: 'cues', id, op: 'delete', before: base, after: null }])
  expect(await stack.undo()).toEqual({ status: 'blocked', reason: 'changed-by-someone-else' })
})

test('a group undoes all or nothing, in one transaction', async () => {
  const two = { ...base, id: 'c2' }
  m.set(id, { ...base, label: 'B' })
  m.set('c2', { ...two, label: 'moved by B' })
  stack.record([
    { table: 'cues', id, op: 'update', before: base, after: { ...base, label: 'B' } },
    { table: 'cues', id: 'c2', op: 'update', before: two, after: { ...two, label: 'ours' } },
  ])
  expect(await stack.undo()).toEqual({ status: 'blocked', reason: 'changed-by-someone-else' })
  expect(m.writes).toEqual([])
  expect(m.get(id).label).toBe('B')

  m.set('c2', { ...two, label: 'ours' })
  stack.record([
    { table: 'cues', id, op: 'update', before: base, after: { ...base, label: 'B' } },
    { table: 'cues', id: 'c2', op: 'update', before: two, after: { ...two, label: 'ours' } },
  ])
  expect(await stack.undo()).toEqual({ status: 'done' })
  expect(m.transaction).toHaveBeenCalledTimes(2)
  expect(m.writes).toEqual(['update c2', 'update c1'])
})

test('a 600-edit group undoes in one transaction', async () => {
  const edits: LocalEdit[] = []
  for (let i = 0; i < 600; i++) {
    const r = { ...base, id: `n${i}`, label: 'new' }
    m.set(r.id, r)
    edits.push({
      table: 'cues',
      id: r.id,
      op: 'update',
      before: { ...r, label: 'old' },
      after: r,
    })
  }
  stack.record(edits)
  expect(await stack.undo()).toEqual({ status: 'done' })
  expect(m.transaction).toHaveBeenCalledTimes(1)
  expect(m.writes).toHaveLength(600)
  expect(m.get('n599').label).toBe('old')
})

test('redo re-applies, and a new edit clears redo', async () => {
  m.set(id, { ...base, label: 'B' })
  const edit: LocalEdit = {
    table: 'cues',
    id,
    op: 'update',
    before: base,
    after: { ...base, label: 'B' },
  }
  stack.record([edit])
  await stack.undo()
  expect(m.get(id).label).toBe('A')
  expect(stack.canRedo).toBe(true)
  expect(await stack.redo()).toEqual({ status: 'done' })
  expect(m.get(id).label).toBe('B')
  expect(stack.canUndo).toBe(true)
  await stack.undo()
  stack.record([insert({ ...base, id: 'c9' })])
  expect(stack.canRedo).toBe(false)
  expect(await stack.redo()).toEqual({ status: 'empty' })
})

test('redo of a delete removes the row again, and redo of an insert re-inserts it', async () => {
  m.set(id, base)
  stack.record([insert(base)])
  await stack.undo()
  expect(m.has(id)).toBe(false)
  expect(await stack.redo()).toEqual({ status: 'done' })
  expect(m.get(id)).toEqual(base)
  expect(await stack.undo()).toEqual({ status: 'done' })
})

test('the stack keeps the last 100 entries', async () => {
  for (let i = 0; i < 105; i++) stack.record([insert({ ...base, id: `r${i}` })])
  let undone = 0
  for (let i = 0; i < 105; i++) {
    const r = await stack.undo()
    if (r.status === 'empty') break
    undone++
  }
  expect(undone).toBe(100)
})

test('empty stacks report empty', async () => {
  expect(await stack.undo()).toEqual({ status: 'empty' })
  expect(stack.canUndo).toBe(false)
})

describe('current edit rights (M1-R9)', () => {
  test('a group the user can no longer edit is blocked not-editable and writes nothing', async () => {
    const guarded = new UndoStack(m.apply, 100, (_t, row) =>
      row.department_id === 'lx' ? 'The LX layer is locked.' : null,
    )
    m.set(id, { ...base, department_id: 'lx' })
    guarded.record([insert({ ...base, department_id: 'lx' })])
    expect(await guarded.undo()).toEqual({ status: 'blocked', reason: 'not-editable' })
    expect(guarded.lastBlockedMessage).toBe('The LX layer is locked.')
    expect(m.has(id)).toBe(true)
    expect(m.writes).toEqual([])
    expect(guarded.canUndo).toBe(false)
  })

  test('a re-insert is checked against the before row', async () => {
    const guarded = new UndoStack(m.apply, 100, (_t, row) =>
      row.department_id === 'lx' ? 'nope' : null,
    )
    guarded.record([
      { table: 'cues', id, op: 'delete', before: { ...base, department_id: 'lx' }, after: null },
    ])
    expect(await guarded.undo()).toEqual({ status: 'blocked', reason: 'not-editable' })
    expect(m.has(id)).toBe(false)
  })
})
