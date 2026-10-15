import type { Anchor, CueFields } from '@binder/shared'
import { afterAll, afterEach, expect, test } from 'vitest'
import { insertCue, type LocalEdit, MarkupError, subscribeLocalEdits } from '../markup/mutations'
import { realDb } from '../test/realDb'
import { previewRenumber, renumberLocally } from './renumberLocally'

const anchor = (documentId: string, pageIndex: number, y: number): Anchor => ({
  documentId,
  documentVersionId: `${documentId}-v`,
  pageIndex,
  x: 10,
  y,
  status: 'ok',
})
const fields = (label: string, major: number, anchorValue: Anchor | null): CueFields => ({
  departmentId: 'lx',
  major,
  minor: 0,
  label,
  type: 'go',
  notes: '',
  colour: null,
  anchor: anchorValue,
})
const owner = { showId: 's1', userId: 'u1', scope: { role: 'owner' as const, departments: ['*'] } }

let groups: LocalEdit[][] = []
const off = subscribeLocalEdits((edits) => groups.push(edits))
afterEach(() => {
  groups = []
})
afterAll(off)

async function seed() {
  const h = realDb()
  await insertCue(h.db, owner, fields('late', 5, anchor('d1', 1, 700)))
  await insertCue(h.db, owner, fields('first', 6, anchor('d1', 0, 700)))
  await insertCue(h.db, owner, fields('second', 5, anchor('d1', 0, 300)))
  await insertCue(h.db, owner, fields('free', 77, null))
  await insertCue(h.db, owner, fields('other doc', 88, anchor('d2', 0, 700)))
  await insertCue(h.db, owner, { ...fields('line check', 0, anchor('d1', 0, 790)), minor: 50 })
  groups = []
  return h
}

const numbers = (h: ReturnType<typeof realDb>) =>
  Object.fromEntries(
    h.all('SELECT label, major, minor FROM cues').map((r) => [r.label, `${r.major}.${r.minor}`]),
  )

test('renumbers the document in script order as one write and one edit group', async () => {
  const h = await seed()
  const result = await renumberLocally(h.db, owner, {
    departmentId: 'lx',
    documentId: 'd1',
    blockSize: 10,
  })
  expect(result.changes).toHaveLength(3)
  expect(numbers(h)).toEqual({
    first: '10.0',
    second: '11.0',
    late: '12.0',
    free: '77.0',
    'other doc': '88.0',
    'line check': '0.50',
  })
  expect(groups).toHaveLength(1)
  expect(groups[0]).toHaveLength(3)
  expect(groups[0]?.every((e) => e.op === 'update')).toBe(true)
})

test('a second run changes nothing and emits nothing', async () => {
  const h = await seed()
  const target = { departmentId: 'lx', documentId: 'd1', blockSize: 10 }
  await renumberLocally(h.db, owner, target)
  groups = []
  expect((await renumberLocally(h.db, owner, target)).changes).toEqual([])
  expect(groups).toEqual([])
})

test('an editor outside the department writes nothing', async () => {
  const h = await seed()
  const before = numbers(h)
  const snd = { ...owner, scope: { role: 'editor' as const, departments: ['snd'] } }
  await expect(
    renumberLocally(h.db, snd, { departmentId: 'lx', documentId: 'd1', blockSize: 10 }),
  ).rejects.toBeInstanceOf(MarkupError)
  expect(numbers(h)).toEqual(before)
  expect(groups).toEqual([])
})

test('the preview reports changed cues and no spills (M1 has no groups) without writing', async () => {
  const h = await seed()
  const rows = h.all('SELECT id, major, minor, anchor FROM cues') as Array<{
    id: string
    major: number
    minor: number
    anchor: string | null
  }>
  const preview = previewRenumber(rows, 'd1', 2)
  expect(preview.changes.length).toBe(3)
  expect(preview.flagged).toEqual([])
  expect(groups).toEqual([])
})

test('cues left on an older version are numbered after the current ones', async () => {
  const h = realDb()
  const onVersion = (versionId: string, pageIndex: number, y: number): Anchor => ({
    ...anchor('d1', pageIndex, y),
    documentVersionId: versionId,
  })
  await insertCue(h.db, owner, fields('old early', 5, onVersion('d1-v1', 0, 800)))
  await insertCue(h.db, owner, fields('new late', 6, onVersion('d1-v2', 3, 100)))
  await insertCue(h.db, owner, fields('old late', 7, onVersion('d1-v1', 2, 100)))
  await insertCue(h.db, owner, fields('new early', 8, onVersion('d1-v2', 1, 700)))
  h.exec(
    "INSERT INTO documents (id, show_id, kind, title, current_version_id) VALUES ('d1', 's1', 'libretto', 'L', 'd1-v2')",
  )
  await renumberLocally(h.db, owner, { departmentId: 'lx', documentId: 'd1', blockSize: 10 })
  expect(numbers(h)).toEqual({
    'new early': '10.0',
    'new late': '11.0',
    'old early': '12.0',
    'old late': '13.0',
  })
  const rows = h.all('SELECT id, major, minor, anchor FROM cues') as Array<{
    id: string
    major: number
    minor: number
    anchor: string | null
  }>
  expect(previewRenumber(rows, 'd1', 10, 'd1-v2').changes).toEqual([])
})
