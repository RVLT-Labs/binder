import type { LineDiffEntry, VersionText } from '@binder/core'
import type { WordLayer } from '@binder/shared'
import { expect, test } from 'vitest'
import { changeList, compareTexts, incompleteMessage, lineBox, tintedLines } from './compareModel'

const same = (text: string, o: [number, number], n: [number, number]): LineDiffEntry => ({
  op: 'same',
  text,
  old: { pageIndex: o[0], lineIndex: o[1] },
  new: { pageIndex: n[0], lineIndex: n[1] },
})
const removed = (text: string, o: [number, number]): LineDiffEntry => ({
  op: 'removed',
  text,
  old: { pageIndex: o[0], lineIndex: o[1] },
})
const added = (text: string, n: [number, number]): LineDiffEntry => ({
  op: 'added',
  text,
  new: { pageIndex: n[0], lineIndex: n[1] },
})

const entries: LineDiffEntry[] = [
  same('keep one', [0, 0], [0, 0]),
  removed('cut me', [0, 1]),
  removed('cut me too', [1, 0]),
  same('keep two', [1, 1], [0, 1]),
  added('new line', [1, 0]),
]

test('the change list holds only changes, each with the page to show on both sides', () => {
  const list = changeList(entries)
  expect(list.map((c) => [c.op, c.text])).toEqual([
    ['removed', 'cut me'],
    ['removed', 'cut me too'],
    ['added', 'new line'],
  ])
  // A removed line shows on its own old page; the new side follows the nearest unchanged line before.
  expect(list[0]).toMatchObject({ oldPage: 0, newPage: 0 })
  expect(list[1]).toMatchObject({ oldPage: 1, newPage: 0 })
  // An added line shows on its own new page; the old side follows the nearest unchanged line before.
  expect(list[2]).toMatchObject({ oldPage: 1, newPage: 1 })
})

test('with nothing unchanged near it, the other side opens on its first page', () => {
  const list = changeList([removed('only', [2, 0])])
  expect(list[0]).toMatchObject({ oldPage: 2, newPage: 0 })
})

const layer: WordLayer = {
  words: [
    { t: 'a', x: 10, y: 100, w: 10, h: 8 },
    { t: 'b', x: 30, y: 101, w: 20, h: 8 },
    { t: 'c', x: 10, y: 80, w: 10, h: 8 },
  ],
  lines: [[0, 1], [2]],
}

test('a line’s box covers its words', () => {
  expect(lineBox(layer, 0)).toEqual({ x: 10, y: 100, w: 40, h: 9 })
  expect(lineBox(layer, 5)).toBeNull()
})

test('tinted lines gather the changed lines of one side by page', () => {
  const map = tintedLines(entries, 'old')
  expect([...map.keys()]).toEqual([0, 1])
  expect(map.get(0)).toEqual([{ lineIndex: 1 }])
  expect(map.get(1)).toEqual([{ lineIndex: 0 }])
  const news = tintedLines(entries, 'new')
  expect(news.get(1)).toEqual([{ lineIndex: 0 }])
})

const textOf = (id: string, lines: string[]): VersionText => {
  const words = lines.map((t, i) => ({ t, x: 0, y: 800 - i * 10, w: 10, h: 8 }))
  return {
    versionId: id,
    documentId: 'd',
    pageCount: 1,
    pages: [{ width: 600, height: 800 }],
    layers: new Map([[0, { words, lines: words.map((_, i) => [i]) }]]),
  }
}
const lines = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`)

test('a comparison with unreadable pages is incomplete and has no diff', () => {
  const out = compareTexts(
    { text: textOf('a', lines('x', 3)), unavailable: 1 },
    { text: textOf('b', lines('x', 3)), unavailable: 2 },
  )
  expect(out).toEqual({ kind: 'incomplete', unavailable: 3 })
  expect(incompleteMessage(1)).toBe(
    '1 page has no text available offline, so the comparison is incomplete.',
  )
  expect(incompleteMessage(3)).toMatch(/^3 pages have /)
})

test('versions that differ by more than the bound give up instead of diffing', () => {
  const old = { text: textOf('a', lines('a', 50)), unavailable: 0 }
  const next = { text: textOf('b', lines('b', 50)), unavailable: 0 }
  expect(compareTexts(old, next, 10)).toEqual({ kind: 'too-many' })
  expect(compareTexts(old, next, 1000).kind).toBe('diff')
})
