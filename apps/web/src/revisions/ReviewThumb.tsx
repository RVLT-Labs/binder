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

/**
 * A 160 px thumbnail of the page an anchor is on, with its quote drawn over it in the layer's
 * colour, or a marker at the anchor point when there is no bound quote (unresolved, or a plain
 * point). The thumbnail and word layer come from the cached blobs, so it works offline.
 */
export function ReviewThumb({ anchor, colour }: ReviewThumbProps) {
  const { data } = useQuery<PageThumbRow>(
    'SELECT thumb_key, words_key, width, height FROM pages WHERE document_version_id = ? AND "index" = ?',
    [anchor.documentVersionId, anchor.pageIndex],
  )
  const page = data[0]
  const layer = useWordLayer(page?.words_key)
  if (!page?.thumb_key || !page.width || !page.height) {
    return <span className="review-thumb review-thumb-missing">Page not available</span>
  }
  const shapes = thumbShapes({ anchor, layer, page: { width: page.width, height: page.height } })
  return (
    <span className="review-thumb" style={{ width: shapes.width, height: shapes.height }}>
      <img src={blobUrl(page.thumb_key)} alt="" width={shapes.width} height={shapes.height} />
      {shapes.boxes.map((b) => (
        <span
          key={`${b.left}:${b.top}`}
          className="review-thumb-box"
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
          className="review-thumb-marker"
          data-testid="review-thumb-marker"
          style={{ left: shapes.marker.left, top: shapes.marker.top, borderColor: colour }}
        />
      )}
    </span>
  )
}
