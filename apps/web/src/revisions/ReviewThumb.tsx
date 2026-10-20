import type { Anchor } from '@binder/shared'
import { useQuery } from '@powersync/react'
import { blobUrl } from '../blobs/fetchBlob'
import { useWordLayer } from '../markup/wordLayers'
import { thumbShapes } from './thumbShapes'

interface PageThumbRow {
  thumb_key: string | null
  words_key: string | null
  width: number | null
  height: number | null
}

export interface ReviewThumbProps {
  /** The version whose page is shown (the anchor's own version). */
  anchor: Anchor
  colour: string
}

/** The mockup's `.review-thumb`: an 84 x 48 window onto the page, white, radius 4. */
export const REVIEW_WINDOW = { width: 84, height: 48 } as const

/**
 * Where to put a `view` window over a `size` image so `at` sits in its middle, without leaving the
 * image: the top-left corner of the window, in image pixels.
 */
export function windowOffset(
  at: { left: number; top: number },
  size: { width: number; height: number },
  view: { width: number; height: number } = REVIEW_WINDOW,
): { left: number; top: number } {
  const clamp = (v: number, max: number) => Math.min(Math.max(0, v), Math.max(0, max))
  return {
    left: clamp(at.left - view.width / 2, size.width - view.width),
    top: clamp(at.top - view.height / 2, size.height - view.height),
  }
}

/**
 * A crop of the thumbnail of the page an anchor is on, centred on the anchor, with its quote drawn
 * over it in the layer's colour, or a marker at the anchor point when there is no bound quote
 * (unresolved, or a plain point). The thumbnail and word layer come from the cached blobs, so it
 * works offline.
 */
export function ReviewThumb({ anchor, colour }: ReviewThumbProps) {
  const { data } = useQuery<PageThumbRow>(
    'SELECT thumb_key, words_key, width, height FROM pages WHERE document_version_id = ? AND "index" = ?',
    [anchor.documentVersionId, anchor.pageIndex],
  )
  const page = data[0]
  const layer = useWordLayer(page?.words_key)
  if (!page?.thumb_key || !page.width || !page.height) {
    return (
      <span className="review-thumb review-thumb-missing grid h-12 w-[84px] place-items-center rounded-[4px] border border-dashed border-line-2 bg-card px-1 text-center text-[11px] leading-tight text-muted">
        Page not available
      </span>
    )
  }
  const shapes = thumbShapes({ anchor, layer, page: { width: page.width, height: page.height } })
  const focus = shapes.boxes[0]
    ? {
        left: shapes.boxes[0].left + shapes.boxes[0].width / 2,
        top: shapes.boxes[0].top + shapes.boxes[0].height / 2,
      }
    : (shapes.marker ?? { left: shapes.width / 2, top: shapes.height / 2 })
  const offset = windowOffset(focus, shapes)
  return (
    <span
      className="review-thumb relative block shrink-0 overflow-hidden rounded-[4px] bg-page"
      style={REVIEW_WINDOW}
    >
      <span
        className="absolute"
        style={{
          left: -offset.left,
          top: -offset.top,
          width: shapes.width,
          height: shapes.height,
        }}
      >
        <img
          src={blobUrl(page.thumb_key)}
          alt=""
          width={shapes.width}
          height={shapes.height}
          className="block max-w-none"
        />
        {shapes.boxes.map((b) => (
          <span
            key={`${b.left}:${b.top}`}
            className="review-thumb-box absolute opacity-35 mix-blend-multiply"
            data-testid="review-thumb-box"
            style={{
              left: b.left,
              top: b.top,
              width: b.width,
              height: b.height,
              background: colour,
            }}
          />
        ))}
        {shapes.marker && (
          <span
            className="review-thumb-marker absolute -mt-[5px] -ml-[5px] size-2.5 rounded-full border-2 bg-page/70"
            data-testid="review-thumb-marker"
            style={{ left: shapes.marker.left, top: shapes.marker.top, borderColor: colour }}
          />
        )}
      </span>
    </span>
  )
}
