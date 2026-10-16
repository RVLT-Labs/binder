import { expect, test } from 'vitest'
import { pageAtOffset, SLOT_PADDING_TOP, slotSize, slotStart } from './slots'

const heights = [792, 612, 842, 792]
const zoom = 1.25
const before = heights.map((_, i) => heights.slice(0, i).reduce((a, b) => a + b, 0))

test('each slot is tall enough for the page and the clearance above it', () => {
  for (const h of heights)
    expect(slotSize(h, zoom)).toBeGreaterThanOrEqual(h * zoom + SLOT_PADDING_TOP)
})

test('the page box ends inside its own slot, so no slot lies over the previous page', () => {
  heights.forEach((h, i) => {
    const slotTop = slotStart(before[i], i, zoom)
    const pageBottom = slotTop + SLOT_PADDING_TOP + h * zoom
    expect(pageBottom).toBeLessThanOrEqual(slotTop + slotSize(h, zoom))
    if (i + 1 < heights.length) {
      // the next slot begins at or after the page's last pixel
      expect(slotStart(before[i + 1], i + 1, zoom)).toBeGreaterThanOrEqual(pageBottom)
    }
  })
})

test('slot starts are the running sum of the slot sizes the virtualiser uses', () => {
  let running = 0
  heights.forEach((h, i) => {
    expect(slotStart(before[i], i, zoom)).toBeCloseTo(running, 6)
    running += slotSize(h, zoom)
  })
})

test('the page under an offset, and the point of it there (y up)', () => {
  const one = slotSize(heights[0], zoom)
  // the middle of page 0's box
  const mid = SLOT_PADDING_TOP + (heights[0] * zoom) / 2
  expect(pageAtOffset(mid, heights, zoom)).toEqual({ pageIndex: 0, y: heights[0] / 2 })
  // the very top of page 1's box
  expect(pageAtOffset(one + SLOT_PADDING_TOP, heights, zoom)).toEqual({
    pageIndex: 1,
    y: heights[1],
  })
  // above the first page and below the last one pin to their edges
  expect(pageAtOffset(-50, heights, zoom)).toEqual({ pageIndex: 0, y: heights[0] })
  expect(pageAtOffset(1e9, heights, zoom)).toEqual({ pageIndex: heights.length - 1, y: 0 })
  expect(pageAtOffset(0, [], zoom)).toBeNull()
})
