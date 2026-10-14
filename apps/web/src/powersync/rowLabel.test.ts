import { expect, test, vi } from 'vitest'
import { type LabelDb, rowLabel } from './rowLabel'

/** A local database that answers the label query with `row` (or nothing). */
const localDb = (row: Record<string, unknown> | null) => {
  const getOptional = vi.fn(async (_sql: string, _params?: unknown[]) => row)
  return { getOptional, db: { getOptional } as unknown as LabelDb }
}

test('labels a cue with its department code and display number', async () => {
  const lx = localDb({ major: 12, minor: 50, code: 'LX', number_format: 'decimal' })
  expect(await rowLabel(lx.db, 'cues', 'c1')).toBe('LX cue 12.5')
  expect(lx.getOptional.mock.calls[0][1]).toEqual(['c1'])
  const tm = localDb({ major: 0, minor: 50, code: 'TM', number_format: 'point' })
  expect(await rowLabel(tm.db, 'cues', 'c2')).toBe('TM cue 0.50')
  // A department this device has not synced: the number alone.
  const orphan = localDb({ major: 7, minor: 0, code: null, number_format: null })
  expect(await rowLabel(orphan.db, 'cues', 'c3')).toBe('cue 7')
})

test('falls back to the table noun for a row that is gone', async () => {
  expect(await rowLabel(localDb(null).db, 'cues', 'gone')).toBe('a cue')
  const broken = { getOptional: async () => Promise.reject(new Error('no such table')) }
  expect(await rowLabel(broken as unknown as LabelDb, 'cues', 'x')).toBe('a cue')
})

test('labels an annotation with its layer and type', async () => {
  const lx = localDb({ type: 'arrow', layer_kind: 'department', code: 'LX' })
  expect(await rowLabel(lx.db, 'annotations', 'a1')).toBe('LX arrow')
  expect(lx.getOptional.mock.calls[0][1]).toEqual(['a1'])
  const own = localDb({ type: 'highlight', layer_kind: 'personal', code: null })
  expect(await rowLabel(own.db, 'annotations', 'a2')).toBe('personal highlight')
  // A department this device has not synced: the type alone.
  const orphan = localDb({ type: 'note', layer_kind: 'department', code: null })
  expect(await rowLabel(orphan.db, 'annotations', 'a3')).toBe('note')
})

test('falls back to the annotation noun for a row that is gone', async () => {
  expect(await rowLabel(localDb(null).db, 'annotations', 'gone')).toBe('an annotation')
  const broken = { getOptional: async () => Promise.reject(new Error('no such table')) }
  expect(await rowLabel(broken as unknown as LabelDb, 'annotations', 'x')).toBe('an annotation')
})

test('other tables keep the M0 noun', async () => {
  const { db, getOptional } = localDb({ title: 'Pirates' })
  expect(await rowLabel(db, 'shows', 's1')).toBe('a show')
  expect(await rowLabel(db, 'documents', 'd1')).toBe('a document')
  expect(await rowLabel(db, 'pages', 'p1')).toBe('a pages row')
  expect(getOptional).not.toHaveBeenCalled()
})
