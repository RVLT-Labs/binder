import type { Anchor, AnnotationFields } from '@binder/shared'
import { afterAll, afterEach, expect, test } from 'vitest'
import { realDb } from '../test/realDb'
import {
  deleteAnnotation,
  fromAnnotationRow,
  insertAnnotation,
  type LocalEdit,
  subscribeLocalEdits,
  toAnnotationRow,
  updateAnnotation,
} from './mutations'

const anchor: Anchor = {
  documentId: 'd',
  documentVersionId: 'v',
  pageIndex: 1,
  x: 100,
  y: 200,
  status: 'ok',
}
const rect: AnnotationFields = {
  layerKind: 'department',
  layerId: 'lx',
  anchor,
  type: 'rect',
  geometry: { w: 50, h: 40 },
  text: '',
  style: {},
}
const owner = { showId: 's1', userId: 'u1', scope: { role: 'owner' as const, departments: ['*'] } }
const lxEditor = { ...owner, scope: { role: 'editor' as const, departments: ['lx'] } }
const viewer = { ...owner, scope: { role: 'viewer' as const, departments: [] as string[] } }

let groups: LocalEdit[][] = []
const off = subscribeLocalEdits((edits) => groups.push(edits))
afterEach(() => {
  groups = []
})
afterAll(off)

test('toAnnotationRow and fromAnnotationRow round-trip, JSON columns as text', () => {
  const fields: AnnotationFields = { ...rect, style: { colour: '#FF0000', strokeWidth: 2 } }
  const row = toAnnotationRow(fields)
  expect(row).toMatchObject({ layer_kind: 'department', layer_id: 'lx', type: 'rect', text: '' })
  expect(JSON.parse(row.geometry as string)).toEqual({ w: 50, h: 40 })
  expect(fromAnnotationRow(row)).toEqual(fields)
  expect(fromAnnotationRow({ ...row, geometry: null, style: null })).toMatchObject({
    geometry: {},
    style: {},
  })
})

test('insert, update and delete run as real SQL against the client schema', async () => {
  const { db, all } = realDb()
  const id = await insertAnnotation(db, owner, rect)
  let rows = all('SELECT * FROM annotations')
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({
    id,
    show_id: 's1',
    layer_kind: 'department',
    layer_id: 'lx',
    type: 'rect',
    text: '',
    updated_by: 'u1',
  })
  expect(JSON.parse(rows[0]?.anchor as string)).toEqual(anchor)
  expect(JSON.parse(rows[0]?.geometry as string)).toEqual({ w: 50, h: 40 })
  expect(groups).toHaveLength(1)
  expect(groups[0]?.[0]).toMatchObject({ table: 'annotations', op: 'insert', id, before: null })
  expect(groups[0]?.[0]?.after).toEqual(rows[0])

  groups = []
  await updateAnnotation(db, { ...owner, userId: 'u2' }, id, {
    anchor: { ...anchor, x: 150 },
    geometry: { w: 80, h: 40 },
    style: { colour: '#00FF00' },
  })
  rows = all('SELECT * FROM annotations')
  expect(rows[0]).toMatchObject({ updated_by: 'u2', created_at: expect.any(String) })
  expect(JSON.parse(rows[0]?.anchor as string).x).toBe(150)
  expect(JSON.parse(rows[0]?.geometry as string)).toEqual({ w: 80, h: 40 })
  expect(JSON.parse(rows[0]?.style as string)).toEqual({ colour: '#00FF00' })
  expect(groups).toHaveLength(1)
  expect(groups[0]?.[0]).toMatchObject({ op: 'update', id })
  expect(JSON.parse(groups[0]?.[0]?.before?.geometry as string)).toEqual({ w: 50, h: 40 })
  expect(groups[0]?.[0]?.after).toEqual(rows[0])

  groups = []
  await deleteAnnotation(db, owner, id)
  expect(all('SELECT id FROM annotations')).toEqual([])
  expect(groups[0]?.[0]).toMatchObject({ op: 'delete', id, after: null })
  expect(groups[0]?.[0]?.before).toMatchObject({ id, type: 'rect' })

  groups = []
  await deleteAnnotation(db, owner, id)
  expect(groups).toEqual([])
})

test('an update that changes nothing writes nothing, whatever the JSON key order', async () => {
  const { db, all } = realDb()
  const id = await insertAnnotation(db, owner, {
    ...rect,
    style: { colour: '#112233', strokeWidth: 2 },
  })
  const before = all('SELECT * FROM annotations')
  groups = []
  await updateAnnotation(db, owner, id, {
    geometry: { h: 40, w: 50 },
    style: { strokeWidth: 2, colour: '#112233' },
    text: '',
  })
  expect(groups).toEqual([])
  expect(all('SELECT * FROM annotations')).toEqual(before)
})

test('a text column changing between JSON-looking strings is still written', async () => {
  const { db, all } = realDb()
  const id = await insertAnnotation(db, owner, {
    ...rect,
    type: 'note',
    geometry: {},
    text: '{"a":1}',
  })
  groups = []
  await updateAnnotation(db, owner, id, { text: '{ "a": 1 }' })
  expect(all('SELECT text FROM annotations')).toEqual([{ text: '{ "a": 1 }' }])
  expect(groups[0]?.[0]?.after?.text).toBe('{ "a": 1 }')
})

test('an editor writes only on their scoped departments and their own personal layer', async () => {
  const { db, all } = realDb()
  await expect(insertAnnotation(db, lxEditor, { ...rect, layerId: 'snd' })).rejects.toMatchObject({
    code: 'forbidden',
  })
  const lx = await insertAnnotation(db, lxEditor, rect)
  const mine = await insertAnnotation(db, lxEditor, {
    ...rect,
    layerKind: 'personal',
    layerId: 'u1',
  })
  await expect(
    insertAnnotation(db, lxEditor, { ...rect, layerKind: 'personal', layerId: 'someone-else' }),
  ).rejects.toMatchObject({ code: 'forbidden' })
  const sndId = await insertAnnotation(db, owner, { ...rect, layerId: 'snd' })
  const theirs = await insertAnnotation(
    db,
    { ...owner, userId: 'u9' },
    { ...rect, layerKind: 'personal', layerId: 'u9' },
  )
  groups = []
  const snapshot = all('SELECT * FROM annotations')
  // Another department's annotation, another user's personal one, and moves between layers.
  await expect(updateAnnotation(db, lxEditor, sndId, { text: 'x' })).rejects.toMatchObject({
    code: 'forbidden',
  })
  await expect(updateAnnotation(db, lxEditor, theirs, { text: 'x' })).rejects.toMatchObject({
    code: 'forbidden',
  })
  await expect(updateAnnotation(db, lxEditor, lx, { layerId: 'snd' })).rejects.toMatchObject({
    code: 'forbidden',
  })
  await expect(deleteAnnotation(db, lxEditor, sndId)).rejects.toMatchObject({ code: 'forbidden' })
  await expect(deleteAnnotation(db, lxEditor, theirs)).rejects.toMatchObject({ code: 'forbidden' })
  expect(all('SELECT * FROM annotations')).toEqual(snapshot)
  expect(groups).toEqual([])
  // Its own: moving to its personal layer and back is fine.
  await updateAnnotation(db, lxEditor, lx, { layerKind: 'personal', layerId: 'u1' })
  await updateAnnotation(db, lxEditor, mine, { text: 'mine' })
  await deleteAnnotation(db, lxEditor, mine)
  expect(all('SELECT layer_kind FROM annotations WHERE id = ?'.replace('?', `'${lx}'`))).toEqual([
    { layer_kind: 'personal' },
  ])
})

test('a viewer may write on their own personal layer only', async () => {
  const { db } = realDb()
  await expect(insertAnnotation(db, viewer, rect)).rejects.toMatchObject({ code: 'forbidden' })
  const id = await insertAnnotation(db, viewer, { ...rect, layerKind: 'personal', layerId: 'u1' })
  await updateAnnotation(db, viewer, id, { geometry: { w: 10, h: 10 } })
  await deleteAnnotation(db, viewer, id)
})

test('fields the shared schema rejects are refused before anything is written', async () => {
  const { db, all } = realDb()
  const bad: Array<[string, AnnotationFields]> = [
    ['geometry', { ...rect, geometry: { w: 0, h: 5 } }],
    ['geometry', { ...rect, type: 'arrow', geometry: { dx: 0, dy: 0 } }],
    ['text', { ...rect, type: 'note', geometry: {}, text: '   ' }],
    ['text', { ...rect, type: 'stamp', geometry: {}, text: 'x'.repeat(41) }],
    ['style', { ...rect, style: { strokeWidth: 40 } }],
    ['text', { ...rect, text: 'a\u0000b' }],
    [
      'wordStart',
      {
        ...rect,
        type: 'highlight',
        geometry: {},
        anchor: { ...anchor, text: { quote: 'q', wordStart: -1, wordEnd: -1 } },
      },
    ],
    ['anchor', { ...rect, type: 'highlight', geometry: {} }],
  ]
  for (const [path, fields] of bad) {
    const err = await insertAnnotation(db, owner, fields).catch((e) => e)
    expect(err, path).toMatchObject({ name: 'MarkupError', code: 'invalid' })
    expect(err.message, path).toContain(path)
  }
  expect(all('SELECT id FROM annotations')).toEqual([])

  const id = await insertAnnotation(db, owner, rect)
  groups = []
  await expect(
    updateAnnotation(db, owner, id, { geometry: { w: -1, h: 5 } }),
  ).rejects.toMatchObject({ code: 'invalid' })
  // The merged row is what is checked: a stamp needs text, so a rect cannot turn into one blank.
  await expect(updateAnnotation(db, owner, id, { type: 'stamp' })).rejects.toMatchObject({
    code: 'invalid',
  })
  expect(groups).toEqual([])
})

test('an unbound highlight (re-anchoring left it at -1) can still be moved and edited', async () => {
  const { db, all } = realDb()
  const bound: AnnotationFields = {
    ...rect,
    type: 'highlight',
    geometry: {},
    anchor: { ...anchor, text: { quote: 'to be or', wordStart: 3, wordEnd: 5 } },
  }
  const id = await insertAnnotation(db, owner, bound)
  // Re-anchoring wrote the unbound range directly.
  await updateAnnotation(db, owner, id, {
    anchor: {
      ...anchor,
      status: 'unresolved',
      text: { quote: 'to be or', wordStart: -1, wordEnd: -1 },
    },
  })
  await updateAnnotation(db, owner, id, { style: { colour: '#FF00FF' } })
  expect(JSON.parse(all('SELECT style FROM annotations')[0]?.style as string)).toEqual({
    colour: '#FF00FF',
  })
})

test('a missing annotation is left alone', async () => {
  const { db } = realDb()
  await updateAnnotation(db, owner, 'nope', { text: 'x' })
  await deleteAnnotation(db, owner, 'nope')
  expect(groups).toEqual([])
})
