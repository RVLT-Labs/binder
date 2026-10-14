import type { Anchor, CueFields } from '@binder/shared'
import { expect, test } from 'vitest'
import { cueListRows } from './cueList'

const dept = (id: string, code: string, numberFormat: 'decimal' | 'point' = 'decimal') => ({
  id,
  code,
  numberFormat,
})
const docs = [
  { id: 'd1', title: 'Libretto', currentVersionId: 'v2' },
  { id: 'd2', title: 'Score', currentVersionId: 'w1' },
]
const anchor = (over: Partial<Anchor> = {}): Anchor => ({
  documentId: 'd1',
  documentVersionId: 'v2',
  pageIndex: 0,
  x: 10,
  y: 700,
  status: 'ok',
  ...over,
})
const cue = (
  id: string,
  major: number,
  minor: number,
  over: Partial<CueFields> = {},
): CueFields & { id: string } => ({
  id,
  departmentId: 'lx',
  major,
  minor,
  label: `L${id}`,
  type: 'go',
  notes: '',
  colour: null,
  anchor: anchor(),
  ...over,
})

test('rows sort by number, flag duplicates and anchor states, and trail unplaced', () => {
  const rows = cueListRows(
    [
      cue('free', 1, 0, { anchor: null }),
      cue('b', 12, 50, { anchor: anchor({ pageIndex: 2, status: 'approximate' }) }),
      cue('a', 10, 0),
      cue('d1', 11, 0),
      cue('d2', 11, 0, { anchor: anchor({ status: 'unresolved' }) }),
      cue('old', 13, 0, { anchor: anchor({ documentVersionId: 'v1' }) }),
    ],
    [dept('lx', 'LX')],
    docs,
  )
  expect(rows.map((r) => r.id)).toEqual(['a', 'd1', 'd2', 'b', 'old', 'free'])
  expect(rows.map((r) => r.placed)).toEqual([true, true, true, true, true, false])
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]))
  expect(byId.a?.flags).toEqual([])
  expect(byId.d1?.flags).toEqual(['duplicate'])
  expect(byId.d2?.flags).toEqual(['duplicate', 'unresolved'])
  expect(byId.b?.flags).toEqual(['approximate'])
  expect(byId.old?.flags).toEqual(['older-version'])
  expect(byId.b?.display).toBe('12.5')
  expect(byId.b?.page).toBe('p.3')
  expect(byId.free).toMatchObject({ page: '—', documentTitle: '', anchor: null, trigger: '' })
})

test('duplicates are per department and the number format follows the department', () => {
  const rows = cueListRows(
    [cue('a', 10, 50), cue('b', 10, 50, { departmentId: 'tm' })],
    [dept('lx', 'LX'), dept('tm', 'TM', 'point')],
    docs,
  )
  expect(rows.map((r) => [r.id, r.display, r.flags])).toEqual([
    ['a', '10.5', []],
    ['b', '10.50', []],
  ])
})

test('pages carry the document title only when the department spans documents', () => {
  const rows = cueListRows(
    [
      cue('a', 10, 0),
      cue('b', 11, 0, {
        anchor: anchor({ documentId: 'd2', documentVersionId: 'w1', pageIndex: 4 }),
      }),
      cue('c', 12, 0, { departmentId: 'snd' }),
    ],
    [dept('lx', 'LX'), dept('snd', 'SND')],
    docs,
  )
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]))
  expect(byId.a).toMatchObject({ page: 'Libretto p.1', documentTitle: 'Libretto' })
  expect(byId.b).toMatchObject({ page: 'Score p.5', documentTitle: 'Score' })
  expect(byId.c).toMatchObject({ page: 'p.1', documentTitle: '' })
})

test('the trigger is the bound quote', () => {
  const rows = cueListRows(
    [
      cue('a', 10, 0, {
        anchor: anchor({ text: { quote: 'And so it begins', wordStart: 3, wordEnd: 6 } }),
      }),
      cue('b', 11, 0, { anchor: anchor({ text: { quote: 'stale', wordStart: -1, wordEnd: -1 } }) }),
    ],
    [dept('lx', 'LX')],
    docs,
  )
  expect(rows.map((r) => r.trigger)).toEqual(['And so it begins', ''])
})
