import type { WordLayer } from '@binder/shared'
import { describe, expect, test } from 'vitest'
import { wordBoxes } from './wordBoxes'

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
describe('wordBoxes', () => {
  test('is one rectangle per covered line', () => {
    const boxes = wordBoxes(layer(), { quote: 'q', wordStart: 8, wordEnd: 11 })
    // "nine ten" on line 0, "alpha beta" on line 1.
    expect(boxes).toEqual([
      { x: 50 + 8 * 45, y: 700, w: 45 + 40, h: 10 },
      { x: 50, y: 680, w: 45 + 40, h: 10 },
    ])
  })

  test('a range inside one line is one rectangle', () =>
    expect(wordBoxes(layer(), { quote: 'q', wordStart: 14, wordEnd: 14 })).toEqual([
      { x: 50, y: 660, w: 40, h: 10 },
    ]))

  test('an unbound range, or one past the words, has none', () => {
    expect(wordBoxes(layer(), { quote: 'q', wordStart: -1, wordEnd: -1 })).toEqual([])
    expect(wordBoxes(layer(), { quote: 'q', wordStart: 90, wordEnd: 95 })).toEqual([])
  })
})
