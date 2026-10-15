import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { versionFromLines } from '../../test/textLayers'
import { diffVersionLines, diffVersionLinesBounded } from './lineDiff'

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
