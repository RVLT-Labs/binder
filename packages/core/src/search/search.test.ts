import type { Word, WordLayer } from '@binder/shared'
import { describe, expect, test } from 'vitest'
import { normaliseToken } from './normalise'
import { searchDocument, searchWordLayer } from './search'

function layer(lines: string[][]): WordLayer {
  const words: Word[] = []
  const idx: number[][] = []
  for (const line of lines) {
    idx.push(
      line.map((t) => {
        words.push({ t, x: 0, y: 0, w: 1, h: 1 })
        return words.length - 1
      }),
    )
  }
  return { words, lines: idx }
}

describe('normaliseToken', () => {
  test('strips diacritics, case and edge punctuation, keeps inner apostrophes and hyphens', () => {
    expect(normaliseToken('Frédéric,')).toBe('frederic')
    expect(normaliseToken('"O\'er"')).toBe("o'er")
    expect(normaliseToken('Well-a-day!')).toBe('well-a-day')
    expect(normaliseToken('—')).toBe('')
  })
})

describe('searchWordLayer', () => {
  test('matches case-insensitively and ignores punctuation', () => {
    const l = layer([['Hello', 'Frederic,', 'said']])
    expect(searchWordLayer(l, 'FREDERIC')).toEqual([{ lineIndex: 0, wordStart: 1, wordEnd: 1 }])
  })
  test('matches diacritics', () => {
    expect(searchWordLayer(layer([['Frédéric']]), 'frederic')).toHaveLength(1)
  })
  test('matches a phrase across consecutive words in a line', () => {
    const l = layer([['the', 'Pirate', 'King', 'sings']])
    expect(searchWordLayer(l, 'pirate king')).toEqual([{ lineIndex: 0, wordStart: 1, wordEnd: 2 }])
  })
  test('does not match across a line boundary', () => {
    expect(searchWordLayer(layer([['pirate'], ['king']]), 'pirate king')).toEqual([])
  })
  test('empty, whitespace or punctuation-only query returns nothing', () => {
    const l = layer([['pirate', '—', 'king']])
    expect(searchWordLayer(l, '')).toEqual([])
    expect(searchWordLayer(l, '   ')).toEqual([])
    expect(searchWordLayer(l, '— ...')).toEqual([])
  })
  test('keeps inner apostrophes and hyphens', () => {
    const l = layer([["o'er", 'well-a-day']])
    expect(searchWordLayer(l, "o'er")).toHaveLength(1)
    expect(searchWordLayer(l, 'oer')).toEqual([])
    expect(searchWordLayer(l, 'well-a-day')).toHaveLength(1)
  })
  test('punctuation-only words and query tokens are skipped', () => {
    const l = layer([['pirate', '—', 'king']])
    expect(searchWordLayer(l, 'pirate, king')).toEqual([{ lineIndex: 0, wordStart: 0, wordEnd: 2 }])
    expect(searchWordLayer(l, 'pirate — king')).toHaveLength(1)
  })
})

describe('searchDocument', () => {
  const layers = new Map<number, WordLayer>([
    [2, layer([['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'Frederic', 'i']])],
    [
      0,
      layer([
        ['x', 'frederic,', 'y'],
        ['z', 'z', 'frederic'],
      ]),
    ],
  ])
  test('orders by page then word and builds snippets with line-bound context', () => {
    const hits = searchDocument(layers, 'frederic')
    expect(hits.map((h) => [h.pageIndex, h.lineIndex, h.wordStart])).toEqual([
      [0, 0, 1],
      [0, 1, 5],
      [2, 0, 8],
    ])
    expect(hits[0]?.snippet).toBe('x frederic, y')
    expect(hits[1]?.snippet).toBe('z z frederic')
    expect(hits[2]?.snippet).toBe('e f g h Frederic i')
  })
  test('applies limit after ordering', () => {
    const hits = searchDocument(layers, 'frederic', 2)
    expect(hits.map((h) => h.pageIndex)).toEqual([0, 0])
  })
})
