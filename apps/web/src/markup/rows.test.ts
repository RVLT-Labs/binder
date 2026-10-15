import { expect, test } from 'vitest'
import { fromCueRow } from './mutations'
import { CUE_TYPES, parseAnchor, parseJson } from './rows'

const anchor = { documentId: 'd', documentVersionId: 'v', pageIndex: 1, x: 2, y: 3, status: 'ok' }

test('parseJson reads JSON text, passes parsed values through, and is null for anything else', () => {
  expect(parseJson('{"a":1}')).toEqual({ a: 1 })
  expect(parseJson({ a: 1 })).toEqual({ a: 1 })
  expect(parseJson('not json')).toBeNull()
  expect(parseJson(null)).toBeNull()
  expect(parseJson(undefined)).toBeNull()
})

test('parseAnchor accepts only a valid anchor', () => {
  expect(parseAnchor(JSON.stringify(anchor))).toEqual(anchor)
  expect(parseAnchor(null)).toBeNull()
  expect(parseAnchor('')).toBeNull()
  expect(parseAnchor('{"pageIndex":"x"}')).toBeNull()
})

test('one row-to-cue mapping serves the cue list, edits and exports', () => {
  const row = {
    id: 'c1',
    department_id: 'd-lx',
    major: 10,
    minor: 50,
    label: null,
    type: 'warn',
    notes: 'n',
    colour: '#FF0000',
    anchor: JSON.stringify(anchor),
  }
  expect(fromCueRow(row)).toEqual({
    departmentId: 'd-lx',
    major: 10,
    minor: 50,
    label: '',
    type: 'warn',
    notes: 'n',
    colour: '#FF0000',
    anchor,
  })
  expect(fromCueRow({ ...row, anchor: '{"broken":true}' }).anchor).toBeNull()
  expect(CUE_TYPES).toEqual(['go', 'standby', 'warn'])
})
