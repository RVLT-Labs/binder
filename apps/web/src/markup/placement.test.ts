import { snapToCaret } from '@binder/core'
import type { WordLayer } from '@binder/shared'
import { describe, expect, test } from 'vitest'
import { anchorAt, markAnchorAt, numberAt } from './placement'

/** Two lines: "To be or not" centred on y 705, "Pirates of Penzance" centred on y 655. */
const layer: WordLayer = {
  words: [
    { t: 'To', x: 50, y: 700, w: 14, h: 10 },
    { t: 'be', x: 68, y: 700, w: 14, h: 10 },
    { t: 'or', x: 86, y: 700, w: 14, h: 10 },
    { t: 'not', x: 104, y: 700, w: 20, h: 10 },
    { t: 'Pirates', x: 50, y: 650, w: 40, h: 10 },
    { t: 'of', x: 94, y: 650, w: 12, h: 10 },
    { t: 'Penzance', x: 110, y: 650, w: 50, h: 10 },
  ],
  lines: [
    [0, 1, 2, 3],
    [4, 5, 6],
  ],
}

const base = { documentId: 'doc', documentVersionId: 'ver', pageIndex: 2 }

test('with snapping on, a point within 12pt of a line takes its centre and quote', () => {
  expect(anchorAt({ ...base, point: { x: 70, y: 702 }, words: layer, snap: true })).toEqual({
    documentId: 'doc',
    documentVersionId: 'ver',
    pageIndex: 2,
    x: 70,
    y: 705,
    text: { quote: 'be or not', wordStart: 1, wordEnd: 3 },
    status: 'ok',
  })
})

test('a point further than 12pt from every line is placed where clicked, without text', () => {
  expect(anchorAt({ ...base, point: { x: 70, y: 600 }, words: layer, snap: true })).toEqual({
    ...base,
    x: 70,
    y: 600,
    status: 'ok',
  })
})

test('with snapping off, or a page without words, the cue goes exactly where clicked', () => {
  const at = { x: 70, y: 702 }
  const expected = { ...base, ...at, status: 'ok' }
  expect(anchorAt({ ...base, point: at, words: layer, snap: false })).toEqual(expected)
  expect(anchorAt({ ...base, point: at, words: null, snap: true })).toEqual(expected)
})

const cue = (id: string, major: number, minor: number, pageIndex: number, y: number) => ({
  id,
  major,
  minor,
  anchor: { pageIndex, y },
})

test('the first cue in a department is 10', () => {
  expect(numberAt({ pageIndex: 0, y: 500 }, [])).toEqual({ major: 10, minor: 0 })
})

test('a cue after the last in reading order takes the next integer', () => {
  const cues = [cue('a', 10, 0, 0, 700), cue('b', 11, 0, 1, 700)]
  expect(numberAt({ pageIndex: 1, y: 300 }, cues)).toEqual({ major: 12, minor: 0 })
})

test('a cue between two neighbours in reading order takes a point between them', () => {
  // Reading order is page then top to bottom (y descending); the input order does not matter.
  const cues = [cue('c', 12, 0, 1, 100), cue('a', 11, 0, 0, 700), cue('b', 12, 0, 0, 200)]
  expect(numberAt({ pageIndex: 0, y: 400 }, cues)).toEqual({ major: 11, minor: 50 })
})

test('a cue before the first in reading order takes a number below it', () => {
  const cues = [cue('a', 10, 0, 1, 700)]
  expect(numberAt({ pageIndex: 0, y: 100 }, cues)).toEqual({ major: 1, minor: 0 })
})

test('the moving cue and unplaced cues are not neighbours', () => {
  const cues = [cue('a', 10, 0, 0, 700), { id: 'u', major: 40, minor: 0, anchor: null }]
  expect(numberAt({ pageIndex: 0, y: 300 }, [...cues, cue('self', 30, 0, 0, 200)], 'self')).toEqual(
    { major: 11, minor: 0 },
  )
})

test('a dropped cue starts at the nearest word when the pointer is within the line, else the first word', () => {
  const drop = { ...base, words: layer, snap: true, firstWordOutside: true }
  // Within the line's extent (x 50 to 124): the nearest word, and x follows the word.
  expect(anchorAt({ ...drop, point: { x: 90, y: 705 } })).toMatchObject({
    x: 86,
    y: 705,
    text: { quote: 'or not', wordStart: 2, wordEnd: 3 },
    status: 'ok',
  })
  // In the left margin, or right of the line: the line's first word.
  for (const x of [10, 300]) {
    expect(anchorAt({ ...drop, point: { x, y: 705 } })).toMatchObject({
      x: 50,
      text: { quote: 'To be or not', wordStart: 0, wordEnd: 3 },
    })
  }
  // Not near a line: exactly where it was dropped.
  expect(anchorAt({ ...drop, point: { x: 10, y: 600 } })).toMatchObject({ x: 10, y: 600 })
})

describe('markAnchorAt', () => {
  const input = { ...base, words: layer, snap: true }

  test('underline is anchorAt as before with no mark key', () => {
    const point = { x: 70, y: 702 }
    const anchor = markAnchorAt({ ...input, point, mark: 'underline' })
    expect(anchor).toEqual(anchorAt({ ...input, point }))
    expect('mark' in anchor).toBe(false)
  })

  test("highlight with snap takes the one word under the pointer, mark highlight, x the word's left", () => {
    expect(markAnchorAt({ ...input, point: { x: 90, y: 702 }, mark: 'highlight' })).toEqual({
      ...base,
      x: 86,
      y: 705,
      text: { quote: 'or', wordStart: 2, wordEnd: 2 },
      status: 'ok',
      mark: 'highlight',
    })
  })

  test('line with snap stores mark line, text.offset and x at the caret', () => {
    const point = { x: 90, y: 702 }
    const caret = snapToCaret(layer, point)
    if (!caret) throw new Error('no caret')
    const anchor = markAnchorAt({ ...input, point, mark: 'line' })
    expect(anchor).toEqual({
      ...base,
      x: caret.x,
      y: 705,
      text: caret.text,
      status: 'ok',
      mark: 'line',
    })
    expect(anchor.text?.offset).toBeTypeOf('number')
    expect(anchor.x).not.toBe(point.x)
  })

  test('pointer likewise', () => {
    const point = { x: 108, y: 698 }
    const caret = snapToCaret(layer, point)
    if (!caret) throw new Error('no caret')
    expect(markAnchorAt({ ...input, point, mark: 'pointer' })).toEqual({
      ...base,
      x: caret.x,
      y: 705,
      text: caret.text,
      status: 'ok',
      mark: 'pointer',
    })
  })

  test('line with snap off or no line near is a free bar: no text, x and y at the pointer, mark line', () => {
    const near = { x: 70, y: 702 }
    expect(markAnchorAt({ ...input, snap: false, point: near, mark: 'line' })).toEqual({
      ...base,
      ...near,
      status: 'ok',
      mark: 'line',
    })
    const far = { x: 70, y: 600 }
    expect(markAnchorAt({ ...input, point: far, mark: 'line' })).toEqual({
      ...base,
      ...far,
      status: 'ok',
      mark: 'line',
    })
    expect(markAnchorAt({ ...input, words: null, point: near, mark: 'pointer' })).toEqual({
      ...base,
      ...near,
      status: 'ok',
      mark: 'pointer',
    })
  })

  test('highlight with snap off is the old unbound tick anchor', () => {
    const point = { x: 70, y: 702 }
    expect(markAnchorAt({ ...input, snap: false, point, mark: 'highlight' })).toEqual({
      ...base,
      ...point,
      status: 'ok',
      mark: 'highlight',
    })
  })
})
