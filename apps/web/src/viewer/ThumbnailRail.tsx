import type { PresencePeer } from '@binder/shared'
import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import { blobUrl } from '../blobs/fetchBlob'
import { AvatarGroup } from '../presence/Avatars'

/**
 * Thumbnails are rendered 160 px wide; shown at 62 (the mockup's `.thumb`: 62 x 82 in a 92 px
 * column), still sharp on 2x screens. The column is THUMB_COLUMN wide; CSS below says the same.
 */
export const THUMB_WIDTH = 62
/** The column the thumbnails sit in (`.thumbs`: 92 px). */
export const THUMB_COLUMN = 92

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
      className="thumbnail-rail flex w-[92px] shrink-0 flex-col items-center gap-3.5 overflow-y-auto border-r border-line bg-paper-2 pt-2.5 pb-6"
      aria-label="Thumbnails"
    >
      {pages.map((page, i) => {
        const label = `Page ${i + 1}`
        const height = Math.round((THUMB_WIDTH * page.height) / page.width)
        return (
          <div
            key={page.id}
            className="thumbnail-slot relative flex shrink-0 flex-col items-center"
          >
            <button
              type="button"
              className={cn(
                'thumbnail group relative grid cursor-pointer justify-items-center rounded-[3px] bg-transparent',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red focus-visible:ring-offset-2 focus-visible:ring-offset-paper-2',
              )}
              aria-current={i === current ? 'page' : undefined}
              onClick={() => onSelect(i)}
            >
              {/* The current page's frame is a 2 px red outline, offset 2: active state, DESIGN 4.1. */}
              <span className="block rounded-[3px] bg-page shadow-[0_1px_0_rgba(0,0,0,0.6)] group-aria-[current=page]:outline-2 group-aria-[current=page]:outline-offset-2 group-aria-[current=page]:outline-red">
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
                className="thumbnail-number absolute inset-x-0 -bottom-[15px] text-center font-mono text-[11px] leading-none tabular-nums text-muted group-aria-[current=page]:text-ink"
                aria-hidden="true"
              >
                {i + 1}
              </span>
            </button>
            <AvatarGroup
              className="thumbnail-presence !-top-1.5 !-right-1.5"
              peers={peersByPage?.get(i) ?? []}
              pageIndex={i}
            />
          </div>
        )
      })}
    </nav>
  )
}
