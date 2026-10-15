import { describe, expect, test } from 'vitest'
import { DEFAULT_STAMPS, paperSize, stampSet } from './markup'
import {
  anchorSchema,
  annotationFieldsSchema,
  annotationPatchSchema,
  cueFieldsSchema,
  geometrySchema,
  styleSchema,
} from './markupSchemas'

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

const ann = {
  layerKind: 'personal',
  layerId: 'user-1',
  anchor,
  type: 'note',
  geometry: {},
  text: 'hello',
  style: {},
}
const highlightAnchor = (wordStart: number, wordEnd: number) => ({
  ...anchor,
  text: { quote: 'to be', wordStart, wordEnd },
})

describe('geometrySchema', () => {
  test('note, stamp and highlight carry no geometry', () => {
    for (const type of ['note', 'stamp', 'highlight'] as const) {
      expect(geometrySchema(type).safeParse({}).success, type).toBe(true)
      expect(geometrySchema(type).safeParse({ w: 5 }).success, type).toBe(false)
    }
  })

  test('rect and ellipse need w and h above 0 and at most 14400', () => {
    for (const type of ['rect', 'ellipse'] as const) {
      expect(geometrySchema(type).safeParse({ w: 10, h: 14400 }).success, type).toBe(true)
      for (const bad of [
        { w: 0, h: 5 },
        { w: 5, h: -1 },
        { w: 14401, h: 5 },
        { w: 5 },
        { w: 5, h: 5, dx: 1 },
        { w: Number.NaN, h: 5 },
      ]) {
        expect(geometrySchema(type).safeParse(bad).success, `${type} ${JSON.stringify(bad)}`).toBe(
          false,
        )
      }
    }
  })

  test('line and arrow need dx and dy within 14400, not both zero', () => {
    for (const type of ['line', 'arrow'] as const) {
      expect(geometrySchema(type).safeParse({ dx: -14400, dy: 0 }).success, type).toBe(true)
      expect(geometrySchema(type).safeParse({ dx: 0, dy: 3 }).success, type).toBe(true)
      for (const bad of [
        { dx: 0, dy: 0 },
        { dx: 14401, dy: 1 },
        { dx: 1, dy: -14401 },
        { dx: 1 },
      ]) {
        expect(geometrySchema(type).safeParse(bad).success, `${type} ${JSON.stringify(bad)}`).toBe(
          false,
        )
      }
    }
  })
})

describe('styleSchema', () => {
  test('bounds colour, stroke width and font size', () => {
    expect(styleSchema.safeParse({}).success).toBe(true)
    expect(
      styleSchema.safeParse({ colour: '#aAbBcC', strokeWidth: 0.5, fontSize: 72 }).success,
    ).toBe(true)
    for (const bad of [
      { colour: 'red' },
      { strokeWidth: 0.4 },
      { strokeWidth: 12.1 },
      { fontSize: 5 },
      { fontSize: 73 },
      { shadow: true },
    ]) {
      expect(styleSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false)
    }
  })
})

describe('annotationFieldsSchema', () => {
  const create = annotationFieldsSchema('create')
  const update = annotationFieldsSchema('update')
  const ok = (schema: typeof create, v: unknown) => schema.safeParse(v).success

  test('accepts a valid note and checks the geometry for the type', () => {
    expect(ok(create, ann)).toBe(true)
    expect(ok(create, { ...ann, type: 'rect', geometry: { w: 0, h: 5 }, text: '' })).toBe(false)
    expect(ok(create, { ...ann, type: 'rect', geometry: { w: 30, h: 5 }, text: '' })).toBe(true)
    expect(ok(create, { ...ann, type: 'arrow', geometry: { dx: 0, dy: 0 }, text: '' })).toBe(false)
    expect(ok(create, { ...ann, type: 'arrow', geometry: { dx: 40, dy: -2 }, text: '' })).toBe(true)
  })

  test('a note needs text, a stamp 1 to 40 characters', () => {
    expect(ok(create, { ...ann, text: '' })).toBe(false)
    expect(ok(create, { ...ann, text: '   ' })).toBe(false)
    expect(ok(create, { ...ann, type: 'stamp', text: '' })).toBe(false)
    expect(ok(create, { ...ann, type: 'stamp', text: 'Fly in' })).toBe(true)
    expect(ok(create, { ...ann, type: 'stamp', text: 'x'.repeat(41) })).toBe(false)
  })

  test('text is capped at 2000 and refuses NUL', () => {
    expect(ok(create, { ...ann, text: 'x'.repeat(2000) })).toBe(true)
    expect(ok(create, { ...ann, text: 'x'.repeat(2001) })).toBe(false)
    expect(ok(create, { ...ann, text: 'a\u0000b' })).toBe(false)
    expect(ok(create, { ...ann, layerId: 'a\u0000b' })).toBe(false)
  })

  test('a highlight needs anchor text; wordStart >= 0 only on create', () => {
    const highlight = { ...ann, type: 'highlight', text: '' }
    expect(ok(create, highlight)).toBe(false)
    expect(ok(update, highlight)).toBe(false)
    expect(ok(create, { ...highlight, anchor: highlightAnchor(4, 6) })).toBe(true)
    expect(ok(create, { ...highlight, anchor: highlightAnchor(-1, -1) })).toBe(false)
    expect(ok(create, { ...highlight, anchor: highlightAnchor(-1, 6) })).toBe(false)
    // Restoring a deleted highlight that re-anchoring left unbound: the -1/-1 range, status unresolved.
    expect(
      ok(create, {
        ...highlight,
        anchor: { ...highlightAnchor(-1, -1), status: 'unresolved' },
      }),
    ).toBe(true)
    expect(
      ok(create, {
        ...highlight,
        anchor: { ...highlightAnchor(-1, -1), status: 'approximate' },
      }),
    ).toBe(false)
    expect(ok(update, { ...highlight, anchor: highlightAnchor(-1, -1) })).toBe(true)
    expect(ok(update, { ...highlight, anchor: highlightAnchor(4, 6) })).toBe(true)
  })

  test('layer kind is department or personal', () => {
    expect(ok(create, { ...ann, layerKind: 'everyone' })).toBe(false)
    expect(ok(create, { ...ann, layerKind: 'department', layerId: 'dept' })).toBe(true)
  })
})

describe('annotationPatchSchema', () => {
  test('every field is optional but still bounded', () => {
    expect(annotationPatchSchema.safeParse({}).success).toBe(true)
    expect(annotationPatchSchema.safeParse({ text: 'x'.repeat(2001) }).success).toBe(false)
    expect(annotationPatchSchema.safeParse({ style: { fontSize: 5 } }).success).toBe(false)
    expect(annotationPatchSchema.safeParse({ geometry: { w: 'a' } }).success).toBe(false)
  })
})

describe('stampSet', () => {
  test('falls back to the defaults unless the show sets a non-empty string list', () => {
    expect(stampSet({})).toEqual([...DEFAULT_STAMPS])
    expect(stampSet({ stampSet: [] })).toEqual([...DEFAULT_STAMPS])
    expect(stampSet({ stampSet: 'Go' })).toEqual([...DEFAULT_STAMPS])
    expect(stampSet({ stampSet: ['Go', 3] })).toEqual([...DEFAULT_STAMPS])
    expect(stampSet({ stampSet: ['Hold', 'Go'] })).toEqual(['Hold', 'Go'])
  })
})

describe('paperSize', () => {
  test('is A4 unless the settings say Letter', () => {
    expect(paperSize({})).toBe('A4')
    expect(paperSize({ paperSize: 'Letter' })).toBe('Letter')
    expect(paperSize({ paperSize: 'A4' })).toBe('A4')
    expect(paperSize({ paperSize: 'legal' })).toBe('A4')
    expect(paperSize({ paperSize: 3 })).toBe('A4')
  })
})
