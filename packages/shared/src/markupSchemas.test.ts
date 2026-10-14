import { expect, test } from 'vitest'
import { anchorSchema, cueFieldsSchema } from './markupSchemas'

const anchor = { documentId: 'd', documentVersionId: 'v', pageIndex: 0, x: 10, y: 20, status: 'ok' }
const cue = {
  departmentId: 'dept',
  major: 1,
  minor: 0,
  label: '',
  type: 'go',
  notes: '',
  colour: null,
  anchor: null,
}

test('anchors accept text ranges and refuse out-of-range coordinates and NUL', () => {
  expect(anchorSchema.safeParse(anchor).success).toBe(true)
  const text = { quote: 'hi', wordStart: -1, wordEnd: -1 }
  expect(anchorSchema.safeParse({ ...anchor, text }).success).toBe(true)
  expect(
    anchorSchema.safeParse({ ...anchor, text: { ...text, wordStart: 3, wordEnd: 2 } }).success,
  ).toBe(false)
  expect(anchorSchema.safeParse({ ...anchor, text: { ...text, quote: '' } }).success).toBe(false)
  expect(anchorSchema.safeParse({ ...anchor, x: 14401 }).success).toBe(false)
  expect(anchorSchema.safeParse({ ...anchor, y: Number.NaN }).success).toBe(false)
  expect(anchorSchema.safeParse({ ...anchor, pageIndex: 1.5 }).success).toBe(false)
  expect(anchorSchema.safeParse({ ...anchor, documentId: 'a\u0000b' }).success).toBe(false)
  expect(anchorSchema.safeParse({ ...anchor, status: 'bogus' }).success).toBe(false)
})

test('cue fields bound number, colour, text and refuse NUL', () => {
  expect(cueFieldsSchema.safeParse(cue).success).toBe(true)
  expect(cueFieldsSchema.safeParse({ ...cue, colour: '#aAbBcC', anchor }).success).toBe(true)
  for (const bad of [
    { major: 10000 },
    { minor: 100 },
    { minor: -1 },
    { colour: 'red' },
    { label: 'x'.repeat(201) },
    { notes: 'a\u0000' },
    { type: 'stop' },
  ]) {
    expect(cueFieldsSchema.safeParse({ ...cue, ...bad }).success, JSON.stringify(bad)).toBe(false)
  }
})
