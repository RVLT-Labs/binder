import type { PresencePeer } from '@binder/shared'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  type KeyboardEventHandler,
  type ReactNode,
  type Ref,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react'
import { AvatarGroup } from '../presence/Avatars'
import { PAGE_GUTTER } from './controls'
import { PageCanvas } from './PageCanvas'
import type { PDFDocumentProxy } from './pdfjs'

/** Vertical space around each page, in CSS pixels. Part of every item's size. */
const GAP = 16
/** The page slot's top padding (set inline on `.page-slot`): where the page box starts in its item. */
const SLOT_PADDING_TOP = 8

export interface ListPage {
  id: string
  width: number
  height: number
}

export interface PageListHandle {
  /** Scrolls so the top of page `index` (zero-based) is at the top of the list. */
  scrollToPage(index: number): void
  /** Scrolls so a point `top` CSS pixels below the top of page `index` sits a third of the way down the view. */
  scrollToPoint(index: number, top: number): void
}

export interface PageListProps {
  pdf: PDFDocumentProxy
  pages: readonly ListPage[]
  zoom: number
  /** Drawn over each mounted page in its box, e.g. a PageOverlay with markup. `pageIndex` is zero-based. */
  overlay?: (pageIndex: number) => ReactNode
  /** Who is on each page (zero-based) of this version: avatars at the page's top right. */
  peersByPage?: ReadonlyMap<number, readonly PresencePeer[]>
  /** Each side of the page column, in CSS pixels (see PAGE_GUTTER); fit width must allow for it. */
  gutter?: number
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
  overlay,
  peersByPage,
  gutter = PAGE_GUTTER,
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
    () => ({
      scrollToPage: (index) => virtualizer.scrollToIndex(index, { align: 'start' }),
      scrollToPoint: (index, top) => {
        const view = scroller.current?.clientHeight ?? 0
        const start = heightBefore[index] * zoom + GAP * index
        const at = start + SLOT_PADDING_TOP + top - view / 3
        virtualizer.scrollToOffset(Math.max(0, at))
      },
    }),
    [virtualizer, zoom, heightBefore],
  )

  return (
    <section
      ref={scroller}
      className="page-list flex-1 overflow-auto outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-red"
      aria-label="Pages"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling region takes focus for keyboard paging
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      <div
        className="page-list-inner relative w-full"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {items.map((item) => {
          const page = pages[item.index]
          return (
            <div
              key={item.key}
              // The padding is the one source for the virtualiser's sizing (SLOT_PADDING_TOP) and
              // for fit width (the gutter, via fitAllowance).
              className="page-slot absolute top-0 left-0 box-border w-max min-w-full"
              style={{
                transform: `translateY(${item.start}px)`,
                height: item.size,
                paddingTop: SLOT_PADDING_TOP,
                paddingInline: gutter,
              }}
            >
              <PageCanvas
                pdf={pdf}
                pageIndex={item.index}
                zoom={zoom}
                width={page.width}
                height={page.height}
              >
                {overlay?.(item.index)}
                <AvatarGroup
                  className="page-presence"
                  peers={peersByPage?.get(item.index) ?? []}
                  pageIndex={item.index}
                />
              </PageCanvas>
            </div>
          )
        })}
      </div>
    </section>
  )
}
