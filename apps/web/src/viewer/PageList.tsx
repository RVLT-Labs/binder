import { useVirtualizer } from '@tanstack/react-virtual'
import {
  type KeyboardEventHandler,
  type Ref,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react'
import { PageCanvas } from './PageCanvas'
import type { PDFDocumentProxy } from './pdfjs'

/** Vertical space around each page, in CSS pixels. Part of every item's size. */
const GAP = 16

export interface ListPage {
  id: string
  width: number
  height: number
}

export interface PageListHandle {
  /** Scrolls so the top of page `index` (zero-based) is at the top of the list. */
  scrollToPage(index: number): void
}

export interface PageListProps {
  pdf: PDFDocumentProxy
  pages: readonly ListPage[]
  zoom: number
  /** Zero-based page to open at. Read on mount only. */
  initialPage?: number
  /** Called with the zero-based page at the top of the view whenever it changes. */
  onVisiblePage: (index: number) => void
  onKeyDown?: KeyboardEventHandler<HTMLElement>
  ref?: Ref<PageListHandle>
}

/**
 * The scrolling column of pages. Only the pages in view, plus one either side, are mounted, so a
 * long document keeps a handful of canvases alive. Page sizes are known from the synced rows, so
 * every offset is exact without measuring the DOM.
 */
export function PageList({
  pdf,
  pages,
  zoom,
  initialPage = 0,
  onVisiblePage,
  onKeyDown,
  ref,
}: PageListProps) {
  const scroller = useRef<HTMLElement>(null)
  /** heightBefore[i]: total displayed height of pages 0..i-1, in points. */
  const heightBefore = useMemo(() => {
    const sums = [0]
    for (const p of pages) sums.push((sums.at(-1) as number) + p.height)
    return sums
  }, [pages])
  const startOf = (index: number, z: number) => heightBefore[index] * z + GAP * index

  const virtualizer = useVirtualizer({
    count: pages.length,
    getScrollElement: () => scroller.current,
    estimateSize: (i) => pages[i].height * zoom + GAP,
    overscan: 1,
    getItemKey: (i) => pages[i].id,
    initialOffset: () => startOf(Math.min(initialPage, pages.length - 1), zoom),
    useFlushSync: false,
  })

  const items = virtualizer.getVirtualItems()
  const offset = virtualizer.scrollOffset ?? 0
  const viewport = virtualizer.scrollRect?.height ?? 0
  const atEnd = viewport > 0 && offset + viewport >= virtualizer.getTotalSize() - 1
  // The page under a line a tenth of the way down the view; at the very bottom, the last page.
  const probe = offset + viewport * 0.1
  const visible = atEnd
    ? pages.length - 1
    : (items.find((it) => it.end > probe)?.index ?? items[0]?.index ?? 0)

  // On zoom, re-measure and keep the same point of the same page at the top of the view.
  const shown = useRef({ zoom, index: visible, offset })
  useLayoutEffect(() => {
    const before = shown.current
    if (before.zoom === zoom) {
      shown.current = { zoom, index: visible, offset }
      return
    }
    const within = (before.offset - startOf(before.index, before.zoom)) / before.zoom
    const next = startOf(before.index, zoom) + within * zoom
    virtualizer.measure()
    virtualizer.scrollToOffset(next)
    shown.current = { zoom, index: before.index, offset: next }
  })

  useEffect(() => onVisiblePage(visible), [visible, onVisiblePage])

  useImperativeHandle(
    ref,
    () => ({ scrollToPage: (index) => virtualizer.scrollToIndex(index, { align: 'start' }) }),
    [virtualizer],
  )

  return (
    <section
      ref={scroller}
      className="page-list"
      aria-label="Pages"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling region takes focus for keyboard paging
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      <div className="page-list-inner" style={{ height: virtualizer.getTotalSize() }}>
        {items.map((item) => {
          const page = pages[item.index]
          return (
            <div
              key={item.key}
              className="page-slot"
              style={{ transform: `translateY(${item.start}px)`, height: item.size }}
            >
              <PageCanvas
                pdf={pdf}
                pageIndex={item.index}
                zoom={zoom}
                width={page.width}
                height={page.height}
              />
            </div>
          )
        })}
      </div>
    </section>
  )
}
