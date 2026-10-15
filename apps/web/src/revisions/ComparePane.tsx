import type { VersionText } from '@binder/core'
import { useQuery } from '@powersync/react'
import { useLayoutEffect, useRef, useState } from 'react'
import { blobUrl } from '../blobs/fetchBlob'
import { fitWidthZoom } from '../viewer/controls'
import { PageCanvas } from '../viewer/PageCanvas'
import { PageOverlay } from '../viewer/PageOverlay'
import { usePdfDocument } from '../viewer/usePdfDocument'
import { lineBox } from './compareModel'

interface PageSize {
  index: number
  width: number | null
  height: number | null
}

export interface ComparePaneProps {
  side: 'old' | 'new'
  title: string
  versionId: string
  text: VersionText | null
  pageIndex: number
  onPageChange: (index: number) => void
  /** The lines to tint on this side by page: the removed lines (old) or the added ones (new). */
  tint: ReadonlyMap<number, ReadonlyArray<{ lineIndex: number }>>
}

/** One version's page, with the changed lines tinted over it. */
export function ComparePane({
  side,
  title,
  versionId,
  text,
  pageIndex,
  onPageChange,
  tint,
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
  const zoom = pageWidth > 0 && width > 0 ? fitWidthZoom(width - 16, pageWidth) : 1
  const layer = text?.layers.get(index)
  const lines = tint.get(index) ?? []

  return (
    <section className="compare-pane" aria-label={title} data-side={side}>
      <header>
        <h2>{title}</h2>
        <div className="compare-pager">
          <button type="button" disabled={index <= 0} onClick={() => onPageChange(index - 1)}>
            Previous page
          </button>
          <span>
            Page {index + 1} / {pages.length || 1}
          </span>
          <button
            type="button"
            disabled={index >= pages.length - 1}
            onClick={() => onPageChange(index + 1)}
          >
            Next page
          </button>
        </div>
      </header>
      <div ref={host} className="compare-page">
        {status === 'error' && <p role="alert">{error}</p>}
        {pdf && size && pageWidth > 0 && (
          <PageCanvas pdf={pdf} pageIndex={index} zoom={zoom} width={pageWidth} height={pageHeight}>
            <PageOverlay width={pageWidth} height={pageHeight} zoom={zoom}>
              {layer &&
                lines.map(({ lineIndex }) => {
                  const box = lineBox(layer, lineIndex)
                  return box ? (
                    <rect
                      key={lineIndex}
                      className="compare-tint"
                      data-op={side === 'old' ? 'removed' : 'added'}
                      x={box.x - 1}
                      y={box.y - 1}
                      width={box.w + 2}
                      height={box.h + 2}
                    />
                  ) : null
                })}
            </PageOverlay>
          </PageCanvas>
        )}
        {!pdf && status === 'loading' && <p role="status">Loading the pages…</p>}
      </div>
    </section>
  )
}
