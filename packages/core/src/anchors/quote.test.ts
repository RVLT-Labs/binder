import type { WordLayer } from '@binder/shared'
import { describe, expect, test } from 'vitest'
import { anchorAtMatch, buildWordStream, findQuote, normaliseForMatch } from './quote'
import type { VersionText } from './types'

/** A layer from lines of text; each line is `y` points above the next, words 30 wide. */
function layerOf(lines: string[], top = 700): WordLayer {
  const words: WordLayer['words'] = []
  const idx: number[][] = []
  lines.forEach((text, li) => {
    const row: number[] = []
    text.split(' ').forEach((t, wi) => {
      row.push(words.length)
      words.push({ t, x: 72 + wi * 34, y: top - li * 20, w: 30, h: 12 })
    })
    idx.push(row)
  })
  return { words, lines: idx }
}

const text = (layers: Map<number, WordLayer>): VersionText => ({
  versionId: 'v',
  documentId: 'd',
  pageCount: layers.size,
  pages: [...layers.keys()].map(() => ({ width: 612, height: 792 })),
  layers,
})

const page0 = layerOf([
  'I am the very model',
  'of a modern Major-General',
  'Pirate King and the pi-',
])
const page1 = layerOf(['rate crew. Frederic, ahoy!', 'Pirate King again'])
const layers = new Map([
  [0, page0],
  [1, page1],
])
const stream = buildWordStream(layers)
const joined = (m: { start: number; end: number }) =>
  stream
    .slice(m.start, m.end + 1)
    .map((w) => w.t)
    .join(' ')

describe('word stream', () => {
  test('the stream orders pages ascending and lines top to bottom', () => {
    // Lines stored bottom to top and pages inserted out of order still stream in reading order.
    const upside: WordLayer = {
      words: [
        { t: 'low', x: 10, y: 100, w: 20, h: 10 },
        { t: 'high', x: 10, y: 300, w: 20, h: 10 },
        { t: 'right', x: 200, y: 300, w: 20, h: 10 },
      ],
      lines: [[0], [2, 1]],
    }
    const s = buildWordStream(
      new Map([
        [1, layerOf(['second page'])],
        [0, upside],
      ]),
    )
    expect(s.map((w) => `${w.pageIndex}:${w.t}`)).toEqual([
      '0:right',
      '0:high',
      '0:low',
      '1:second',
      '1:page',
    ])
    expect(s[0]).toEqual({ pageIndex: 0, wordIndex: 2, lineIndex: 1, t: 'right' })
  })

  test('lines at the same height order by their first word x', () => {
    const l: WordLayer = {
      words: [
        { t: 'b', x: 300, y: 50, w: 10, h: 10 },
        { t: 'a', x: 10, y: 50, w: 10, h: 10 },
      ],
      lines: [[0], [1]],
    }
    expect(buildWordStream(new Map([[0, l]])).map((w) => w.t)).toEqual(['a', 'b'])
  })
})

describe('normaliseForMatch', () => {
  test('lowercases, strips diacritics and every non letter or number', () => {
    expect(normaliseForMatch('Frederic,')).toBe('frederic')
    expect(normaliseForMatch('Major-General')).toBe('majorgeneral')
    expect(normaliseForMatch('Café!')).toBe('cafe')
    expect(normaliseForMatch('---')).toBe('')
  })
})

describe('exact matching', () => {
  test('crosses a line break and a page break', () => {
    const across = findQuote(stream, 'model of a', 'exact')
    expect(across).toHaveLength(1)
    expect(joined(across[0] as { start: number; end: number })).toBe('model of a')
    expect(stream[across[0]?.start ?? 0]?.lineIndex).toBe(0)
    expect(stream[across[0]?.end ?? 0]?.lineIndex).toBe(1)

    const pages = findQuote(stream, 'and the pi- rate crew.', 'exact')
    expect(pages).toHaveLength(1)
    const [m] = pages as [{ start: number; end: number }]
    expect(stream[m.start]?.pageIndex).toBe(0)
    expect(stream[m.end]?.pageIndex).toBe(1)
  })

  test('is case-sensitive and verbatim', () => {
    expect(findQuote(stream, 'pirate king', 'exact')).toEqual([])
    expect(findQuote(stream, 'Pirate King', 'exact')).toHaveLength(2)
    expect(findQuote(stream, 'Frederic ahoy', 'exact')).toEqual([])
  })

  test('every occurrence is returned in stream order', () => {
    const hits = findQuote(stream, 'Pirate King', 'exact')
    expect(hits.map((m) => stream[m.start]?.pageIndex)).toEqual([0, 1])
    expect(hits[0]?.start).toBeLessThan(hits[1]?.start ?? 0)
    expect(hits.every((m) => m.end === m.start + 1)).toBe(true)
  })

  test('an empty quote matches nothing', () => {
    expect(findQuote(stream, '   ', 'exact')).toEqual([])
    expect(findQuote(stream, '', 'normalised')).toEqual([])
  })
})

describe('normalised matching', () => {
  test('ignores case and punctuation: "Frederic, ahoy!" finds "frederic ahoy"', () => {
    const hits = findQuote(stream, 'frederic ahoy', 'normalised')
    expect(hits).toHaveLength(1)
    expect(joined(hits[0] as { start: number; end: number })).toBe('Frederic, ahoy!')
    expect(findQuote(stream, 'FREDERIC, AHOY!', 'normalised')).toHaveLength(1)
    expect(findQuote(stream, 'major general', 'normalised')).toEqual([])
    expect(findQuote(stream, 'major-general', 'normalised')).toHaveLength(1)
  })

  test('drops tokens that are only punctuation on both sides', () => {
    expect(findQuote(stream, 'the - very', 'normalised')).toHaveLength(1)
  })

  test('joins a hyphenated line end: "pi-" then "rate" matches "pirate"', () => {
    const hits = findQuote(stream, 'and the pirate crew', 'normalised')
    expect(hits).toHaveLength(1)
    const [m] = hits as [{ start: number; end: number }]
    expect(joined(m)).toBe('and the pi- rate crew.')
    expect(findQuote(stream, 'pirate', 'normalised')).toHaveLength(3)
    // A hyphen inside a line stays one word (no split, no join).
    expect(findQuote(stream, 'modern majorgeneral', 'normalised')).toHaveLength(1)
  })

  test('a final token ending in a hyphen matches as a prefix', () => {
    const hits = findQuote(stream, 'a modern Major-', 'normalised')
    expect(hits).toHaveLength(1)
    expect(joined(hits[0] as { start: number; end: number })).toBe('a modern Major-General')
    // Only the final token is a prefix match.
    expect(findQuote(stream, 'mod- major', 'normalised')).toEqual([])
  })
})

describe('anchorAtMatch', () => {
  const to = text(layers)

  test('anchors at the first word: page, x, line centre, line left, quote', () => {
    const [m] = findQuote(stream, 'Major-General', 'exact') as [{ start: number; end: number }]
    const a = anchorAtMatch(stream, m, to)
    expect(a.pageIndex).toBe(0)
    expect(a.x).toBe(72 + 3 * 34)
    expect(a.y).toBe(680 + 6)
    expect(a.lineLeft).toBe(72)
    expect(a.text).toEqual({ quote: 'Major-General', wordStart: 8, wordEnd: 8 })
  })

  test('a quote spanning pages clips wordEnd to the start page', () => {
    const [m] = findQuote(stream, 'and the pi- rate crew.', 'exact') as [
      { start: number; end: number },
    ]
    const a = anchorAtMatch(stream, m, to)
    expect(a.pageIndex).toBe(0)
    expect(a.text.quote).toBe('and the pi- rate crew.')
    expect(a.text.wordStart).toBe(11)
    expect(a.text.wordEnd).toBe(page0.words.length - 1)
  })

  test('the quote is capped at eight words', () => {
    const [m] = findQuote(stream, 'I am the very model of a modern', 'exact') as [
      { start: number; end: number },
    ]
    expect(m.end - m.start + 1).toBe(8)
    const long = { start: 0, end: 10 }
    const a = anchorAtMatch(stream, long, to)
    expect(a.text.quote.split(' ')).toHaveLength(8)
    expect(a.text.wordEnd).toBe(7)
  })
})
