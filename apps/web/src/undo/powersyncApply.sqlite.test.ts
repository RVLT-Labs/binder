import type { Anchor, CueFields } from '@binder/shared'
import { afterAll, afterEach, expect, test } from 'vitest'
import {
  deleteCue,
  insertCue,
  type LocalEdit,
  subscribeLocalEdits,
  updateCue,
} from '../markup/mutations'
import { realDb } from '../test/realDb'
import { powersyncApply } from './powersyncApply'
import { UndoStack } from './undoStack'

const anchor: Anchor = {
  documentId: 'd',
  documentVersionId: 'v',
  pageIndex: 0,
  x: 10,
  y: 20,
  status: 'ok',
}
const fields: CueFields = {
  departmentId: 'lx',
  major: 10,
  minor: 0,
  label: 'Go',
  type: 'go',
  notes: '',
  colour: null,
  anchor,
}
const ctx = { showId: 's1', userId: 'u1', scope: { role: 'owner' as const, departments: ['*'] } }

let seen: Array<{ edits: LocalEdit[]; source: string }> = []
const off = subscribeLocalEdits((edits, source) => seen.push({ edits, source }))
afterEach(() => {
  seen = []
})
afterAll(off)

test('undo and redo run as real SQL, emit undo and redo edits, and restore a deleted row whole', async () => {
  const { db, all } = realDb()
  const stack = new UndoStack(powersyncApply(db, 'u1'))
  const userEdits: LocalEdit[][] = []
  const off2 = subscribeLocalEdits((edits, source) => {
    if (source === 'user') {
      userEdits.push(edits)
      stack.record(edits)
    }
  })

  const id = await insertCue(db, ctx, fields)
  await updateCue(db, ctx, id, { label: 'Sunrise', anchor: { ...anchor, pageIndex: 1 } })
  const { updated_at: _at, ...original } = all('SELECT * FROM cues')[0] ?? {}
  await deleteCue(db, ctx, id)
  expect(all('SELECT * FROM cues')).toHaveLength(0)

  seen = []
  expect(await stack.undo()).toEqual({ status: 'done' })
  const restored = all('SELECT * FROM cues')[0]
  expect(restored).toMatchObject({ ...original, updated_by: 'u1' })
  expect(seen.map((s) => [s.source, s.edits[0]?.op])).toEqual([['undo', 'insert']])

  expect(await stack.undo()).toEqual({ status: 'done' })
  expect(all('SELECT * FROM cues')[0]).toMatchObject({ label: 'Go' })
  expect(JSON.parse(String(all('SELECT * FROM cues')[0]?.anchor)).pageIndex).toBe(0)

  expect(await stack.redo()).toEqual({ status: 'done' })
  expect(all('SELECT * FROM cues')[0]).toMatchObject({ label: 'Sunrise' })
  expect(seen.map((s) => s.source)).toEqual(['undo', 'undo', 'redo'])
  // Only the three user edits were recorded; undo and redo writes never re-entered the stack.
  expect(userEdits).toHaveLength(3)
  expect(stack.canRedo).toBe(true)

  expect(await stack.undo()).toEqual({ status: 'done' })
  expect(await stack.undo()).toEqual({ status: 'done' })
  expect(all('SELECT * FROM cues')).toHaveLength(0)
  off2()
})

test('a blocked group writes nothing to the real database', async () => {
  const { db, all } = realDb()
  const stack = new UndoStack(powersyncApply(db, 'u1'))
  const off2 = subscribeLocalEdits((edits, source) => {
    if (source === 'user') stack.record(edits)
  })
  const id = await insertCue(db, ctx, fields)
  await updateCue(db, { ...ctx, userId: 'u2' }, id, { label: 'theirs' })
  stack.clear()
  stack.record([
    {
      table: 'cues',
      id,
      op: 'update',
      before: { label: 'Go' },
      after: { label: 'mine' },
    },
  ])
  expect(await stack.undo()).toEqual({ status: 'blocked', reason: 'changed-by-someone-else' })
  expect(all('SELECT * FROM cues')[0]).toMatchObject({ label: 'theirs' })
  off2()
})
