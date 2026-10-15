import { wordBoxes } from '@binder/core'
import type { Anchor, WordLayer } from '@binder/shared'

/** Thumbnails are rendered 160 px wide; the review draws them at that size. */
export const THUMB_WIDTH = 160

export interface ThumbShapes {
  width: number
  height: number
  /** The quote's lines, in thumbnail pixels from the top left. */
  boxes: Array<{ left: number; top: number; width: number; height: number }>
  /** Where the anchor point sits when there is no bound quote to draw. */
  marker: { left: number; top: number } | null
}

/**
 * What a review thumbnail draws for an anchor: one box per line of a bound quote, scaled from page
 * points (y up) onto the thumbnail; otherwise a marker at the anchor point (an unbound quote, an
 * anchor with no text, or text whose page has not loaded).
 */
export function thumbShapes(input: {
  anchor: Anchor
  layer: WordLayer | null
  page: { width: number; height: number }
}): ThumbShapes {
  const { anchor, layer, page } = input
  const scale = THUMB_WIDTH / page.width
  const height = page.height * scale
  const boxes =
    layer && anchor.text
      ? wordBoxes(layer, anchor.text).map((b) => ({
          left: b.x * scale,
          top: (page.height - (b.y + b.h)) * scale,
          width: b.w * scale,
          height: b.h * scale,
        }))
      : []
  const marker =
    boxes.length > 0 ? null : { left: anchor.x * scale, top: (page.height - anchor.y) * scale }
  return { width: THUMB_WIDTH, height, boxes, marker }
}
