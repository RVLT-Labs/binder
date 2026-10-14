import type { WordLayer } from '@binder/shared'
import { describe, expect, test } from 'vitest'
import { highlightBoxes, highlightPoint, wordRangeFromDrag } from './wordRange'

/** Three lines of ten-point words, top to bottom, 40 points wide each with a 5 point gap. */
function layer(): WordLayer {
  const text = [
    'one two three four five six seven eight nine ten',
    'alpha beta gamma delta',
    'red green blue',
  ]
  const words: WordLayer['words'] = []
  const lines: number[][] = []
  text.forEach((line, row) => {
    const indices: number[] = []
    line.split(' ').forEach((t, col) => {
      indices.push(words.length)
      words.push({ t, x: 50 + col * 45, y: 700 - row * 20, w: 40, h: 10 })
    })
    lines.push(indices)
  })
  return { words, lines }
}
const centre = (i: number) => {
  const w = layer().words[i]
  if (!w) throw new Error('no word')
  return { x: w.x + w.w / 2, y: w.y + w.h / 2 }
}

describe('wordRangeFromDrag', () => {
  test('dragging over words selects the range in reading order with a quote of at most eight words', () => {
    // From "two" (1) down to "beta" (11): ten words, so the quote stops at eight.
    const range = wordRangeFromDrag(layer(), centre(1), centre(11))
    expect(range).toEqual({
      quote: 'two three four five six seven eight nine',
      wordStart: 1,
      wordEnd: 11,
    })
  })

  test('a drag in either direction gives the same range', () => {
    expect(wordRangeFromDrag(layer(), centre(11), centre(1))).toEqual(
      wordRangeFromDrag(layer(), centre(1), centre(11)),
    )
  })

  test('the ends map to their nearest words', () => {
    // A point in the gap just right of "three" and one in the margin left of "alpha".
    const range = wordRangeFromDrag(layer(), { x: 50 + 2 * 45 + 42, y: 705 }, { x: 10, y: 685 })
    expect(range).toMatchObject({ wordStart: 2, wordEnd: 10 })
  })

  test('a short range keeps all its words', () =>
    expect(wordRangeFromDrag(layer(), centre(12), centre(13))).toEqual({
      quote: 'gamma delta',
      wordStart: 12,
      wordEnd: 13,
    }))

  test('a page with no words gives nothing', () =>
    expect(wordRangeFromDrag({ words: [], lines: [] }, { x: 0, y: 0 }, { x: 5, y: 5 })).toBeNull())
})

describe('highlightPoint', () => {
  test('is the first word x and its line centre', () =>
    // "alpha" is at x 50, y 680, h 10: its line centre is 685.
    expect(highlightPoint(layer(), { quote: 'alpha beta', wordStart: 10, wordEnd: 11 })).toEqual({
      x: 50,
      y: 685,
    }))

  test('is null for an unbound range', () =>
    expect(highlightPoint(layer(), { quote: 'q', wordStart: -1, wordEnd: -1 })).toBeNull())
})

describe('highlightBoxes', () => {
  test('is one rectangle per covered line', () => {
    const boxes = highlightBoxes(layer(), { quote: 'q', wordStart: 8, wordEnd: 11 })
    // "nine ten" on line 0, "alpha beta" on line 1.
    expect(boxes).toEqual([
      { x: 50 + 8 * 45, y: 700, w: 45 + 40, h: 10 },
      { x: 50, y: 680, w: 45 + 40, h: 10 },
    ])
  })

  test('a range inside one line is one rectangle', () =>
    expect(highlightBoxes(layer(), { quote: 'q', wordStart: 14, wordEnd: 14 })).toEqual([
      { x: 50, y: 660, w: 40, h: 10 },
    ]))

  test('an unbound range, or one past the words, has none', () => {
    expect(highlightBoxes(layer(), { quote: 'q', wordStart: -1, wordEnd: -1 })).toEqual([])
    expect(highlightBoxes(layer(), { quote: 'q', wordStart: 90, wordEnd: 95 })).toEqual([])
  })
})
