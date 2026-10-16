import type { PresencePeer } from '@binder/shared'
import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import { blobUrl } from '../blobs/fetchBlob'
import { AvatarGroup } from '../presence/Avatars'

/** Thumbnails are rendered 160 px wide; shown at 96 (DESIGN 6.2), still sharp on 2x screens. */
export const THUMB_WIDTH = 96

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
  /** Who is on each page (zero-based) of this version: their avatars sit on the page's thumbnail. */
  peersByPage?: ReadonlyMap<number, readonly PresencePeer[]>
}

/** A column of page thumbnails. Images load lazily as the rail scrolls; the current page is marked. */
export function ThumbnailRail({ pages, current, onSelect, peersByPage }: ThumbnailRailProps) {
  const rail = useRef<HTMLElement>(null)

  // Keep the current page's thumbnail in view as the pages scroll.
  useEffect(() => {
    rail.current?.children[current]?.scrollIntoView({ block: 'nearest' })
  }, [current])

  return (
    <nav
      ref={rail}
      className="thumbnail-rail flex shrink-0 flex-col gap-3 overflow-y-auto border-r border-line bg-paper-2 px-2 py-3"
      aria-label="Thumbnails"
    >
      {pages.map((page, i) => {
        const label = `Page ${i + 1}`
        const height = Math.round((THUMB_WIDTH * page.height) / page.width)
        return (
          <div key={page.id} className="thumbnail-slot relative flex flex-col items-center">
            <button
              type="button"
              className={cn(
                'thumbnail group grid cursor-pointer justify-items-center gap-1 rounded-[4px] bg-transparent',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red focus-visible:ring-offset-2 focus-visible:ring-offset-paper-2',
              )}
              aria-current={i === current ? 'page' : undefined}
              onClick={() => onSelect(i)}
            >
              {/* The current page's frame is red: active state, DESIGN 4.1. */}
              <span className="block rounded-[3px] bg-page ring-2 ring-line-2 group-aria-[current=page]:ring-red">
                {page.thumb_key ? (
                  <img
                    src={blobUrl(page.thumb_key)}
                    alt={label}
                    loading="lazy"
                    width={THUMB_WIDTH}
                    height={height}
                    className="block"
                  />
                ) : (
                  <span
                    className="thumbnail-missing block bg-page"
                    style={{ width: THUMB_WIDTH, height }}
                  />
                )}
              </span>
              <span
                className="thumbnail-number font-mono text-[11px] tabular-nums text-muted group-aria-[current=page]:text-ink"
                aria-hidden="true"
              >
                {i + 1}
              </span>
            </button>
            <AvatarGroup
              className="thumbnail-presence"
              peers={peersByPage?.get(i) ?? []}
              pageIndex={i}
            />
          </div>
        )
      })}
    </nav>
  )
}
