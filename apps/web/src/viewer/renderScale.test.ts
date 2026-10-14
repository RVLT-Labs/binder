import { expect, test } from 'vitest'
import { MAX_CANVAS_PIXELS, renderScale } from './renderScale'

const letter = { width: 612, height: 792 }
const pixels = (page: { width: number; height: number }, scale: number) =>
  Math.floor(page.width * scale) * Math.floor(page.height * scale)

test('leaves the scale alone when the canvas fits the budget', () => {
  expect(renderScale(letter, 1, 2)).toBe(2)
  expect(renderScale(letter, 1.5, 1)).toBe(1.5)
})

test('caps the device pixel ratio at 2', () => {
  expect(renderScale(letter, 1, 3)).toBe(2)
})

test('lowers the scale so width x height stays within 16,000,000 device pixels', () => {
  expect(MAX_CANVAS_PIXELS).toBe(16_000_000)
  // 400% zoom on a 2x screen asks for 8x: 612x792 pt would be 31 million pixels.
  const scale = renderScale(letter, 4, 2)
  expect(scale).toBeLessThan(8)
  expect(pixels(letter, scale)).toBeLessThanOrEqual(MAX_CANVAS_PIXELS)
  // And it is the largest such scale, not a needlessly soft one.
  expect(pixels(letter, scale * 1.01)).toBeGreaterThan(MAX_CANVAS_PIXELS)
})

test('clamps a large-format page at modest zoom', () => {
  const poster = { width: 2592, height: 3456 }
  const scale = renderScale(poster, 1, 2)
  expect(pixels(poster, scale)).toBeLessThanOrEqual(MAX_CANVAS_PIXELS)
  expect(scale).toBeLessThan(2)
})

test('treats a missing device pixel ratio as 1 and never returns a degenerate scale', () => {
  expect(renderScale(letter, 1, 0)).toBe(1)
  expect(renderScale({ width: 0, height: 0 }, 1, 2)).toBe(2)
})
