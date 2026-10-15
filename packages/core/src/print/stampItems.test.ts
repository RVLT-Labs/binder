import {
  type Anchor,
  type AnnotationFields,
  type CueFields,
  type LayerRef,
  PERSONAL_LAYER_COLOUR,
  type WordLayer,
} from '@binder/shared'
import { expect, test } from 'vitest'
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
      code: 'LX',
      number: '10',
      colour: '#F5A623',
      side: 'left',
      sortKey: { department: 0, major: 10, minor: 0 },
      triggerBoxes: [],
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
      code: 'LX',
      number: '14.5',
      colour: '#F5A623',
      side: 'left',
      sortKey: { department: 0, major: 14, minor: 50 },
      triggerBoxes: [],
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
