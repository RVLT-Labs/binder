import { expect, test } from 'vitest'
import {
  compareCueNumbers,
  findDuplicateNumbers,
  formatCueNumber,
  parseCueNumber,
  suggestCueNumber,
} from './numbering'

test.each([
  [10, 0, 'decimal', '10'],
  [10, 50, 'decimal', '10.5'],
  [10, 50, 'point', '10.50'],
  [10, 5, 'decimal', '10.05'],
  [10, 5, 'point', '10.05'],
  [0, 50, 'point', '0.50'],
  [14, 10, 'decimal', '14.1'],
] as const)('formats %i.%i %s as %s', (M, m, f, s) => expect(formatCueNumber(M, m, f)).toBe(s))

test.each([
  ['14', [14, 0]],
  ['14.5', [14, 50]],
  ['14.50', [14, 50]],
  ['14.05', [14, 5]],
  ['0.5', [0, 50]],
  [' 12 ', [12, 0]],
  ['9999', [9999, 0]],
] as const)('parses %j', (s, [major, minor]) => expect(parseCueNumber(s)).toEqual({ major, minor }))

test.each(['', '-1', '14.123', '1e3', '14.', '.5', 'abc', '10000', '1.2.3'])('rejects %j', (s) =>
  expect(parseCueNumber(s)).toBeNull(),
)

test.each([
  [null, null, [10, 0]],
  [[12, 0], null, [13, 0]],
  [
    [12, 0],
    [20, 0],
    [13, 0],
  ],
  [
    [12, 0],
    [13, 0],
    [12, 50],
  ],
  [
    [12, 50],
    [13, 0],
    [12, 70],
  ],
  [
    [12, 98],
    [12, 99],
    [12, 98],
  ],
  [null, [10, 0], [1, 0]],
  [
    [13, 0],
    [12, 0],
    [14, 0],
  ],
] as const)('suggests between %j and %j: %j', (p, n, [major, minor]) =>
  expect(
    suggestCueNumber(p && { major: p[0], minor: p[1] }, n && { major: n[0], minor: n[1] }),
  ).toEqual({ major, minor }),
)

test('suggestions honour the block size and fall back to tens and midpoints', () => {
  expect(suggestCueNumber(null, null, 20)).toEqual({ major: 20, minor: 0 })
  expect(suggestCueNumber({ major: 12, minor: 51 }, { major: 12, minor: 59 })).toEqual({
    major: 12,
    minor: 55,
  })
  expect(suggestCueNumber({ major: 12, minor: 60 }, { major: 12, minor: 70 })).toEqual({
    major: 12,
    minor: 65,
  })
})

test('compareCueNumbers orders by major then minor', () => {
  expect(compareCueNumbers({ major: 1, minor: 99 }, { major: 2, minor: 0 })).toBeLessThan(0)
  expect(compareCueNumbers({ major: 2, minor: 50 }, { major: 2, minor: 5 })).toBeGreaterThan(0)
  expect(compareCueNumbers({ major: 2, minor: 5 }, { major: 2, minor: 5 })).toBe(0)
})

test('duplicates are per department, major and minor', () => {
  const dupes = findDuplicateNumbers([
    { id: 'a', departmentId: 'LX', major: 10, minor: 0 },
    { id: 'b', departmentId: 'LX', major: 10, minor: 0 },
    { id: 'c', departmentId: 'TM', major: 10, minor: 0 },
    { id: 'd', departmentId: 'LX', major: 10, minor: 50 },
  ])
  expect([...dupes].sort()).toEqual(['a', 'b'])
})
