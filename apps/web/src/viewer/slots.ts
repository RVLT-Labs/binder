/**
 * The page list's vertical arithmetic. One slot holds one page: `SLOT_PADDING_TOP` of clearance, the
 * page, then `SLOT_PADDING_BOTTOM`. The virtualiser's item size is exactly the slot's height, so a
 * slot never reaches into the next one and a click on the very bottom of a page lands on that page.
 */

/** The slot's top padding (set inline on `.page-slot`): where the page box starts in its item. */
export const SLOT_PADDING_TOP = 22
/** Clearance under the page inside its own slot. With the top padding it is the gap between pages. */
export const SLOT_PADDING_BOTTOM = 0

/** The height of the slot for a page `height` points tall at `zoom`, in CSS pixels. */
export const slotSize = (height: number, zoom: number) =>
  height * zoom + SLOT_PADDING_TOP + SLOT_PADDING_BOTTOM

/**
 * Where slot `index` starts, given the summed height of the pages before it (points). Every earlier
 * slot adds its two paddings to the pages' scaled height.
 */
export const slotStart = (heightBefore: number, index: number, zoom: number) =>
  heightBefore * zoom + (SLOT_PADDING_TOP + SLOT_PADDING_BOTTOM) * index

/**
 * The page under scroll offset `offset` (CSS pixels from the top of the list) and the point of it
 * there, as displayed points with y up. An offset in the clearance between pages takes the nearer
 * page's edge; past either end, the first or last page's edge.
 */
export function pageAtOffset(
  offset: number,
  heights: readonly number[],
  zoom: number,
): { pageIndex: number; y: number } | null {
  if (heights.length === 0) return null
  let before = 0
  for (let i = 0; i < heights.length; i++) {
    const top = slotStart(before, i, zoom)
    const last = i === heights.length - 1
    const end = top + slotSize(heights[i], zoom)
    if (offset < end || last) {
      const fromTop = Math.min(Math.max(offset - top - SLOT_PADDING_TOP, 0), heights[i] * zoom)
      return { pageIndex: i, y: heights[i] - fromTop / zoom }
    }
    before += heights[i]
  }
  return null
}
