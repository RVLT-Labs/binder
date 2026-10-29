import { describe, expect, test } from 'vitest'
import {
  CUE_SIZE_SCALE,
  CUE_SIZES,
  connectorStyle,
  cueSize,
  DEFAULT_CONNECTOR_STYLE,
  DEFAULT_STAMPS,
  isCaretMark,
  markerSide,
  markOf,
  paperSize,
  stampSet,
} from './markup'
import {
  anchorSchema,
  annotationFieldsSchema,
  annotationPatchSchema,
  cueFieldsSchema,
  cueSizesSchema,
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

describe('markerSide', () => {
  test('is left unless the show puts the department on the right', () => {
    expect(markerSide({}, 'd1')).toBe('left')
    expect(markerSide({ markerSides: { d1: 'right' } }, 'd1')).toBe('right')
    expect(markerSide({ markerSides: { d1: 'right' } }, 'd2')).toBe('left')
    expect(markerSide({ markerSides: { d1: 'left' } }, 'd1')).toBe('left')
  })

  test('falls back to left for anything malformed', () => {
    expect(markerSide({ markerSides: 'right' }, 'd1')).toBe('left')
    expect(markerSide({ markerSides: ['right'] }, '0')).toBe('left')
    expect(markerSide({ markerSides: null }, 'd1')).toBe('left')
    expect(markerSide({ markerSides: { d1: 'middle' } }, 'd1')).toBe('left')
    expect(markerSide({ markerSides: { d1: 3 } }, 'd1')).toBe('left')
    // An inherited key is not a department.
    expect(markerSide({ markerSides: {} }, 'constructor')).toBe('left')
  })
})

describe('connectorStyle', () => {
  test('reads a valid entry; anything missing or malformed gives thin and solid', () => {
    const thin = { width: 'thin', pattern: 'solid' }
    expect(DEFAULT_CONNECTOR_STYLE).toEqual(thin)
    expect(
      connectorStyle({ connectorStyles: { d1: { width: 'bold', pattern: 'dotted' } } }, 'd1'),
    ).toEqual({
      width: 'bold',
      pattern: 'dotted',
    })
    expect(connectorStyle({ connectorStyles: { d1: { width: 'medium' } } }, 'd1')).toEqual({
      width: 'medium',
      pattern: 'solid',
    })
    expect(connectorStyle({}, 'd1')).toEqual(thin)
    expect(connectorStyle({ connectorStyles: { d1: { width: 'bold' } } }, 'd2')).toEqual(thin)
    // A non-object settings, and non-object maps or entries.
    expect(connectorStyle(null as never, 'd1')).toEqual(thin)
    expect(connectorStyle('x' as never, 'd1')).toEqual(thin)
    expect(connectorStyle({ connectorStyles: 'bold' }, 'd1')).toEqual(thin)
    expect(connectorStyle({ connectorStyles: [{ width: 'bold' }] }, '0')).toEqual(thin)
    expect(connectorStyle({ connectorStyles: { d1: 'bold' } }, 'd1')).toEqual(thin)
    expect(connectorStyle({ connectorStyles: { d1: null } }, 'd1')).toEqual(thin)
    // A bad width or pattern falls back on its own, keeping the other.
    expect(
      connectorStyle({ connectorStyles: { d1: { width: 'huge', pattern: 'dashed' } } }, 'd1'),
    ).toEqual({ width: 'thin', pattern: 'dashed' })
    expect(
      connectorStyle({ connectorStyles: { d1: { width: 'bold', pattern: 'wavy' } } }, 'd1'),
    ).toEqual({ width: 'bold', pattern: 'solid' })
    expect(connectorStyle({ connectorStyles: { d1: { width: 2, pattern: 3 } } }, 'd1')).toEqual(
      thin,
    )
    // Prototype keys are not departments.
    expect(connectorStyle({ connectorStyles: {} }, '__proto__')).toEqual(thin)
    expect(connectorStyle({ connectorStyles: {} }, 'constructor')).toEqual(thin)
    expect(
      connectorStyle(JSON.parse('{"connectorStyles":{"__proto__":{"width":"bold"}}}'), 'x'),
    ).toEqual(thin)
  })

  test('returns a fresh object, so a caller cannot change the default', () => {
    const a = connectorStyle({}, 'd1')
    a.width = 'bold'
    expect(connectorStyle({}, 'd1').width).toBe('thin')
  })
})

describe('cueSize', () => {
  test('is normal unless the show makes the department large', () => {
    expect(CUE_SIZES).toEqual(['normal', 'large'])
    expect(cueSize({}, 'd1')).toBe('normal')
    expect(cueSize({ cueSizes: { d1: 'large' } }, 'd1')).toBe('large')
    expect(cueSize({ cueSizes: { d1: 'large' } }, 'd2')).toBe('normal')
    expect(cueSize({ cueSizes: { d1: 'normal' } }, 'd1')).toBe('normal')
  })

  test('falls back to normal for anything malformed', () => {
    expect(cueSize(null as never, 'd1')).toBe('normal')
    expect(cueSize({ cueSizes: 'large' }, 'd1')).toBe('normal')
    expect(cueSize({ cueSizes: ['large'] }, '0')).toBe('normal')
    expect(cueSize({ cueSizes: null }, 'd1')).toBe('normal')
    expect(cueSize({ cueSizes: { d1: 'huge' } }, 'd1')).toBe('normal')
    expect(cueSize({ cueSizes: { d1: 1.3 } }, 'd1')).toBe('normal')
    expect(cueSize({ cueSizes: {} }, 'constructor')).toBe('normal')
    expect(cueSize(JSON.parse('{"cueSizes":{"__proto__":"large"}}'), 'x')).toBe('normal')
  })

  test('large is a third bigger than normal, which is exactly today', () => {
    expect(CUE_SIZE_SCALE.normal).toBe(1)
    expect(CUE_SIZE_SCALE.large).toBeGreaterThanOrEqual(1.25)
    expect(CUE_SIZE_SCALE.large).toBeLessThanOrEqual(1.4)
  })
})

describe('cueSizesSchema', () => {
  test('accepts a map of department id to normal or large', () => {
    expect(cueSizesSchema.safeParse({}).success).toBe(true)
    expect(cueSizesSchema.safeParse({ d1: 'large', d2: 'normal' }).success).toBe(true)
  })

  test('refuses any other size, shape or key', () => {
    for (const bad of [
      'large',
      ['large'],
      null,
      { d1: 'huge' },
      { d1: 1.3 },
      { d1: { size: 'large' } },
      { '': 'large' },
      { ['x'.repeat(201)]: 'large' },
      { 'a\u0000b': 'large' },
    ]) {
      expect(cueSizesSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false)
    }
  })
})

const word = { quote: 'welcome', wordStart: 4, wordEnd: 4 }

test('anchors accept mark, tag and a text offset on a line', () => {
  const a = {
    ...anchor,
    mark: 'line',
    tag: { dx: -30, dy: 12 },
    text: { ...word, offset: 3 },
  }
  const r = anchorSchema.safeParse(a)
  expect(r.success).toBe(true)
  if (r.success) {
    expect(r.data.mark).toBe('line')
    expect(r.data.tag).toEqual({ dx: -30, dy: 12 })
    expect(r.data.text?.offset).toBe(3)
  }
})

test('a text offset needs a bound word and a line or pointer mark', () => {
  const withOffset = { ...word, offset: 3 }
  expect(anchorSchema.safeParse({ ...anchor, text: withOffset }).success).toBe(false)
  expect(anchorSchema.safeParse({ ...anchor, mark: 'highlight', text: withOffset }).success).toBe(
    false,
  )
  expect(
    anchorSchema.safeParse({
      ...anchor,
      mark: 'line',
      text: { ...withOffset, wordStart: -1, wordEnd: -1 },
    }).success,
  ).toBe(false)
  expect(anchorSchema.safeParse({ ...anchor, mark: 'pointer', text: withOffset }).success).toBe(
    true,
  )
})

test('an unknown mark, a non-finite tag and a tag beyond 14400 are refused', () => {
  expect(anchorSchema.safeParse({ ...anchor, mark: 'squiggle' }).success).toBe(false)
  expect(anchorSchema.safeParse({ ...anchor, tag: { dx: Number.NaN, dy: 0 } }).success).toBe(false)
  expect(
    anchorSchema.safeParse({ ...anchor, tag: { dx: Number.POSITIVE_INFINITY, dy: 0 } }).success,
  ).toBe(false)
  expect(anchorSchema.safeParse({ ...anchor, tag: { dx: 14401, dy: 0 } }).success).toBe(false)
  expect(anchorSchema.safeParse({ ...anchor, tag: { dx: 0, dy: -14401 } }).success).toBe(false)
  expect(anchorSchema.safeParse({ ...anchor, tag: { dx: 14400, dy: -14400 } }).success).toBe(true)
})

test('annotations refuse mark, tag and text offset', () => {
  const base = {
    layerKind: 'personal',
    layerId: 'u',
    geometry: {},
    style: {},
  }
  const note = { ...base, type: 'note', text: 'hi', anchor }
  const hl = {
    ...base,
    type: 'highlight',
    text: '',
    anchor: { ...anchor, text: word },
  }
  for (const mode of ['create', 'update'] as const) {
    const schema = annotationFieldsSchema(mode)
    expect(schema.safeParse(note).success).toBe(true)
    expect(schema.safeParse(hl).success).toBe(true)
    for (const extra of [{ mark: 'line' }, { tag: { dx: 1, dy: 1 } }]) {
      expect(schema.safeParse({ ...note, anchor: { ...anchor, ...extra } }).success).toBe(false)
      expect(schema.safeParse({ ...hl, anchor: { ...hl.anchor, ...extra } }).success).toBe(false)
    }
    expect(
      schema.safeParse({
        ...hl,
        anchor: { ...hl.anchor, mark: 'line', text: { ...word, offset: 2 } },
      }).success,
    ).toBe(false)
  }
})

test('markOf treats a missing mark as underline and isCaretMark is line and pointer only', () => {
  expect(markOf(undefined)).toBe('underline')
  expect(markOf(null)).toBe('underline')
  expect(markOf({})).toBe('underline')
  expect(markOf({ mark: 'pointer' })).toBe('pointer')
  expect(isCaretMark('line')).toBe(true)
  expect(isCaretMark('pointer')).toBe(true)
  expect(isCaretMark('underline')).toBe(false)
  expect(isCaretMark('highlight')).toBe(false)
})

test('ink geometry validates point count, pressure, coordinates, and exact point keys', () => {
  const geometry = { count: 2, x0: 0, y0: 0, p0: 0.5, x1: 20, y1: -10, p1: 1 }
  expect(
    annotationFieldsSchema('create').safeParse({ ...ann, type: 'ink', text: '', geometry }).success,
  ).toBe(true)
  for (const change of [
    { count: 1 },
    { count: 4097 },
    { x1: Infinity },
    { p1: 1.1 },
    { x1: 14401 },
    { extra: 1 },
    { count: 2.5 },
  ]) {
    expect(geometrySchema('ink').safeParse({ ...geometry, ...change }).success).toBe(false)
  }
  const { p1, ...missing } = geometry
  expect(geometrySchema('ink').safeParse(missing).success).toBe(false)
})
