import type { WordLayer } from '@binder/shared'
import { expect, test } from 'vitest'
import { layoutPageCues } from './cueLayout'

const base = {
  type: 'go' as const,
  label: '',
  major: 10,
  minor: 0,
  dept_code: 'LX',
  dept_colour: '#F5A623',
  dept_number_format: 'decimal' as const,
}
const words: WordLayer = {
  words: [
    { t: 'a', x: 100, y: 495, w: 10, h: 10 },
    { t: 'b', x: 114, y: 495, w: 10, h: 10 },
  ],
  lines: [[0, 1]],
}
const at = (y: number, text?: { quote: string; wordStart: number; wordEnd: number }) => ({
  pageIndex: 0,
  x: 100,
  y,
  ...(text ? { text } : {}),
})

test('lays out every cue of a page by its department side and sort order', () => {
  const layouts = layoutPageCues(
    [
      { ...base, id: 'lx', anchor: at(500) },
      { ...base, id: 'snd', dept_code: 'SND', department_id: 'd-snd', anchor: at(500) },
    ],
    words,
    { width: 600, height: 800 },
    (id) => (id === 'd-snd' ? 'right' : 'left'),
    (id) => (id === 'd-snd' ? 10 : 0),
    () => ({ width: 'thin', pattern: 'solid' }),
  )
  expect(layouts.get('lx')?.tag.x).toBe(4)
  const snd = layouts.get('snd')
  expect((snd?.tag.x ?? 0) + (snd?.tag.w ?? 0)).toBeCloseTo(596)
})

test('a bound cue takes its trigger boxes from the words; unbound or without words it gets a tick', () => {
  const layouts = layoutPageCues(
    [
      { ...base, id: 'bound', anchor: at(500, { quote: 'b', wordStart: 1, wordEnd: 1 }) },
      { ...base, id: 'unbound', anchor: at(480, { quote: 'x', wordStart: -1, wordEnd: -1 }) },
    ],
    words,
    { width: 600, height: 800 },
    () => 'left',
    () => 0,
    () => ({ width: 'thin', pattern: 'solid' }),
  )
  expect(layouts.get('bound')?.triggerBoxes).toHaveLength(1)
  expect(layouts.get('bound')?.tick).toBeNull()
  expect(layouts.get('unbound')?.tick).not.toBeNull()
  const none = layoutPageCues(
    [{ ...base, id: 'c', anchor: at(500, { quote: 'b', wordStart: 1, wordEnd: 1 }) }],
    null,
    { width: 600, height: 800 },
    () => 'left',
    () => 0,
    () => ({ width: 'thin', pattern: 'solid' }),
  )
  expect(none.get('c')?.tick).not.toBeNull()
})

test('a cue whose anchor carries a tag is laid out as a moved bubble at the offset from its point', () => {
  const layouts = layoutPageCues(
    [
      { ...base, id: 'a', anchor: { ...at(500), tag: { dx: 150, dy: -40 } } },
      { ...base, id: 'b', anchor: at(500) },
    ],
    words,
    { width: 600, height: 800 },
    () => 'left',
    () => 0,
    () => ({ width: 'thin', pattern: 'solid' }),
  )
  const a = layouts.get('a')
  expect(a?.moved).toBe(true)
  const box = a?.tag
  expect((box?.x ?? 0) + (box?.w ?? 0) / 2).toBeCloseTo(250)
  expect((box?.y ?? 0) + (box?.h ?? 0) / 2).toBeCloseTo(460)
  expect(layouts.get('b')?.moved).toBe(false)
})

test('each cue takes its department connector style into the layout stroke', () => {
  const layouts = layoutPageCues(
    [
      {
        ...base,
        id: 'lx',
        department_id: 'd-lx',
        anchor: at(500, { quote: 'b', wordStart: 1, wordEnd: 1 }),
      },
      {
        ...base,
        id: 'snd',
        dept_code: 'SND',
        department_id: 'd-snd',
        anchor: at(480, { quote: 'b', wordStart: 1, wordEnd: 1 }),
      },
    ],
    words,
    { width: 600, height: 800 },
    () => 'left',
    () => 0,
    (id) =>
      id === 'd-snd' ? { width: 'bold', pattern: 'dashed' } : { width: 'thin', pattern: 'solid' },
  )
  expect(layouts.get('lx')?.stroke).toEqual({ width: 0.75, dash: null, round: false })
  expect(layouts.get('snd')?.stroke).toEqual({ width: 2.5, dash: [10, 6.25], round: false })
})
