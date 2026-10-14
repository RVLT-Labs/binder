import { expect, test } from 'vitest'
import { cssToDisplayed, displayedToCss, pageGeometry } from './coords'

const A4 = { width: 595.3, height: 841.9 }

test('displayedToCss flips y and scales', () =>
  expect(displayedToCss(72, 841.9 - 92, 841.9, 2)).toEqual({ left: 144, top: 184 }))

test('the bottom-left corner of the page is the CSS bottom-left of its box', () =>
  expect(displayedToCss(0, 0, 841.9, 1.5)).toEqual({ left: 0, top: 841.9 * 1.5 }))

test('cssToDisplayed inverts displayedToCss', () => {
  const { left, top } = displayedToCss(123.4, 567.8, A4.height, 1.25)
  const back = cssToDisplayed(left, top, A4.height, 1.25)
  expect(back.x).toBeCloseTo(123.4, 9)
  expect(back.y).toBeCloseTo(567.8, 9)
})

test('cssToDisplayed maps the CSS top-left to the top of the displayed page', () =>
  expect(cssToDisplayed(0, 0, A4.height, 3)).toEqual({ x: 0, y: A4.height }))

test('pageGeometry sizes the page box at the zoom, one CSS pixel per point at 100%', () => {
  expect(pageGeometry(A4, 1)).toEqual({ cssWidth: 595.3, cssHeight: 841.9, scale: 1 })
  expect(pageGeometry({ width: 842, height: 595 }, 0.5)).toEqual({
    cssWidth: 421,
    cssHeight: 297.5,
    scale: 0.5,
  })
})
