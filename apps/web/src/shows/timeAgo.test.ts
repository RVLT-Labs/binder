import { describe, expect, it } from 'vitest'
import { timeAgo } from './timeAgo'

const now = new Date('2026-10-16T12:00:00Z')
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString()
const MIN = 60_000

describe('timeAgo', () => {
  it('says just now inside the first minute, and for a clock a little ahead', () => {
    expect(timeAgo(ago(20_000), now)).toBe('just now')
    expect(timeAgo(ago(-5 * MIN), now)).toBe('just now')
  })
  it('counts minutes, hours and days', () => {
    expect(timeAgo(ago(12 * MIN), now)).toBe('12 min ago')
    expect(timeAgo(ago(60 * MIN), now)).toBe('1 h ago')
    expect(timeAgo(ago(5 * 60 * MIN), now)).toBe('5 h ago')
    expect(timeAgo(ago(26 * 60 * MIN), now)).toBe('1 d ago')
    expect(timeAgo(ago(6 * 24 * 60 * MIN), now)).toBe('6 d ago')
  })
  it('gives a date from a week on, with the year only when it is another one', () => {
    expect(timeAgo('2026-10-02T12:00:00Z', now)).toBe('2 Oct')
    expect(timeAgo('2025-06-03T12:00:00Z', now)).toBe('3 Jun 2025')
  })
  it('is empty for a missing or unreadable time', () => {
    expect(timeAgo(null, now)).toBe('')
    expect(timeAgo('soon', now)).toBe('')
  })
})
