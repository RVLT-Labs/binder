import { expect, test } from 'vitest'
import { relativeTime } from './relative'

const now = new Date('2026-10-16T12:00:00Z')

test.each([
  ['2026-10-16T11:59:30Z', 'just now'],
  ['2026-10-16T11:58:00Z', '2 min ago'],
  ['2026-10-16T09:00:00Z', '3 h ago'],
  ['2026-10-15T09:00:00Z', 'yesterday'],
  ['2026-10-12T09:00:00Z', '4 days ago'],
  ['2026-09-01T09:00:00Z', '2026-09-01'],
  ['not a date', ''],
])('%s reads %s', (iso, text) => {
  expect(relativeTime(iso, now)).toBe(text)
})
