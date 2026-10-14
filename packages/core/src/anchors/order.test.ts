import { expect, test } from 'vitest'
import { compareReadingOrder } from './order'

test('reading order is page ascending then y descending', () => {
  const cues = [
    { id: 'low', pageIndex: 0, y: 100 },
    { id: 'next-page', pageIndex: 1, y: 700 },
    { id: 'high', pageIndex: 0, y: 700 },
    { id: 'mid', pageIndex: 0, y: 400 },
  ]
  expect([...cues].sort(compareReadingOrder).map((c) => c.id)).toEqual([
    'high',
    'mid',
    'low',
    'next-page',
  ])
  expect(compareReadingOrder({ pageIndex: 2, y: 5 }, { pageIndex: 2, y: 5 })).toBe(0)
})
