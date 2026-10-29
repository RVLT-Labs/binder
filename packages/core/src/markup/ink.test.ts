import { expect, test } from 'vitest'
import { inkPath } from './ink'

test('dots are canonical and are not reshaped when persisted with a repeated sample', () => {
  const one = { count: 1, x0: 0, y0: 0, p0: 0.5 }
  expect(inkPath(one, 1.5)).toBe(inkPath({ ...one, count: 2, x1: 0, y1: 0, p1: 0.5 }, 1.5))
})
test('tiny curves retain their sampled coordinates and real pressure', () => {
  const g = { count: 3, x0: 0, y0: 0, p0: 0, x1: 0.02, y1: 0.03, p1: 0.5, x2: 0.04, y2: 0, p2: 1 }
  const path = inkPath(g, 1)
  expect(path).toContain('M 0.2 0')
  expect(path).toContain('M 0.52 0.03')
  expect(path).toContain('M 0.8400000000000001 0')
  expect(inkPath(g, 0.75)).not.toBe(path)
})
