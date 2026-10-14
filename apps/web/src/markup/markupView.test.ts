import { expect, test } from 'vitest'
import { groupMarkup, stepCue } from './markupView'

const anchor = (pageIndex: number, y: number) =>
  JSON.stringify({ documentId: 'd', documentVersionId: 'v', pageIndex, x: 10, y, status: 'ok' })

const cueRow = (id: string, departmentId: string, pageIndex: number, y: number, extra = {}) => ({
  id,
  show_id: 's',
  department_id: departmentId,
  major: 10,
  minor: 0,
  label: '',
  anchor: anchor(pageIndex, y),
  type: 'go',
  notes: '',
  colour: null,
  payload: '{}',
  created_at: null,
  updated_at: null,
  updated_by: null,
  dept_code: departmentId.toUpperCase(),
  dept_colour: '#F5A623',
  dept_number_format: 'decimal',
  dept_hidden: 0,
  ...extra,
})

const annotationRow = (id: string, layer_kind: string, layer_id: string, pageIndex: number) => ({
  id,
  show_id: 's',
  layer_kind,
  layer_id,
  anchor: anchor(pageIndex, 100),
  type: 'note',
  geometry: '{}',
  text: 'x',
  style: '{}',
  created_at: null,
  updated_at: null,
  updated_by: null,
})

test('cues are grouped by page and ordered top to bottom, with anchors parsed', () => {
  const rows = [
    cueRow('low', 'lx', 0, 100),
    cueRow('p1', 'snd', 1, 700),
    cueRow('high', 'snd', 0, 700),
  ]
  const { cuesByPage, ordered } = groupMarkup(rows, [], new Set())
  expect([...cuesByPage.keys()].sort()).toEqual([0, 1])
  expect(cuesByPage.get(0)?.map((c) => c.id)).toEqual(['high', 'low'])
  expect(cuesByPage.get(1)?.map((c) => c.id)).toEqual(['p1'])
  expect(ordered.map((c) => c.id)).toEqual(['high', 'low', 'p1'])
  expect(cuesByPage.get(0)?.[0]?.anchor).toEqual({
    documentId: 'd',
    documentVersionId: 'v',
    pageIndex: 0,
    x: 10,
    y: 700,
    status: 'ok',
  })
})

test('hidden layers, hidden departments, and unreadable anchors are left out', () => {
  const rows = [
    cueRow('lx', 'lx', 0, 500),
    cueRow('snd', 'snd', 0, 400),
    cueRow('vid', 'vid', 0, 300, { dept_hidden: 1 }),
    cueRow('bad', 'snd', 0, 200, { anchor: 'not json' }),
    cueRow('none', 'snd', 0, 200, { anchor: null }),
  ]
  const { ordered } = groupMarkup(rows, [], new Set(['department:lx']))
  expect(ordered.map((c) => c.id)).toEqual(['snd'])
})

test('annotations are grouped by page and filtered by their layer', () => {
  const rows = [
    annotationRow('a1', 'department', 'lx', 0),
    annotationRow('a2', 'personal', 'u1', 0),
    annotationRow('a3', 'department', 'snd', 2),
  ]
  const { annotationsByPage } = groupMarkup([], rows, new Set(['department:snd']))
  expect(annotationsByPage.get(0)?.map((a) => a.id)).toEqual(['a1', 'a2'])
  expect(annotationsByPage.has(2)).toBe(false)
  expect(annotationsByPage.get(0)?.[1]?.anchor.pageIndex).toBe(0)
})

test('stepping walks cues in order and stops at either end', () => {
  const ids = ['a', 'b', 'c']
  expect(stepCue(ids, null, 1)).toBe('a')
  expect(stepCue(ids, null, -1)).toBe('c')
  expect(stepCue(ids, 'a', 1)).toBe('b')
  expect(stepCue(ids, 'b', -1)).toBe('a')
  expect(stepCue(ids, 'c', 1)).toBe('c')
  expect(stepCue(ids, 'a', -1)).toBe('a')
  expect(stepCue(ids, 'gone', 1)).toBe('a')
  expect(stepCue([], null, 1)).toBeNull()
})
