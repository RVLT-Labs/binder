import { expect, test } from 'vitest'
import { cueMarkerBox, hitTest } from './geometry'

test('cueMarkerBox is 14 high, centred on y, left edge at x', () => {
  expect(cueMarkerBox(100, 500, 30)).toEqual({ x: 100, y: 493, w: 38, h: 14 })
})

const items = [
  { table: 'cues' as const, id: 'a', box: { x: 0, y: 0, w: 50, h: 14 } },
  { table: 'annotations' as const, id: 'b', box: { x: 40, y: 0, w: 50, h: 14 } },
]

test('hitTest picks the last-drawn item containing the point', () => {
  expect(hitTest(items, { x: 45, y: 7 })).toEqual({ table: 'annotations', id: 'b' })
  expect(hitTest(items, { x: 10, y: 7 })).toEqual({ table: 'cues', id: 'a' })
})

test('hitTest tolerates 4 points by default and no more', () => {
  expect(hitTest(items, { x: -4, y: 7 })).toEqual({ table: 'cues', id: 'a' })
  expect(hitTest(items, { x: 25, y: 18 })).toEqual({ table: 'cues', id: 'a' })
  expect(hitTest(items, { x: -4.5, y: 7 })).toBeNull()
  expect(hitTest(items, { x: 25, y: -4.5 })).toBeNull()
  expect(hitTest(items, { x: -4.5, y: 7 }, 5)).toEqual({ table: 'cues', id: 'a' })
  expect(hitTest([], { x: 0, y: 0 })).toBeNull()
})
