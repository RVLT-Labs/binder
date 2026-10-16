import type { DocHit } from '@binder/core'
import {
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { usePresencePeers } from '../presence/PresenceProvider'
import { peersByPage } from '../presence/peers'
import { SearchPanel } from '../search/SearchPanel'
import { useDocumentSearch } from '../search/useDocumentSearch'
import { useBreakpoint } from '../shell/useBreakpoint'
import {
  fitAllowance,
  fitWidthZoom,
  PAGE_GUTTER,
  PHONE_PAGE_GUTTER,
  SCROLLBAR_ROOM,
  TABLET_PAGE_GUTTER,
  viewerKeyAction,
  zoomIn,
  zoomOut,
} from './controls'
import { PageList, type PageListHandle } from './PageList'
import { PageOverlay } from './PageOverlay'
import { PhoneBarMenu, type PhoneBarMenuProps } from './PhoneBarMenu'
import { SearchHighlights } from './SearchHighlights'
import { StatusBar, type StatusBarProps } from './StatusBar'
import { ThumbnailRail } from './ThumbnailRail'
import { usePdfDocument } from './usePdfDocument'
import { ViewerToolbar } from './ViewerToolbar'

/** The width of a classic scrollbar here (0 where scrollbars overlay the content). */
let measuredScrollbar: number | null = null
function scrollbarWidth(): number {
  if (measuredScrollbar !== null) return measuredScrollbar
  const probe = document.createElement('div')
  probe.style.cssText =
    'position:absolute;top:-9999px;width:100px;height:100px;overflow:scroll;visibility:hidden'
  document.body.append(probe)
  measuredScrollbar = probe.offsetWidth - probe.clientWidth
  probe.remove()
  return measuredScrollbar
}

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
  /** Zero-based page to open at. */
  initialPage: number
  /** Called with the one-based page in view once scrolling settles. */
  onPageChange: (pageNumber: number) => void
  /** Drawn in each mounted page's overlay (displayed space), above search highlights. */
  renderOverlay?: (pageIndex: number, zoom: number) => ReactNode
  /** Drawn on the stage, floating over its left edge: the markup tool strip. Not drawn at phone. */
  tools?: ReactNode
  /**
   * Phone only: the document's actions for the top bar's "..." menu (see PhoneBarMenu), which the
   * viewer draws together with the page position and its own controls.
   */
  phoneItems?: PhoneBarMenuProps['items']
  /** Phone only: the markup tools, listed in that menu (the strip drawn inline). */
  phoneTools?: ReactNode
  /** The column of page thumbnails. */
  thumbnails?: boolean
  /** What the status bar says beside the page number. */
  status?: Pick<StatusBarProps, 'snap' | 'onSnapChange' | 'activeLayer'>
  /**
   * The context panel: docked beside the stage at desktop, over its right edge at tablet (the body
   * is positioned for it), a drawer outside the layout at phone.
   */
  side?: ReactNode
  /** Phone only: floats at the stage's bottom right, e.g. the Place cue button. */
  phoneAction?: ReactNode
  ref?: Ref<ViewerHandle>
}

export interface ViewerHandle {
  /** Scrolls a point of a page (displayed y, in points) into view. */
  scrollToPoint(pageIndex: number, y: number, at?: number): void
  /** Focuses the toolbar's page input. */
  focusPageInput(): void
  /** Opens the Find card (if it is closed) and focuses its search box. */
  focusSearch(): void
  /** Scrolls to a page (zero-based). */
  goToPage(index: number): void
  /** Opens the Find card on `query` and goes to its first hit (the command palette's "In the script"). */
  searchFor(query: string): void
  /**
   * The page under the middle of the view and the point of it that sits there (displayed points, y
   * up), or null before the pages are drawn. Where the phone's Place cue button places a cue.
   */
  visiblePoint(): { pageIndex: number; point: { x: number; y: number } } | null
}

/**
 * The script screen below the top bar: thumbnails, the stage with the virtualised page list and the
 * floating tool strip, the side panels, and the status bar with the page and zoom controls (in the
 * top bar's menu at phone width) for one ready document version.
 */
export function Viewer({
  versionId,
  pdfUrl,
  pages,
  initialPage,
  onPageChange,
  renderOverlay,
  tools,
  phoneItems,
  phoneTools,
  thumbnails = true,
  status = { snap: false, activeLayer: null },
  side,
  phoneAction,
  ref,
}: ViewerProps) {
  const breakpoint = useBreakpoint()
  const snapId = useId()
  const phone = breakpoint === 'phone'
  const { pdf, status: pdfStatus, error } = usePdfDocument(pdfUrl)
  const firstPage = Math.min(Math.max(0, initialPage), pages.length - 1)
  const [current, setCurrent] = useState(firstPage)
  /** Where the page list opens once the PDF has loaded; jumps before then land here. */
  const [openAt, setOpenAt] = useState(firstPage)
  const [zoom, setZoom] = useState<number | null>(null)
  const documentSearch = useDocumentSearch(versionId)
  const { peers } = usePresencePeers()
  const onPages = useMemo(() => peersByPage(peers, versionId), [peers, versionId])
  const [hits, setHits] = useState<DocHit[]>([])
  const [activeHit, setActiveHit] = useState<number | null>(null)
  const area = useRef<HTMLDivElement>(null)
  const list = useRef<PageListHandle>(null)
  const pageInput = useRef<HTMLInputElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  /** The Find card is open: the strip's Find tool or `/` opens it, Escape or its close button shuts it. */
  const [findOpen, setFindOpen] = useState(false)
  /** What had focus when Find opened, so closing it puts the cursor back there. */
  const findOpener = useRef<Element | null>(null)
  /** A search the Find card is asked to run as it opens (see `searchFor`); `n` makes a repeat count. */
  const [findSeed, setFindSeed] = useState<{ text: string; n: number } | null>(null)

  const widest = useMemo(() => Math.max(...pages.map((p) => p.width)), [pages])
  const gutter = phone
    ? PHONE_PAGE_GUTTER
    : breakpoint === 'tablet'
      ? TABLET_PAGE_GUTTER
      : PAGE_GUTTER
  /** The zoom is the fit-width one (opening, Fit width), so a change of stage width re-fits it. */
  const fitted = useRef(true)
  const fit = useCallback(() => {
    const stage = area.current
    // Desktop keeps room for a classic scrollbar. A tablet or phone has overlay ones (the mockups
    // fill the width to the gutters); a classic one on a narrow desktop window is measured.
    const room = breakpoint === 'desktop' ? SCROLLBAR_ROOM : scrollbarWidth()
    return fitWidthZoom((stage?.clientWidth ?? 0) - fitAllowance(gutter, room), widest)
  }, [widest, gutter, breakpoint])
  /** A zoom the user chose: it stays when the stage changes width. */
  const zoomTo = useCallback((next: number | ((z: number | null) => number)) => {
    fitted.current = false
    setZoom(next)
  }, [])
  /** Fit width: the zoom follows the stage from here on. */
  const fitWidth = useCallback(() => {
    fitted.current = true
    setZoom(fit())
  }, [fit])
  // Open at fit width, measured before the first paint so pages never render at a throwaway zoom.
  useLayoutEffect(() => {
    if (zoom === null) setZoom(fit())
  }, [zoom, fit])
  // The stage changes width without a window resize (the Review tab widens the docked panel from
  // 300 to 420 px, a sheet or the thumbnails open): a page still at fit width follows it.
  const hasZoom = zoom !== null
  useEffect(() => {
    const stage = area.current
    if (!hasZoom || !stage) return
    if (fitted.current) setZoom(fit())
    if (typeof ResizeObserver === 'undefined') return
    let width = stage.clientWidth
    const observer = new ResizeObserver(() => {
      if (stage.clientWidth === width) return
      width = stage.clientWidth
      if (fitted.current) setZoom(fit())
    })
    observer.observe(stage)
    return () => observer.disconnect()
  }, [hasZoom, fit])

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
      scrollToPoint(pageIndex, y, at) {
        const page = pages[pageIndex]
        if (!page || zoom === null) return
        if (list.current) list.current.scrollToPoint(pageIndex, (page.height - y) * zoom, at)
        else goTo(pageIndex)
      },
      focusPageInput: () => pageInput.current?.focus(),
      focusSearch() {
        if (searchInput.current) return searchInput.current.focus()
        findOpener.current = document.activeElement
        setFindOpen(true)
      },
      goToPage: (index) => goTo(index),
      searchFor(query) {
        if (!searchInput.current) {
          findOpener.current = document.activeElement
          setFindOpen(true)
        }
        setFindSeed((prev) => ({ text: query, n: (prev?.n ?? 0) + 1 }))
      },
      visiblePoint() {
        const at = list.current?.visibleCentre()
        const page = at && pages[at.pageIndex]
        if (!at || !page) return null
        return { pageIndex: at.pageIndex, point: { x: page.width / 2, y: at.y } }
      },
    }),
    [pages, zoom, goTo],
  )

  const closeFind = useCallback(() => {
    setFindOpen(false)
    // A search the palette asked for was this card's to run once: opening it again starts empty.
    setFindSeed(null)
    setHits([])
    setActiveHit(null)
    const back = findOpener.current
    findOpener.current = null
    // the box is going away: hand the cursor back, to the page list when its old holder has gone
    queueMicrotask(() => {
      if (back instanceof HTMLElement && back.isConnected && back !== document.body) back.focus()
      else document.querySelector<HTMLElement>('.page-list')?.focus()
    })
  }, [])

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
        <PageOverlay
          width={page.width}
          height={page.height}
          zoom={zoom}
          label={markup ? `Page ${pageIndex + 1} markup` : undefined}
        >
          {pageHits && words && (
            // Highlights are visual only: the search panel lists the same hits as text.
            // biome-ignore lint/a11y/noAriaHiddenOnFocusable: a plain SVG group, never focusable
            <g aria-hidden="true">
              <SearchHighlights
                hits={pageHits}
                words={words}
                active={activeHit === null ? null : hits[activeHit]}
              />
            </g>
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
    else if (action === 'zoomIn') zoomTo(zoomIn(zoom))
    else if (action === 'zoomOut') zoomTo(zoomOut(zoom))
    else fitWidth()
  }

  const controls = (
    <ViewerToolbar
      zoom={zoom ?? 1}
      onZoomIn={() => zoomTo((z) => zoomIn(z ?? 1))}
      onZoomOut={() => zoomTo((z) => zoomOut(z ?? 1))}
      onFitWidth={fitWidth}
      pageNumber={current + 1}
      pageCount={pages.length}
      onGoToPage={(n) => goTo(n - 1)}
      pageInputRef={pageInput}
      size={phone ? 'touch' : 'compact'}
      className="flex-wrap"
    />
  )

  return (
    <div className="viewer flex min-h-0 flex-1 flex-col">
      {phone && phoneItems && (
        <PhoneBarMenu
          page={{ current, count: pages.length }}
          items={phoneItems}
          viewer={
            <div className="flex flex-col gap-1">
              <span className="t-over">View</span>
              {controls}
              {status.onSnapChange && (
                // the status bar's toggle is not drawn at phone width: it is here instead
                <div className="flex min-h-11 items-center gap-3 text-[14px] text-ink">
                  <Checkbox
                    id={snapId}
                    checked={status.snap}
                    onCheckedChange={(on) => status.onSnapChange?.(on === true)}
                  />
                  <Label htmlFor={snapId} className="flex-1 cursor-pointer text-[14px] text-ink">
                    Snap to text
                  </Label>
                </div>
              )}
              {phoneTools && (
                <>
                  <span className="t-over mt-2">Markup tools</span>
                  {phoneTools}
                </>
              )}
            </div>
          }
        />
      )}
      <div className="viewer-body relative flex min-h-0 flex-1 max-md:flex-col">
        {thumbnails && !phone && (
          <ThumbnailRail pages={pages} current={current} onSelect={goTo} peersByPage={onPages} />
        )}
        {/* The stage: the dark the pages sit on. The tool strip floats in its left gutter. */}
        <div
          ref={area}
          className={cn('viewer-pages relative flex min-h-0 min-w-0 flex-1 bg-stage')}
        >
          {!phone && tools}
          {findOpen && (
            <SearchPanel
              // At tablet width the context sheet (360 px) can be open over the stage's right edge:
              // the card sits left of it, never behind it.
              className="absolute top-3 right-6 z-20 w-[min(20rem,calc(100%-2rem))] max-md:right-4 md:max-[1024px]:right-[calc(360px+1.5rem)]"
              inputRef={searchInput}
              seed={findSeed}
              search={documentSearch.search}
              loading={documentSearch.loading}
              unavailable={documentSearch.unavailable}
              hits={hits}
              active={activeHit}
              onClose={closeFind}
              onResults={(found, jump) => {
                setHits(found)
                setActiveHit(null)
                if (jump && found.length > 0) activateHit(found, 0)
              }}
              onActivate={(index) => activateHit(hits, index)}
            />
          )}
          {phone && phoneAction}
          {pdfStatus === 'error' ? (
            <p role="alert" className="viewer-message p-4 text-t-out">
              {error}
            </p>
          ) : pdf && zoom !== null ? (
            <PageList
              ref={list}
              pdf={pdf}
              pages={pages}
              zoom={zoom}
              gutter={gutter}
              overlay={overlay}
              peersByPage={onPages}
              initialPage={openAt}
              onVisiblePage={setCurrent}
              onKeyDown={onKeyDown}
            />
          ) : (
            <p className="viewer-message p-4 text-ink-2">Loading PDF…</p>
          )}
        </div>
        {side}
      </div>
      {!phone && (
        <StatusBar
          page={current + 1}
          pages={pages.length}
          snap={status.snap}
          onSnapChange={status.onSnapChange}
          activeLayer={status.activeLayer}
        >
          {controls}
        </StatusBar>
      )}
    </div>
  )
}
