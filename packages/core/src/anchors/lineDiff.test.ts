import { readFileSync } from 'node:fs'
import * as jsdiff from 'diff'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { versionFromLines } from '../../test/textLayers'
import { diffVersionLines, diffVersionLinesBounded } from './lineDiff'

// The real diff, watched: the bounded diff must not start its search when it cannot fit.
vi.mock('diff', async (importOriginal) => {
  const actual = await importOriginal<typeof import('diff')>()
  return { ...actual, diffArrays: vi.fn(actual.diffArrays) }
})

const pirates = readFileSync(
  new URL('../../../../fixtures/public/pirates.txt', import.meta.url),
  'utf8',
).split('\n')

const words = (line: string) => line.split(/\s+/).filter((w) => w !== '')
const ref = (i: number, perPage = 48) => ({
  pageIndex: Math.floor(i / perPage),
  lineIndex: i % perPage,
})

/** Start of ten consecutive non-blank lines. */
function nonBlankRun(from: number, n: number): number {
  for (let i = from; i < pirates.length; i++) {
    if (pirates.slice(i, i + n).every((l) => words(l).length > 0)) return i
  }
  throw new Error('no run')
}

describe('diffVersionLines', () => {
  const old = versionFromLines(pirates, { versionId: 'v1' })

  test('identical versions are all same', () => {
    const d = diffVersionLines(old, versionFromLines(pirates, { versionId: 'v2' }))
    const nonBlank = pirates.filter((l) => words(l).length > 0).length
    expect(d.added).toBe(0)
    expect(d.removed).toBe(0)
    expect(d.entries).toHaveLength(nonBlank)
    expect(d.entries.every((e) => e.op === 'same' && e.old && e.new)).toBe(true)
    expect(d.entries.every((e) => JSON.stringify(e.old) === JSON.stringify(e.new))).toBe(true)
  })

  test('cut lines are removed with old refs, added lines added with new refs', () => {
    const cutAt = nonBlankRun(100, 10)
    const addAt = nonBlankRun(600, 1)
    const added = ['ZZ one fresh line', 'ZZ two fresh line', 'ZZ three fresh line']
    const edited = [...pirates]
    edited.splice(addAt, 0, ...added)
    edited.splice(cutAt, 10) // before addAt, so indices after it shift by -10 + 3
    const d = diffVersionLines(old, versionFromLines(edited, { versionId: 'v2' }))

    expect(d.removed).toBe(10)
    expect(d.added).toBe(3)

    const removed = d.entries.filter((e) => e.op === 'removed')
    expect(removed.map((e) => e.text)).toEqual(
      pirates.slice(cutAt, cutAt + 10).map((l) => words(l).join(' ')),
    )
    expect(removed.map((e) => e.old)).toEqual(Array.from({ length: 10 }, (_, k) => ref(cutAt + k)))
    expect(removed.every((e) => e.new === undefined)).toBe(true)

    const addedEntries = d.entries.filter((e) => e.op === 'added')
    expect(addedEntries.map((e) => e.text)).toEqual(added)
    // Added lines sit at addAt - 10 .. in the edited text.
    expect(addedEntries.map((e) => e.new)).toEqual(
      Array.from({ length: 3 }, (_, k) => ref(addAt - 10 + k)),
    )
    expect(addedEntries.every((e) => e.old === undefined)).toBe(true)

    const same = d.entries.filter((e) => e.op === 'same')
    const nonBlank = pirates.filter((l) => words(l).length > 0).length
    expect(same).toHaveLength(nonBlank - 10)
    // Entries come in reading order: old refs ascend among same and removed entries.
    const olds = d.entries.flatMap((e) => (e.old ? [e.old.pageIndex * 1000 + e.old.lineIndex] : []))
    expect([...olds].sort((a, b) => a - b)).toEqual(olds)
  })

  test('lines compare by normalised tokens, so case and punctuation changes are same', () => {
    const edited = [...pirates]
    const i = nonBlankRun(300, 1)
    edited[i] = (edited[i] as string).toUpperCase()
    const d = diffVersionLines(old, versionFromLines(edited, { versionId: 'v2' }))
    expect(d.added).toBe(0)
    expect(d.removed).toBe(0)
  })
})

describe('diffVersionLinesBounded', () => {
  const lines = (prefix: string, n: number) =>
    Array.from({ length: n }, (_, i) => `${prefix} word${i} extra${i}`)

  test('gives the same diff as diffVersionLines when the edit is within the bound', () => {
    const old = versionFromLines(pirates, { versionId: 'v1' })
    const cut = versionFromLines([...pirates.slice(0, 100), ...pirates.slice(130)], {
      versionId: 'v2',
    })
    expect(diffVersionLinesBounded(old, cut, 2000)).toEqual(diffVersionLines(old, cut))
  })

  test('gives up on a near-total rewrite instead of diffing it', () => {
    const old = versionFromLines(lines('alpha', 3000), { versionId: 'v1' })
    const rewritten = versionFromLines(lines('beta', 3000), { versionId: 'v2' })
    expect(diffVersionLinesBounded(old, rewritten, 500)).toBeUndefined()
  })
})

describe('diffVersionLinesBounded gives up early, never wrongly', () => {
  const spy = vi.mocked(jsdiff.diffArrays)
  beforeEach(() => {
    spy.mockClear()
  })
  const v = (ls: string[], id: string) => versionFromLines(ls, { versionId: id })
  const distinct = (prefix: string, n: number) =>
    Array.from({ length: n }, (_, i) => `${prefix} line ${i} alpha beta gamma`)

  test('two long versions with no line in common give up without starting the search', () => {
    // The API's worst case: 6000 lines each, nothing shared, a 4000-line budget.
    const old = v(distinct('first', 6000), 'v1')
    const rewritten = v(distinct('second', 6000), 'v2')
    const started = performance.now()
    expect(diffVersionLinesBounded(old, rewritten, 4000)).toBeUndefined()
    expect(spy).not.toHaveBeenCalled()
    // Linear work only: far under the API's 2 s guard even on a slow runner.
    expect(performance.now() - started).toBeLessThan(1000)
  })

  /** Each case at its exact edit distance D: within at D and D + 1, given up at D - 1. */
  const cases: Array<[string, string[], string[]]> = [
    [
      'a cut and an insert',
      distinct('a', 100),
      [...distinct('a', 100).slice(10), ...distinct('n', 10)],
    ],
    [
      'a reversed order (same lines, so no early give-up)',
      distinct('r', 40),
      distinct('r', 40).reverse(),
    ],
    [
      'duplicated lines on both sides',
      ['x', 'x', 'x', 'x', 'x', 'y', 'z'],
      ['x', 'x', 'y', 'y', 'y', 'z', 'w'],
    ],
    ['identical', distinct('s', 50), distinct('s', 50)],
    ['nothing in common, short', distinct('p', 30), distinct('q', 30)],
  ]
  test.each(cases)('%s: the bound decides exactly as the full diff', (_name, a, b) => {
    const full = diffVersionLines(v(a, 'v1'), v(b, 'v2'))
    const d = full.added + full.removed
    expect(diffVersionLinesBounded(v(a, 'v1'), v(b, 'v2'), d)).toEqual(full)
    expect(diffVersionLinesBounded(v(a, 'v1'), v(b, 'v2'), d + 1)).toEqual(full)
    if (d > 0) expect(diffVersionLinesBounded(v(a, 'v1'), v(b, 'v2'), d - 1)).toBeUndefined()
  })

  test('the 4000-line budget itself: 2000 lines out and 2000 in is diffed, one more is not', () => {
    const base = distinct('k', 3000)
    const within = [...base.slice(2000), ...distinct('n', 2000)]
    const over = [...base.slice(2001), ...distinct('n', 2001)]
    const d = diffVersionLinesBounded(v(base, 'v1'), v(within, 'v2'), 4000)
    expect(d?.removed).toBe(2000)
    expect(d?.added).toBe(2000)
    expect(diffVersionLinesBounded(v(base, 'v1'), v(over, 'v2'), 4000)).toBeUndefined()
  })
})
