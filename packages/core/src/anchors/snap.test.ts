import type { WordLayer } from '@binder/shared'
import { describe, expect, test } from 'vitest'
import { cutQuote, lineCentreY, rangeText, snapToLine, snapToWord } from './snap'

const layer: WordLayer = {
  words: [
    { t: 'THE', x: 72, y: 700, w: 28, h: 12 },
    { t: 'PIRATES', x: 104, y: 700, w: 36, h: 12 },
    { t: 'OF', x: 144, y: 700, w: 14, h: 12 },
    { t: 'PENZANCE', x: 162, y: 700, w: 60, h: 12 },
    { t: 'ACT', x: 72, y: 680, w: 24, h: 12 },
  ],
  lines: [[0, 1, 2, 3], [4]],
}

describe('snapping', () => {
  test('line centre is the mean word centre', () => {
    expect(lineCentreY(layer, 0)).toBe(706)
    expect(lineCentreY(layer, 1)).toBe(686)
  })

  test('snaps within 12 points and quotes from the nearest word', () => {
    expect(snapToLine(layer, { x: 110, y: 712 })).toEqual({
      y: 706,
      text: { quote: 'PIRATES OF PENZANCE', wordStart: 1, wordEnd: 3 },
    })
  })

  test('does not snap beyond 12 points', () => {
    expect(snapToLine(layer, { x: 110, y: 718.5 })).toBeNull()
    expect(snapToLine(layer, { x: 110, y: 718 })?.y).toBe(706)
  })

  test('the nearer of two lines wins', () => {
    expect(snapToLine(layer, { x: 80, y: 690 })?.text.wordStart).toBe(4)
    expect(snapToLine(layer, { x: 80, y: 700 })?.text.wordStart).toBe(0)
  })

  test('the quote stops at eight words and at the line end', () => {
    const words = Array.from({ length: 12 }, (_, i) => ({
      t: `w${i}`,
      x: 10 + i * 30,
      y: 500,
      w: 28,
      h: 10,
    }))
    const long: WordLayer = { words, lines: [words.map((_, i) => i)] }
    const hit = snapToLine(long, { x: 12, y: 505 })
    expect(hit?.text).toEqual({
      quote: 'w0 w1 w2 w3 w4 w5 w6 w7',
      wordStart: 0,
      wordEnd: 7,
    })
    // Starting near the end, the quote runs out with the line.
    expect(snapToLine(long, { x: 10 + 10 * 30 + 5, y: 505 })?.text).toEqual({
      quote: 'w10 w11',
      wordStart: 10,
      wordEnd: 11,
    })
  })

  test('the nearest word is by horizontal distance, leftmost on a tie, and gaps pick the closer side', () => {
    // x 102 is 2 right of THE (ends 100) and 2 left of PIRATES (starts 104): a tie goes left.
    expect(snapToLine(layer, { x: 102, y: 706 })?.text.wordStart).toBe(0)
    expect(snapToLine(layer, { x: 103, y: 706 })?.text.wordStart).toBe(1)
    expect(snapToLine(layer, { x: 120, y: 706 })?.text.wordStart).toBe(1)
    expect(snapToLine(layer, { x: 500, y: 706 })?.text.wordStart).toBe(3)
  })

  test('lines without words are skipped; a layer with no words does not snap', () => {
    expect(snapToLine({ words: [], lines: [[]] }, { x: 0, y: 0 })).toBeNull()
    const withEmpty: WordLayer = { words: layer.words, lines: [[], ...layer.lines] }
    expect(snapToLine(withEmpty, { x: 110, y: 712 })?.y).toBe(706)
  })

  test('a custom max distance applies', () => {
    expect(snapToLine(layer, { x: 110, y: 712 }, 5)).toBeNull()
  })
})

describe('a dropped cue (the first word outside the line)', () => {
  const drop = { firstWordOutside: true }

  test('within the line extent it starts at the nearest word, as before', () => {
    expect(snapToLine(layer, { x: 110, y: 706 }, 12, drop)?.text.wordStart).toBe(1)
    expect(snapToLine(layer, { x: 150, y: 706 }, 12, drop)?.text.wordStart).toBe(2)
  })

  test('left of the line, in the margin, it starts at the first word', () => {
    expect(snapToLine(layer, { x: 10, y: 706 }, 12, drop)?.text).toEqual({
      quote: 'THE PIRATES OF PENZANCE',
      wordStart: 0,
      wordEnd: 3,
    })
  })

  test('right of the line it starts at the first word too, where the plain rule picks the last', () => {
    expect(snapToLine(layer, { x: 400, y: 706 })?.text.wordStart).toBe(3)
    expect(snapToLine(layer, { x: 400, y: 706 }, 12, drop)?.text.wordStart).toBe(0)
  })

  test('a point too far from every line still does not snap', () => {
    expect(snapToLine(layer, { x: 10, y: 600 }, 12, drop)).toBeNull()
  })
})

describe('cutQuote', () => {
  test('short text is unchanged', () => {
    expect(cutQuote(['a', 'bc', 'def'])).toBe('a bc def')
  })

  test('long text is cut on a word boundary at or under 400 characters', () => {
    const words = Array.from({ length: 200 }, () => 'abcd')
    const out = cutQuote(words)
    expect(out.length).toBeLessThanOrEqual(400)
    expect(out.length).toBeGreaterThan(390)
    expect(out.split(' ').every((w) => w === 'abcd')).toBe(true)
  })

  test('one huge word is kept whole', () => {
    const huge = 'x'.repeat(500)
    expect(cutQuote([huge, 'tail'])).toBe(huge)
  })
})

describe('rangeText', () => {
  test('indices in either order give the same range', () => {
    const a = rangeText(layer, 1, 3)
    expect(a).toEqual(rangeText(layer, 3, 1))
    expect(a).toEqual({ quote: 'PIRATES OF PENZANCE', wordStart: 1, wordEnd: 3 })
  })

  test('a 60-word range cuts at 400 characters but wordEnd stays the last word', () => {
    const words = Array.from({ length: 60 }, (_, i) => ({
      t: 'abcdefghi',
      x: 10 + i * 10,
      y: 700,
      w: 9,
      h: 12,
    }))
    const long: WordLayer = { words, lines: [words.map((_, i) => i)] }
    const r = rangeText(long, 0, 59)
    expect(r.quote.length).toBeLessThanOrEqual(400)
    expect(r.quote.length).toBeGreaterThan(380)
    expect(r.wordStart).toBe(0)
    expect(r.wordEnd).toBe(59)
  })
})

describe('snapToWord', () => {
  test('picks the word under the pointer', () => {
    expect(snapToWord(layer, { x: 110, y: 706 })).toEqual({
      x: 104,
      y: 706,
      text: { quote: 'PIRATES', wordStart: 1, wordEnd: 1 },
    })
  })

  test('left of the line picks the first word', () => {
    expect(snapToWord(layer, { x: 10, y: 706 })?.text.wordStart).toBe(0)
  })

  test('no line in range gives null', () => {
    expect(snapToWord(layer, { x: 110, y: 400 })).toBeNull()
  })
})
