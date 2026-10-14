import { expect, test } from 'vitest'
import { toPagePoint } from './pagePoint'

test('a pointer position becomes displayed points on the page under it', () => {
  // A 600 x 800 pt page drawn at zoom 1.5 with its top-left at (100, 50) in the viewport.
  const rect = { left: 100, top: 50, width: 900 }
  const page = { width: 600, height: 800 }
  expect(toPagePoint({ x: 100, y: 50 }, rect, page)).toEqual({ x: 0, y: 800 })
  expect(toPagePoint({ x: 250, y: 1150 }, rect, page)).toEqual({ x: 100, y: 800 - 1100 / 1.5 })
})
