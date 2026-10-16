import { expect, test } from 'vitest'
import { fileTypeOf, whenParts } from './when'

// local-time constructors, so the test does not depend on the machine's zone
const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min)
const NOW = at(2026, 10, 16, 15, 0)

const flat = (parts: ReturnType<typeof whenParts>) => parts.map((p) => p.text).join('')

test('today and yesterday say so, with the clock in mono', () => {
  const today = whenParts(at(2026, 10, 16, 14, 2).toISOString(), NOW)
  expect(flat(today)).toBe('today 14:02')
  expect(today.filter((p) => p.mono).map((p) => p.text)).toEqual(['14:02'])
  const yesterday = whenParts(at(2026, 10, 15, 22, 51).toISOString(), NOW)
  expect(flat(yesterday)).toBe('yesterday 22:51')
})

test('earlier this year is the day and month, the day in mono', () => {
  const parts = whenParts(at(2026, 10, 12, 9, 0).toISOString(), NOW)
  expect(flat(parts)).toBe('12 Oct')
  expect(parts.filter((p) => p.mono).map((p) => p.text)).toEqual(['12'])
  expect(flat(whenParts(at(2026, 1, 9, 9, 0).toISOString(), NOW))).toBe('9 Jan')
})

test('an earlier year carries the year', () => {
  expect(flat(whenParts(at(2025, 12, 31, 9, 0).toISOString(), NOW))).toBe('31 Dec 2025')
})

test('an unreadable time is nothing', () => expect(whenParts('', NOW)).toEqual([]))

test('the file type is the upper-case extension, FILE when there is none', () => {
  expect(fileTypeOf('Show - Export libretto v1 - All layers.pdf')).toBe('PDF')
  expect(fileTypeOf('SND cue sheet.csv')).toBe('CSV')
  expect(fileTypeOf('cues.xlsx')).toBe('XLSX')
  expect(fileTypeOf('README')).toBe('FILE')
  expect(fileTypeOf(null)).toBe('FILE')
})
