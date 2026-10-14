import { expect, test } from 'vitest'
import { renumberByBlocks } from './renumber'

const at = (
  id: string,
  page: number,
  y: number,
  groupKey: string | null = null,
  major = 99,
  minor = 0,
) => ({ id, major, minor, anchor: { pageIndex: page, y }, groupKey })

const nums = (r: ReturnType<typeof renumberByBlocks>) =>
  r.changes.map((c) => `${c.id}:${c.major}.${c.minor}`)

/** n cues in reading order on page 0, ids `${prefix}${index}`, y descending. */
const run = (prefix: string, n: number, groupKey: string | null, page = 0, top = 900) =>
  Array.from({ length: n }, (_, i) => at(`${prefix}${i}`, page, top - i * 10, groupKey))

test('no script items: consecutive integers from 10 in reading order', () =>
  expect(renumberByBlocks([at('c', 1, 700), at('a', 0, 300), at('b', 0, 700)]).changes).toEqual([
    { id: 'b', major: 10, minor: 0 },
    { id: 'a', major: 11, minor: 0 },
    { id: 'c', major: 12, minor: 0 },
  ]))

test('groups take the next block: A(3) then B(2) -> 10, 11, 12, 20, 21', () => {
  const cues = [...run('a', 3, 'A', 0, 900), ...run('b', 2, 'B', 1, 900)]
  expect(nums(renumberByBlocks(cues))).toEqual([
    'a0:10.0',
    'a1:11.0',
    'a2:12.0',
    'b0:20.0',
    'b1:21.0',
  ])
})

test('a group of twelve spills two cues into points of 19 and flags them', () => {
  const cues = [...run('a', 12, 'A', 0, 900), ...run('b', 1, 'B', 1, 900)]
  const r = renumberByBlocks(cues)
  expect(r.changes.slice(0, 10).map((c) => c.major)).toEqual([
    10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
  ])
  expect(r.changes.slice(10, 12)).toEqual([
    { id: 'a10', major: 19, minor: 33 },
    { id: 'a11', major: 19, minor: 66 },
  ])
  expect(r.flagged).toEqual([
    { id: 'a10', reason: 'spilled' },
    { id: 'a11', reason: 'spilled' },
  ])
  expect(r.changes[12]).toEqual({ id: 'b0', major: 20, minor: 0 })
})

test('spilled cues beyond the 99th keep their numbers and are flagged overflow', () => {
  const cues = run('a', 10 + 101, 'A')
  const r = renumberByBlocks(cues)
  const spilled = r.flagged.filter((f) => f.reason === 'spilled')
  const overflow = r.flagged.filter((f) => f.reason === 'overflow')
  expect(spilled).toHaveLength(99)
  expect(overflow.map((f) => f.id)).toEqual(['a109', 'a110'])
  // overflow cues keep their numbers: they are not in changes
  for (const f of overflow) expect(r.changes.find((c) => c.id === f.id)).toBeUndefined()
})

test('an ungrouped run of twelve then a group: 10..21, then 30', () => {
  const cues = [...run('u', 12, null, 0, 900), ...run('g', 1, 'G', 1, 900)]
  const r = renumberByBlocks(cues)
  expect(r.changes.slice(0, 12).map((c) => c.major)).toEqual([
    10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21,
  ])
  expect(r.changes[12]).toEqual({ id: 'g0', major: 30, minor: 0 })
  expect(r.flagged).toEqual([])
})

test('a group that returns after another is its own run and takes a new block', () => {
  const cues = [at('a', 0, 900, 'A'), at('b', 0, 800, 'B'), at('c', 0, 700, 'A')]
  expect(nums(renumberByBlocks(cues))).toEqual(['a:10.0', 'b:20.0', 'c:30.0'])
})

test('unplaced cues and major 0 cues are untouched; unchanged cues are not in changes', () => {
  const cues = [
    at('line', 0, 950, null, 0, 50),
    { id: 'free', major: 7, minor: 0, anchor: null, groupKey: null },
    at('a', 0, 900, null, 10, 0),
    at('b', 0, 800, null, 55, 5),
  ]
  expect(renumberByBlocks(cues).changes).toEqual([{ id: 'b', major: 11, minor: 0 }])
})

test('ties in reading order go by id', () => {
  const r = renumberByBlocks([at('z', 0, 500), at('m', 0, 500), at('a', 0, 500)])
  expect(r.changes.map((c) => c.id)).toEqual(['a', 'm', 'z'])
})

test('block size 100 gives 100, 101, then 200', () => {
  const cues = [...run('a', 2, 'A', 0, 900), ...run('b', 1, 'B', 1, 900)]
  expect(nums(renumberByBlocks(cues, { blockSize: 100 }))).toEqual([
    'a0:100.0',
    'a1:101.0',
    'b0:200.0',
  ])
})

test('block size 2 spills the third cue of a group', () => {
  const r = renumberByBlocks(run('a', 3, 'A'), { blockSize: 2 })
  expect(r.changes).toEqual([
    { id: 'a0', major: 2, minor: 0 },
    { id: 'a1', major: 3, minor: 0 },
    { id: 'a2', major: 3, minor: 50 },
  ])
  expect(r.flagged).toEqual([{ id: 'a2', reason: 'spilled' }])
})

test.each([1, 1001, 2.5, Number.NaN])('block size %s is refused', (blockSize) =>
  expect(() => renumberByBlocks([], { blockSize })).toThrow(RangeError),
)
