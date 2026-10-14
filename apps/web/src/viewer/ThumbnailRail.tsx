import { useEffect, useRef } from 'react'
import { blobUrl } from '../blobs/fetchBlob'

/** Thumbnails are rendered 160 px wide; shown at half that for a sharp image on 2x screens. */
const THUMB_WIDTH = 80

export interface RailPage {
  id: string
  width: number
  height: number
  thumb_key: string | null
}

export interface ThumbnailRailProps {
  pages: readonly RailPage[]
  /** Zero-based. */
  current: number
  onSelect: (index: number) => void
}

/** A column of page thumbnails. Images load lazily as the rail scrolls; the current page is marked. */
export function ThumbnailRail({ pages, current, onSelect }: ThumbnailRailProps) {
  const rail = useRef<HTMLElement>(null)

  // Keep the current page's thumbnail in view as the pages scroll.
  useEffect(() => {
    rail.current?.children[current]?.scrollIntoView({ block: 'nearest' })
  }, [current])

  return (
    <nav ref={rail} className="thumbnail-rail" aria-label="Thumbnails">
      {pages.map((page, i) => {
        const label = `Page ${i + 1}`
        const height = Math.round((THUMB_WIDTH * page.height) / page.width)
        return (
          <button
            key={page.id}
            type="button"
            className="thumbnail"
            aria-current={i === current ? 'page' : undefined}
            onClick={() => onSelect(i)}
          >
            {page.thumb_key ? (
              <img
                src={blobUrl(page.thumb_key)}
                alt={label}
                loading="lazy"
                width={THUMB_WIDTH}
                height={height}
              />
            ) : (
              <span className="thumbnail-missing" style={{ width: THUMB_WIDTH, height }} />
            )}
            <span className="thumbnail-number" aria-hidden="true">
              {i + 1}
            </span>
          </button>
        )
      })}
    </nav>
  )
}
