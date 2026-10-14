import { expect, test } from 'vitest'
import { dayHeading, formatClock, formatWhen } from './time'

// Local-time constructors keep these independent of the machine's time zone.
const at = (y: number, mo: number, d: number, h: number, mi: number) =>
  new Date(y, mo - 1, d, h, mi).toISOString()

test('formatClock is HH:mm in local time, zero padded', () => {
  expect(formatClock(at(2026, 3, 2, 9, 5))).toBe('09:05')
  expect(formatClock(at(2026, 3, 2, 23, 59))).toBe('23:59')
})

test('days read Today, Yesterday, then the date', () => {
  const now = new Date(2026, 2, 2, 12, 0)
  expect(dayHeading(at(2026, 3, 2, 1, 0), now)).toBe('Today')
  expect(dayHeading(at(2026, 3, 1, 23, 0), now)).toBe('Yesterday')
  expect(dayHeading(at(2026, 2, 20, 8, 0), now)).toBe('2026-02-20')
})

test('formatWhen drops the date for today', () => {
  const now = new Date(2026, 2, 2, 12, 0)
  expect(formatWhen(at(2026, 3, 2, 9, 5), now)).toBe('09:05')
  expect(formatWhen(at(2026, 3, 1, 9, 5), now)).toBe('2026-03-01 09:05')
})
