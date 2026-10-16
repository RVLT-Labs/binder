import type { VersionText } from '@binder/core'
import { useQuery } from '@powersync/react'
import { useLayoutEffect, useRef, useState } from 'react'
import { BackIcon, ChevronRightIcon } from '@/components/icons'
import { cn } from '@/lib/utils'
import { blobUrl } from '../blobs/fetchBlob'
import { fitWidthZoom } from '../viewer/controls'
import { PageCanvas } from '../viewer/PageCanvas'
import { PageOverlay } from '../viewer/PageOverlay'
import { usePdfDocument } from '../viewer/usePdfDocument'
import { lineBox, lineText, tintBands } from './compareModel'

interface PageSize {
  index: number
  width: number | null
  height: number | null
}

export interface ComparePaneProps {
  side: 'old' | 'new'
  /** The pane's accessible name: "Old · v1 · label". */
  title: string
  /** The version as the caption writes it: "v1". */
  versionName: string
  versionId: string
  text: VersionText | null
  pageIndex: number
  onPageChange: (index: number) => void
  /** The lines to tint on this side by page: the removed lines (old) or the added ones (new). */
  tint: ReadonlyMap<number, ReadonlyArray<{ lineIndex: number }>>
  /** How many lines are tinted on this side in all, for "6 of the 16 cut lines are on this page". */
  tintedTotal: number
}

const PAGER =
  'inline-flex size-6 items-center justify-center rounded-[6px] text-muted hover:bg-elev hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red disabled:cursor-not-allowed disabled:opacity-40 max-md:size-11'

/** What the caption says about the tinted lines on the page in view. */
function tintCaption(side: 'old' | 'new', onPage: number, total: number): string {
  if (side === 'old') return `${onPage} of the ${total} cut lines are on this page`
  return onPage === 0
    ? 'No lines added here'
    : `${onPage} ${onPage === 1 ? 'line' : 'lines'} added here`
}

/**
 * One version's page, with the changed lines tinted over it: a red wash and a strike through the
 * cut lines, a green wash on the added ones, and the band's line count in the margin ("−6", "+2").
 * The caption is the mockup's `.dx-cap`: version and page in mono, and what is on this page.
 */
export function ComparePane({
  side,
  title,
  versionName,
  versionId,
  text,
  pageIndex,
  onPageChange,
  tint,
  tintedTotal,
}: ComparePaneProps) {
  const { data: versions } = useQuery<{ searchable_key: string | null }>(
    'SELECT searchable_key FROM document_versions WHERE id = ?',
    [versionId],
  )
  const { data: pages } = useQuery<PageSize>(
    'SELECT "index", width, height FROM pages WHERE document_version_id = ? ORDER BY "index"',
    [versionId],
  )
  const key = versions[0]?.searchable_key
  const { pdf, status, error } = usePdfDocument(key ? blobUrl(key) : null)
  const host = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = host.current
    if (!el) return
    const measure = () => setWidth(el.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const index = Math.min(Math.max(0, pageIndex), Math.max(0, pages.length - 1))
  const size = pages[index]
  const pageWidth = size?.width ?? 0
  const pageHeight = size?.height ?? 0
  const zoom = pageWidth > 0 && width > 0 ? fitWidthZoom(width, pageWidth) : 1
  const layer = text?.layers.get(index)
  const lines = tint.get(index) ?? []
  const removed = side === 'old'
  const sign = removed ? '−' : '+'

  return (
    <section
      className="compare-pane flex min-h-0 w-full min-w-0 max-w-[440px] flex-1 flex-col"
      aria-label={title}
      data-side={side}
    >
      <header className="flex h-[26px] shrink-0 items-center justify-between gap-2 max-md:h-11">
        <div className="flex min-w-0 items-center gap-0.5">
          <h2 className="m-0 font-mono text-[13px] font-normal whitespace-nowrap text-ink tabular-nums">
            {versionName} · p.{index + 1}
          </h2>
          <button
            type="button"
            className={PAGER}
            aria-label="Previous page"
            disabled={index <= 0}
            onClick={() => onPageChange(index - 1)}
          >
            <BackIcon className="size-3.5" aria-hidden />
          </button>
          <button
            type="button"
            className={PAGER}
            aria-label="Next page"
            disabled={index >= pages.length - 1}
            onClick={() => onPageChange(index + 1)}
          >
            <ChevronRightIcon className="size-3.5" aria-hidden />
          </button>
        </div>
        <span
          className="truncate text-[12px] text-muted"
          title={tintCaption(side, lines.length, tintedTotal)}
        >
          {tintCaption(side, lines.length, tintedTotal)}
        </span>
      </header>
      <div ref={host} className="compare-page min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        {status === 'error' && (
          <p role="alert" className="m-0 text-[13px] text-t-out">
            {error}
          </p>
        )}
        {pdf && size && pageWidth > 0 && (
          <PageCanvas pdf={pdf} pageIndex={index} zoom={zoom} width={pageWidth} height={pageHeight}>
            <PageOverlay width={pageWidth} height={pageHeight} zoom={zoom}>
              {layer &&
                lines.map(({ lineIndex }) => {
                  const box = lineBox(layer, lineIndex)
                  return box ? (
                    <g key={lineIndex}>
                      <rect
                        className={cn(
                          'compare-tint',
                          removed
                            ? 'fill-[color-mix(in_srgb,var(--red)_14%,transparent)]'
                            : 'fill-[color-mix(in_srgb,var(--green)_16%,transparent)]',
                        )}
                        data-op={removed ? 'removed' : 'added'}
                        // Which line this wash is on, for tests and tools: the overlay is drawn, not read.
                        aria-label={lineText(layer, lineIndex)}
                        x={box.x - 1}
                        y={box.y - 1}
                        width={box.w + 2}
                        height={box.h + 2}
                      />
                      {removed && (
                        <line
                          className="stroke-[color-mix(in_srgb,var(--page-ink)_55%,transparent)]"
                          strokeWidth={0.7}
                          x1={box.x}
                          x2={box.x + box.w}
                          y1={box.y + box.h / 2}
                          y2={box.y + box.h / 2}
                        />
                      )}
                    </g>
                  ) : null
                })}
              {layer &&
                tintBands(layer, lines).map((band) => (
                  // the overlay's y axis points up: the label is flipped back to read upright
                  <text
                    key={`${band.y}`}
                    className="fill-[var(--page-ink)] font-mono"
                    fontSize={11 / zoom}
                    fontWeight={600}
                    textAnchor="end"
                    transform={`translate(${Math.max(band.x - 4 / zoom, 16 / zoom)} ${band.y + band.h / 2 - 4 / zoom}) scale(1 -1)`}
                  >
                    {sign}
                    {band.count}
                  </text>
                ))}
            </PageOverlay>
          </PageCanvas>
        )}
        {!pdf && status === 'loading' && (
          <p role="status" className="m-0 text-[13px] text-muted">
            Loading the pages…
          </p>
        )}
      </div>
    </section>
  )
}
