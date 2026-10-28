import {
  type Anchor,
  type AnnotationFields,
  type CueFields,
  type LayerRef,
  PERSONAL_LAYER_COLOUR,
  type WordLayer,
} from '@binder/shared'
import { describe, expect, test } from 'vitest'
import { buildStampItems, type StampItem } from './stampItems'

const departments = [
  { id: 'd-lx', code: 'LX', colour: '#F5A623', numberFormat: 'decimal' as const, sortOrder: 0 },
  { id: 'd-tm', code: 'TM', colour: '#9B51E0', numberFormat: 'point' as const, sortOrder: 20 },
]
const anchor = (over: Partial<Anchor> = {}): Anchor => ({
  documentId: 'doc',
  documentVersionId: 'v1',
  pageIndex: 0,
  x: 100,
  y: 500,
  status: 'ok',
  ...over,
})
const cue = (id: string, over: Partial<CueFields> = {}): CueFields & { id: string } => ({
  id,
  departmentId: 'd-lx',
  major: 10,
  minor: 0,
  label: 'Sunrise',
  type: 'go',
  notes: '',
  colour: null,
  anchor: anchor(),
  ...over,
})
const annotation = (
  id: string,
  over: Partial<AnnotationFields> = {},
): AnnotationFields & { id: string } => ({
  id,
  layerKind: 'department',
  layerId: 'd-lx',
  anchor: anchor(),
  type: 'rect',
  geometry: { w: 40, h: 20 },
  text: '',
  style: {},
  ...over,
})
const dept = (id: string): LayerRef => ({ kind: 'department', id })
const base = {
  versionId: 'v1',
  departments,
  settings: {},
  wordLayers: new Map<number, WordLayer>(),
}
const annotations = (items: StampItem[]) => items.filter((i) => i.kind === 'annotation')

test('buildStampItems keeps only the version and the selected layers, with marker text and colour', () => {
  const items = buildStampItems({
    ...base,
    layers: [dept('d-lx')],
    cues: [
      cue('a'),
      cue('b', { departmentId: 'd-tm' }), // layer not selected
      cue('c', { anchor: anchor({ documentVersionId: 'v0' }) }), // another version
      cue('d', { anchor: null }), // unplaced
      cue('e', { type: 'standby', major: 14, minor: 50, anchor: anchor({ pageIndex: 2, y: 300 }) }),
    ],
    annotations: [],
  })
  expect(items).toEqual([
    {
      kind: 'cue',
      id: 'a',
      pageIndex: 0,
      x: 100,
      y: 500,
      type: 'go',
      lead: 'LX',
      typeWord: '',
      number: '10',
      numberInk: '#1A1715',
      colour: '#F5A623',
      side: 'left',
      connector: { width: 'thin', pattern: 'solid' },
      size: 'normal',
      sortKey: { department: 0, major: 10, minor: 0 },
      triggerBoxes: [],
      mark: 'underline',
      caret: null,
      tag: null,
      textExtent: null,
    },
    {
      kind: 'cue',
      id: 'e',
      pageIndex: 2,
      x: 100,
      y: 300,
      type: 'standby',
      lead: 'SB LX',
      typeWord: 'SB',
      number: '14.5',
      numberInk: '#1A1715',
      colour: '#F5A623',
      side: 'left',
      connector: { width: 'thin', pattern: 'solid' },
      size: 'normal',
      sortKey: { department: 0, major: 14, minor: 50 },
      triggerBoxes: [],
      mark: 'underline',
      caret: null,
      tag: null,
      textExtent: null,
    },
  ])
})

test('point-format departments show two-digit minors', () => {
  const [item] = buildStampItems({
    ...base,
    layers: [dept('d-tm')],
    cues: [cue('a', { departmentId: 'd-tm', major: 14, minor: 50, type: 'warn' })],
    annotations: [],
  })
  expect(item).toMatchObject({ lead: 'W TM', number: '14.50', colour: '#9B51E0' })
})

test('annotations follow their layer: department colour, personal grey, style override', () => {
  const items = buildStampItems({
    ...base,
    layers: [dept('d-lx'), { kind: 'personal', id: 'u-1' }],
    cues: [],
    annotations: [
      annotation('a'),
      annotation('b', { layerKind: 'personal', layerId: 'u-1', type: 'note', text: 'Hi' }),
      annotation('c', { layerKind: 'personal', layerId: 'u-2' }), // someone else's
      annotation('d', { style: { colour: '#112233', strokeWidth: 3 } }),
      annotation('e', { layerId: 'd-tm' }), // layer not selected
      annotation('f', { anchor: anchor({ documentVersionId: 'v0' }) }),
    ],
  })
  expect(annotations(items).map((i) => (i.kind === 'annotation' ? i.colour : ''))).toEqual([
    '#F5A623',
    PERSONAL_LAYER_COLOUR,
    '#112233',
  ])
  expect(items[0]).toMatchObject({ type: 'rect', geometry: { w: 40, h: 20 }, strokeWidth: 1.5 })
  expect(items[1]).toMatchObject({ type: 'note', text: 'Hi', fontSize: 10 })
  expect(items[2]).toMatchObject({ strokeWidth: 3 })
})

test('stamps default to 12 pt and keep an explicit font size', () => {
  const items = buildStampItems({
    ...base,
    layers: [dept('d-lx')],
    cues: [],
    annotations: [
      annotation('a', { type: 'stamp', text: 'Go' }),
      annotation('b', { type: 'stamp', text: 'Go', style: { fontSize: 20 } }),
    ],
  })
  expect(items.map((i) => (i.kind === 'annotation' ? i.fontSize : 0))).toEqual([12, 20])
})

test('a highlight carries its word boxes, one per covered line; an unbound one carries none', () => {
  const layer: WordLayer = {
    words: [
      { t: 'one', x: 50, y: 700, w: 30, h: 10 },
      { t: 'two', x: 90, y: 700, w: 30, h: 10 },
      { t: 'three', x: 50, y: 680, w: 40, h: 10 },
    ],
    lines: [[0, 1], [2]],
  }
  const items = buildStampItems({
    ...base,
    wordLayers: new Map([[0, layer]]),
    layers: [dept('d-lx')],
    cues: [],
    annotations: [
      annotation('a', {
        type: 'highlight',
        anchor: anchor({ text: { quote: 'two three', wordStart: 1, wordEnd: 2 } }),
      }),
      annotation('b', {
        type: 'highlight',
        anchor: anchor({ text: { quote: 'gone', wordStart: -1, wordEnd: -1 } }),
      }),
      annotation('c', {
        type: 'highlight',
        anchor: anchor({ pageIndex: 5, text: { quote: 'no page', wordStart: 0, wordEnd: 0 } }),
      }),
    ],
  })
  expect(items).toHaveLength(3)
  expect(items[0]).toMatchObject({
    text: 'two three',
    wordBoxes: [
      { x: 90, y: 700, w: 30, h: 10 },
      { x: 50, y: 680, w: 40, h: 10 },
    ],
  })
  expect(items[1]).toMatchObject({ text: 'gone', wordBoxes: [] })
  expect(items[2]).toMatchObject({ text: 'no page', wordBoxes: [] })
})

test('an empty layer selection stamps nothing', () =>
  expect(
    buildStampItems({ ...base, layers: [], cues: [cue('a')], annotations: [annotation('b')] }),
  ).toEqual([]))

test('a cue carries its department side from the show settings, left by default', () => {
  const items = buildStampItems({
    ...base,
    settings: { markerSides: { 'd-tm': 'right' } },
    layers: [dept('d-lx'), dept('d-tm')],
    cues: [cue('a'), cue('b', { departmentId: 'd-tm' })],
    annotations: [],
  })
  expect(items.map((i) => (i.kind === 'cue' ? [i.side, i.sortKey.department] : null))).toEqual([
    ['left', 0],
    ['right', 20],
  ])
})

test('a cue carries its department connector style; a department with no entry gets thin and solid', () => {
  const items = buildStampItems({
    ...base,
    settings: { connectorStyles: { 'd-tm': { width: 'bold', pattern: 'dotted' } } },
    layers: [dept('d-lx'), dept('d-tm')],
    cues: [cue('a'), cue('b', { departmentId: 'd-tm' })],
    annotations: [],
  })
  expect(items.map((i) => (i.kind === 'cue' ? i.connector : null))).toEqual([
    { width: 'thin', pattern: 'solid' },
    { width: 'bold', pattern: 'dotted' },
  ])
})

test('a cue carries its department cue size; a department with no entry, or a bad one, is normal', () => {
  const items = buildStampItems({
    ...base,
    settings: { cueSizes: { 'd-tm': 'large', 'd-lx': 'huge' } },
    layers: [dept('d-lx'), dept('d-tm')],
    cues: [cue('a'), cue('b', { departmentId: 'd-tm' })],
    annotations: [],
  })
  expect(items.map((i) => (i.kind === 'cue' ? i.size : null))).toEqual(['normal', 'large'])
})

test('a bound cue carries the word boxes of its trigger, one per line; unbound or no words carry none', () => {
  const layer: WordLayer = {
    words: [
      { t: 'one', x: 50, y: 700, w: 30, h: 10 },
      { t: 'two', x: 90, y: 700, w: 30, h: 10 },
      { t: 'three', x: 50, y: 680, w: 40, h: 10 },
    ],
    lines: [[0, 1], [2]],
  }
  const items = buildStampItems({
    ...base,
    wordLayers: new Map([[0, layer]]),
    layers: [dept('d-lx')],
    cues: [
      cue('a', { anchor: anchor({ text: { quote: 'two three', wordStart: 1, wordEnd: 2 } }) }),
      cue('b', { anchor: anchor({ text: { quote: 'gone', wordStart: -1, wordEnd: -1 } }) }),
      cue('c', {
        anchor: anchor({ pageIndex: 4, text: { quote: 'no page', wordStart: 0, wordEnd: 0 } }),
      }),
      cue('d'),
    ],
    annotations: [],
  })
  const boxes = items.map((i) => (i.kind === 'cue' ? i.triggerBoxes : null))
  expect(boxes[0]).toEqual([
    { x: 90, y: 700, w: 30, h: 10 },
    { x: 50, y: 680, w: 40, h: 10 },
  ])
  expect(boxes.slice(1)).toEqual([[], [], []])
})

test("a cue carries its page's text block, so tags stay out of it", () => {
  const layer: WordLayer = {
    words: [
      { t: 'one', x: 50, y: 700, w: 30, h: 10 },
      { t: 'two', x: 90, y: 700, w: 480, h: 10 },
    ],
    lines: [[0, 1]],
  }
  const items = buildStampItems({
    ...base,
    wordLayers: new Map([[0, layer]]),
    layers: [dept('d-lx')],
    cues: [cue('a'), cue('b', { anchor: anchor({ pageIndex: 3 }) })],
    annotations: [],
  })
  expect(items.map((i) => (i.kind === 'cue' ? i.textExtent : 'x'))).toEqual([
    { minX: 50, maxX: 570 },
    null,
  ])
})

describe('include filters', () => {
  const cues = [
    cue('go', { type: 'go' }),
    cue('sb', { type: 'standby', major: 11 }),
    cue('w', { type: 'warn', major: 12 }),
  ]
  const input = { ...base, layers: [dept('d-lx')], cues, annotations: [annotation('r')] }
  const cueIds = (items: StampItem[]) => items.flatMap((i) => (i.kind === 'cue' ? [i.id] : []))

  test('everything is included by default', () => {
    const items = buildStampItems(input)
    expect(cueIds(items)).toEqual(['go', 'sb', 'w'])
    expect(annotations(items)).toHaveLength(1)
    expect(buildStampItems({ ...input, include: {} })).toEqual(items)
  })

  test('standbyWarn false keeps only go cues', () => {
    const items = buildStampItems({ ...input, include: { standbyWarn: false } })
    expect(cueIds(items)).toEqual(['go'])
    expect(annotations(items)).toHaveLength(1)
  })

  test('annotations false emits no annotation items', () => {
    const items = buildStampItems({ ...input, include: { annotations: false } })
    expect(annotations(items)).toHaveLength(0)
    expect(cueIds(items)).toEqual(['go', 'sb', 'w'])
  })
})

describe('cue notes', () => {
  const noted = [
    cue('a', { notes: 'Ride the pad  under the  dialogue', anchor: anchor({ pageIndex: 2 }) }),
    cue('b', { notes: '   ', major: 11 }),
    cue('c', { notes: '', major: 12 }),
    cue('d', { notes: 'Late', type: 'standby', major: 13, departmentId: 'd-tm' }),
  ]
  const input = { ...base, layers: [dept('d-lx'), dept('d-tm')], cues: noted, annotations: [] }
  const noteItems = (items: StampItem[]) => items.filter((i) => i.kind === 'cue-note')

  test('a cue with a non-empty note gets one cue-note item in its department colour', () => {
    expect(noteItems(buildStampItems(input))).toEqual([
      {
        kind: 'cue-note',
        cueId: 'a',
        pageIndex: 2,
        text: 'Ride the pad under the dialogue',
        colour: '#F5A623',
      },
      { kind: 'cue-note', cueId: 'd', pageIndex: 0, text: 'Late', colour: '#9B51E0' },
    ])
  })

  test('cueNotes false emits none', () => {
    expect(noteItems(buildStampItems({ ...input, include: { cueNotes: false } }))).toEqual([])
  })

  test('a filtered-out cue brings no note', () => {
    const items = buildStampItems({ ...input, include: { standbyWarn: false } })
    expect(noteItems(items).map((i) => (i.kind === 'cue-note' ? i.cueId : ''))).toEqual(['a'])
    expect(
      noteItems(buildStampItems({ ...input, layers: [dept('d-tm')] })).map((i) =>
        i.kind === 'cue-note' ? i.cueId : '',
      ),
    ).toEqual(['d'])
  })
})

describe('cue marks', () => {
  const layer: WordLayer = {
    words: [
      { t: 'one', x: 50, y: 700, w: 30, h: 10 },
      { t: 'two', x: 90, y: 700, w: 30, h: 10 },
      { t: 'three', x: 50, y: 680, w: 40, h: 10 },
    ],
    lines: [[0, 1], [2]],
  }
  const cueItems = (items: StampItem[]) => items.flatMap((i) => (i.kind === 'cue' ? [i] : []))
  const run = (cues: Array<CueFields & { id: string }>, words = true) =>
    cueItems(
      buildStampItems({
        ...base,
        wordLayers: new Map(words ? [[0, layer]] : []),
        layers: [dept('d-lx')],
        cues,
        annotations: [],
      }),
    )

  test('an underline cue carries the underline mark and no caret', () => {
    const [item] = run([
      cue('a', { anchor: anchor({ text: { quote: 'two', wordStart: 1, wordEnd: 1 } }) }),
    ])
    expect(item).toMatchObject({ mark: 'underline', caret: null })
    expect(item?.triggerBoxes).toEqual([{ x: 90, y: 700, w: 30, h: 10 }])
  })

  test('a line cue carries mark and caret, and its first word box only', () => {
    const [item] = run([
      cue('a', {
        anchor: anchor({
          mark: 'line',
          text: { quote: 'two three', wordStart: 1, wordEnd: 2, offset: 0 },
        }),
      }),
    ])
    expect(item).toMatchObject({
      mark: 'line',
      caret: { x: 90, box: { x: 90, y: 700, w: 30, h: 10 } },
    })
    expect(item?.triggerBoxes).toEqual([{ x: 90, y: 700, w: 30, h: 10 }])
  })

  test('a highlight carries its mark and the boxes of its whole range, and no caret', () => {
    const [item] = run([
      cue('a', {
        anchor: anchor({
          mark: 'highlight',
          text: { quote: 'two three', wordStart: 1, wordEnd: 2 },
        }),
      }),
    ])
    expect(item).toMatchObject({ mark: 'highlight', caret: null })
    expect(item?.triggerBoxes).toEqual([
      { x: 90, y: 700, w: 30, h: 10 },
      { x: 50, y: 680, w: 40, h: 10 },
    ])
  })

  test('a cue with no word layer carries empty boxes and no caret, whatever its mark', () => {
    const items = run(
      [
        cue('a', {
          anchor: anchor({
            mark: 'line',
            text: { quote: 'two', wordStart: 1, wordEnd: 1, offset: 1 },
          }),
        }),
        cue('b', {
          anchor: anchor({ mark: 'highlight', text: { quote: 'two', wordStart: 1, wordEnd: 1 } }),
        }),
      ],
      false,
    )
    expect(items.map((i) => [i.mark, i.triggerBoxes, i.caret])).toEqual([
      ['line', [], null],
      ['highlight', [], null],
    ])
  })
})

test('a cue with a tag is stamped at the offset, without its note', () => {
  const items = buildStampItems({
    ...base,
    layers: [dept('d-lx')],
    cues: [
      cue('a', { notes: 'Ride the pad', anchor: anchor({ tag: { dx: 30, dy: -12 } }) }),
      cue('b', { notes: 'Late' }),
    ],
    annotations: [],
  })
  const cues = items.filter((i) => i.kind === 'cue')
  expect(cues.map((i) => (i.kind === 'cue' ? i.tag : 'x'))).toEqual([{ dx: 30, dy: -12 }, null])
  // The anchor is still where the mark is; the tag is the bubble's offset from it.
  expect(cues[0]).toMatchObject({ x: 100, y: 500 })
  const notes = items.filter((i) => i.kind === 'cue-note')
  expect(notes.map((i) => (i.kind === 'cue-note' ? i.cueId : ''))).toEqual(['b'])
})
