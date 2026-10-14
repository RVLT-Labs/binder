import type { DocHit } from '@binder/core'
import {
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { SearchPanel } from '../search/SearchPanel'
import { useDocumentSearch } from '../search/useDocumentSearch'
import { fitWidthZoom, viewerKeyAction, zoomIn, zoomOut } from './controls'
import { PageList, type PageListHandle } from './PageList'
import { PageOverlay } from './PageOverlay'
import { SearchHighlights } from './SearchHighlights'
import { ThumbnailRail } from './ThumbnailRail'
import { usePdfDocument } from './usePdfDocument'
import { ViewerToolbar } from './ViewerToolbar'

/** Page list padding plus room for a classic scrollbar, so fit width never scrolls sideways. */
const FIT_ALLOWANCE = 48
/** How long the view rests on a page before the URL follows it. */
const URL_SETTLE_MS = 250

export interface ViewerPage {
  id: string
  width: number
  height: number
  thumb_key: string | null
}

export interface ViewerProps {
  /** The version being shown; its text is what search looks through. */
  versionId: string
  /** The version's searchable PDF. */
  pdfUrl: string
  pages: readonly ViewerPage[]
  versionLabel: string
  /** Zero-based page to open at. */
  initialPage: number
  /** Called with the one-based page in view once scrolling settles. */
  onPageChange: (pageNumber: number) => void
  /** Drawn in each mounted page's overlay (displayed space), above search highlights. */
  renderOverlay?: (pageIndex: number, zoom: number) => ReactNode
  /** Extra toolbar controls, e.g. the markup tools. */
  tools?: ReactNode
  /** A panel beside the pages, e.g. layers and the cue editor. */
  side?: ReactNode
  ref?: Ref<ViewerHandle>
}

export interface ViewerHandle {
  /** Scrolls a point of a page (displayed y, in points) into view. */
  scrollToPoint(pageIndex: number, y: number): void
  /** Focuses the toolbar's page input. */
  focusPageInput(): void
}

/** Toolbar, thumbnail rail, and the virtualised page list for one ready document version. */
export function Viewer({
  versionId,
  pdfUrl,
  pages,
  versionLabel,
  initialPage,
  onPageChange,
  renderOverlay,
  tools,
  side,
  ref,
}: ViewerProps) {
  const { pdf, status, error } = usePdfDocument(pdfUrl)
  const firstPage = Math.min(Math.max(0, initialPage), pages.length - 1)
  const [current, setCurrent] = useState(firstPage)
  /** Where the page list opens once the PDF has loaded; jumps before then land here. */
  const [openAt, setOpenAt] = useState(firstPage)
  const [zoom, setZoom] = useState<number | null>(null)
  const documentSearch = useDocumentSearch(versionId)
  const [hits, setHits] = useState<DocHit[]>([])
  const [activeHit, setActiveHit] = useState<number | null>(null)
  const area = useRef<HTMLDivElement>(null)
  const list = useRef<PageListHandle>(null)
  const pageInput = useRef<HTMLInputElement>(null)

  const widest = useMemo(() => Math.max(...pages.map((p) => p.width)), [pages])
  const fit = useCallback(
    () => fitWidthZoom((area.current?.clientWidth ?? 0) - FIT_ALLOWANCE, widest),
    [widest],
  )
  // Open at fit width, measured before the first paint so pages never render at a throwaway zoom.
  useLayoutEffect(() => {
    if (zoom === null) setZoom(fit())
  }, [zoom, fit])

  useEffect(() => {
    const timer = setTimeout(() => onPageChange(current + 1), URL_SETTLE_MS)
    return () => clearTimeout(timer)
  }, [current, onPageChange])

  const goTo = useCallback(
    (index: number) => {
      const target = Math.min(Math.max(0, index), pages.length - 1)
      if (list.current) return list.current.scrollToPage(target)
      setOpenAt(target)
      setCurrent(target)
    },
    [pages.length],
  )

  useImperativeHandle(
    ref,
    () => ({
      scrollToPoint(pageIndex, y) {
        const page = pages[pageIndex]
        if (!page || zoom === null) return
        if (list.current) list.current.scrollToPoint(pageIndex, (page.height - y) * zoom)
        else goTo(pageIndex)
      },
      focusPageInput: () => pageInput.current?.focus(),
    }),
    [pages, zoom, goTo],
  )

  const hitsByPage = useMemo(() => {
    const byPage = new Map<number, DocHit[]>()
    for (const hit of hits) byPage.set(hit.pageIndex, [...(byPage.get(hit.pageIndex) ?? []), hit])
    return byPage
  }, [hits])

  const activateHit = useCallback(
    (found: readonly DocHit[], index: number) => {
      setActiveHit(index)
      goTo(found[index].pageIndex)
    },
    [goTo],
  )

  const overlay = useCallback(
    (pageIndex: number) => {
      const pageHits = hitsByPage.get(pageIndex)
      const words = documentSearch.layers?.get(pageIndex)?.words
      const page = pages[pageIndex]
      if (zoom === null) return null
      const markup = renderOverlay?.(pageIndex, zoom)
      if ((!pageHits || !words) && !markup) return null
      return (
        <PageOverlay width={page.width} height={page.height} zoom={zoom}>
          {pageHits && words && (
            <SearchHighlights
              hits={pageHits}
              words={words}
              active={activeHit === null ? null : hits[activeHit]}
            />
          )}
          {markup}
        </PageOverlay>
      )
    },
    [hitsByPage, documentSearch.layers, pages, zoom, activeHit, hits, renderOverlay],
  )

  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    const action = viewerKeyAction(e)
    if (!action || zoom === null) return
    e.preventDefault()
    if (action === 'nextPage') goTo(current + 1)
    else if (action === 'prevPage') goTo(current - 1)
    else if (action === 'zoomIn') setZoom(zoomIn(zoom))
    else if (action === 'zoomOut') setZoom(zoomOut(zoom))
    else setZoom(fit())
  }

  return (
    <div className="viewer">
      <ViewerToolbar
        zoom={zoom ?? 1}
        onZoomIn={() => setZoom((z) => zoomIn(z ?? 1))}
        onZoomOut={() => setZoom((z) => zoomOut(z ?? 1))}
        onFitWidth={() => setZoom(fit())}
        pageNumber={current + 1}
        pageCount={pages.length}
        onGoToPage={(n) => goTo(n - 1)}
        versionLabel={versionLabel}
        pageInputRef={pageInput}
      >
        {tools}
      </ViewerToolbar>
      <div className="viewer-body">
        <ThumbnailRail pages={pages} current={current} onSelect={goTo} />
        <div ref={area} className="viewer-pages">
          {status === 'error' ? (
            <p role="alert" className="viewer-message">
              {error}
            </p>
          ) : pdf && zoom !== null ? (
            <PageList
              ref={list}
              pdf={pdf}
              pages={pages}
              zoom={zoom}
              overlay={overlay}
              initialPage={openAt}
              onVisiblePage={setCurrent}
              onKeyDown={onKeyDown}
            />
          ) : (
            <p className="viewer-message">Loading PDF…</p>
          )}
        </div>
        {side && <aside className="markup-panel">{side}</aside>}
        <SearchPanel
          search={documentSearch.search}
          loading={documentSearch.loading}
          unavailable={documentSearch.unavailable}
          hits={hits}
          active={activeHit}
          onResults={(found, jump) => {
            setHits(found)
            setActiveHit(null)
            if (jump && found.length > 0) activateHit(found, 0)
          }}
          onActivate={(index) => activateHit(hits, index)}
        />
      </div>
    </div>
  )
}
