import { useQuery } from '@powersync/react'
import { createFileRoute, Outlet, useChildMatches, useNavigate } from '@tanstack/react-router'
import {
  type ComponentProps,
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Button } from '@/components/ui/button'
import { RowsSkeleton } from '@/components/ui/skeleton'
import { blobUrl } from '../blobs/fetchBlob'
import { CallingStatusLine, CallingView } from '../calling/CallingView'
import { ModeAnnouncer } from '../calling/ModeAnnouncer'
import { usePageTurn } from '../calling/usePageTurn'
import { useWakeLock } from '../calling/useWakeLock'
import { PrintButton, PrintDialog } from '../exports/PrintDialog'
import { AnnotationHistory, CueHistory } from '../history/HistoryPanel'
import { AnnotationEditor } from '../markup/AnnotationEditor'
import { CueEditor } from '../markup/CueEditor'
import { LayerPanel } from '../markup/LayerPanel'
import { PageMarkup } from '../markup/MarkupOverlay'
import { MarkupSessionProvider, useMarkupSession } from '../markup/MarkupSession'
import { PlaceCueButton } from '../markup/PlaceCueButton'
import { endRelocate } from '../markup/relocate'
import { SelectionAnnouncer } from '../markup/SelectionAnnouncer'
import { clearSelection, useSelection } from '../markup/selection'
import { ToolStrip } from '../markup/ToolStrip'
import { UndoRedoButtons } from '../markup/UndoRedoButtons'
import { type CallingKeys, useMarkupShortcuts } from '../markup/useMarkupShortcuts'
import { useOnline } from '../offline/useOnline'
import { PaletteDocumentHostRegistration } from '../palette/PaletteDocumentHost'
import { useRenumber } from '../palette/useCanRenumber'
import { ContextPanel, type PanelTab } from '../panel/ContextPanel'
import { Note } from '../panel/fields'
import { type PanelState, type PanelTabId, usePanelState } from '../panel/usePanelState'
import type { DocumentRow, DocumentVersionRow, PageRow } from '../powersync/schema'
import { PresencePublisher } from '../presence/PresencePublisher'
import { useVersionAnchors } from '../revisions/api'
import { ReviewPanel } from '../revisions/ReviewPanel'
import { UploadRevisionDialog } from '../revisions/UploadRevisionDialog'
import { useCanUpload } from '../revisions/useCanUpload'
import { useReviewCount } from '../revisions/useReviewCount'
import { VersionSwitcher } from '../revisions/VersionSwitcher'
import { versionReadOnlyReason } from '../revisions/versionView'
import { setShellInert } from '../shell/shellInert'
import { useBreakpoint } from '../shell/useBreakpoint'
import {
  DocumentControls,
  type DocumentControlsProps,
  documentMenuItems,
} from '../viewer/DocumentControls'
import { VersionStatus } from '../viewer/VersionStatus'
import { Viewer, type ViewerHandle } from '../viewer/Viewer'

interface DocumentSearch {
  /** A version to view instead of the document's current one. */
  v?: string
  /** One-based page to open at. */
  p?: number
  /** A cue to select and scroll to once the markup has loaded (from the cue list). */
  cue?: string
  /** Open the context panel on its Review tab (once: the address drops it). */
  review?: boolean
  /** Calling mode (DESIGN §9): the page and the strip, nothing to edit. */
  mode?: 'calling'
}

/** Why Calling mode takes no edits: the markup session's read-only reason while it is on. */
const CALLING_READ_ONLY = 'Calling mode is read-only.'

function positiveInt(value: unknown): number | undefined {
  const n = typeof value === 'string' ? Number(value) : value
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 ? n : undefined
}

export const Route = createFileRoute('/shows/$showId/docs/$docId')({
  validateSearch: (search: Record<string, unknown>): DocumentSearch => ({
    v: typeof search.v === 'string' && search.v ? search.v : undefined,
    p: positiveInt(search.p),
    cue: typeof search.cue === 'string' && search.cue ? search.cue : undefined,
    review: search.review === true || search.review === 'true' ? true : undefined,
    mode: search.mode === 'calling' ? 'calling' : undefined,
  }),
  component: DocumentPage,
})

function DocumentPage() {
  const { showId, docId } = Route.useParams()
  const { v, p, cue, review, mode } = Route.useSearch()
  const calling = mode === 'calling'
  const children = useChildMatches()
  const online = useOnline()
  const canUpload = useCanUpload(showId)
  const reviewCount = useReviewCount(docId)
  const [uploading, setUploading] = useState(false)
  // Print from the phone's menu: the page holds the dialog, so the menu can close behind it.
  const [printing, setPrinting] = useState(false)
  const printOpener = useRef<HTMLElement | null>(null)
  /** The control that opened Upload revision, so focus can go back to it. */
  const uploadOpener = useRef<HTMLElement | null>(null)
  const breakpoint = useBreakpoint()
  /** The thumbnails column: always on desktop, off by default on a tablet (a top bar toggle), never on a phone. */
  const [thumbsOpen, setThumbsOpen] = useState(false)
  const thumbnails = breakpoint === 'desktop' || (breakpoint === 'tablet' && thumbsOpen)
  const navigate = useNavigate({ from: Route.fullPath })
  const viewer = useRef<ViewerHandle>(null)
  /** Zero-based page in view, as the viewer last settled on it: what presence tells the show. */
  const [viewPage, setViewPage] = useState(() => (p ?? 1) - 1)
  // The context panel's tab and, where it is a sheet or drawer, whether it is drawn. `?review=`
  // (the overview's Needs you link, a finished upload) opens it on Review, and is then dropped.
  const dropReview = useCallback(
    () =>
      void navigate({
        search: (prev) => ({ ...prev, review: undefined }),
        replace: true,
        resetScroll: false,
      }),
    [navigate],
  )
  const panel = usePanelState({ review: review === true, onReviewHandled: dropReview })
  const { data: docs, isLoading } = useQuery<DocumentRow>(
    'SELECT * FROM documents WHERE id = ? AND show_id = ?',
    [docId, showId],
  )
  const { data: versions } = useQuery<DocumentVersionRow>(
    'SELECT * FROM document_versions WHERE document_id = ? ORDER BY version_number',
    [docId],
  )
  const { data: shows } = useQuery<{ title: string | null }>(
    'SELECT title FROM shows WHERE id = ?',
    [showId],
  )
  const { can: canRenumber, search: renumberSearch } = useRenumber(showId)
  const doc = docs[0]
  const version =
    versions.find((x) => x.id === v) ??
    versions.find((x) => x.id === doc?.current_version_id) ??
    versions.at(-1)
  const { data: pages } = useQuery<PageRow>(
    'SELECT * FROM pages WHERE document_version_id = ? ORDER BY "index"',
    [version?.id ?? ''],
  )

  const currentId = doc?.current_version_id ?? null
  const isCurrent = !version || !currentId || version.id === currentId
  const ready = version?.status === 'ready'
  /** The viewer draws (and so the context panel exists) once the version's text and pages are in. */
  const viewerReady = ready && Boolean(version?.searchable_key) && pages.length > 0
  /** Only a ready version can be called: there is nothing to show before its pages are in. */
  const inCalling = calling && viewerReady
  // History can restore Calling without using setCalling. Retained menu/palette callbacks
  // must read the current mode, and an open Print must not return when Calling ends.
  const callingNow = useRef(inCalling)
  callingNow.current = inCalling
  const openPrint = useCallback((opener: HTMLElement | null) => {
    if (callingNow.current) return
    printOpener.current = opener
    setPrinting(true)
  }, [])
  useEffect(() => {
    if (inCalling) setPrinting(false)
  }, [inCalling])
  // While Calling covers the screen the shell's rail and bars are out of reach (focus and readers).
  useEffect(() => {
    setShellInert(inCalling)
    return () => setShellInert(false)
  }, [inCalling])
  // A long scene must not dim and lock the tablet while the caller is working from the page.
  useWakeLock(inCalling)
  // A version that is not current is drawn where its rows were: from the server when online, else
  // from the device's rows that still point at it.
  const { anchors: remoteAnchors, loading: anchorsLoading } = useVersionAnchors(
    version?.id ?? '',
    !isCurrent && ready,
  )
  const historic = useMemo(
    () => (isCurrent || !doc ? null : { documentId: doc.id, anchors: remoteAnchors }),
    [isCurrent, doc, remoteAnchors],
  )
  const localOnly = !isCurrent && !remoteAnchors && !anchorsLoading
  const versionNumbers = useMemo(
    () => new Map(versions.map((x) => [x.id, x.version_number ?? 0] as const)),
    [versions],
  )

  const viewerPages = useMemo(
    () =>
      pages.map((page) => ({
        id: page.id,
        width: page.width ?? 0,
        height: page.height ?? 0,
        thumb_key: page.thumb_key,
      })),
    [pages],
  )

  const renderOverlay = useCallback(
    (pageIndex: number, zoom: number) => {
      const page = pages[pageIndex]
      return page ? <PageMarkup page={page} zoom={zoom} /> : null
    },
    [pages],
  )

  // Leaving Calling hands focus back to the control that enters it (on a phone, the menu button).
  const wasCalling = useRef(false)
  useEffect(() => {
    if (wasCalling.current && !calling) {
      requestAnimationFrame(() =>
        (
          document.querySelector<HTMLElement>('[data-calling-toggle]') ??
          document.querySelector<HTMLElement>('button[aria-label="Document options"]')
        )?.focus(),
      )
    }
    wasCalling.current = calling
  }, [calling])

  // The URL follows the page in view without adding history entries.
  const onPageChange = useCallback(
    (page: number) => {
      setViewPage(page - 1)
      if (page !== p) {
        void navigate({
          search: (prev) => ({ ...prev, p: page }),
          replace: true,
          resetScroll: false,
        })
      }
    },
    [navigate, p],
  )

  if (children.length > 0) return <Outlet />
  if (isLoading) return <RowsSkeleton className="m-6" />
  if (!doc) return <p className="p-6 text-ink-2">Document not found.</p>

  /** Into Calling mode or out of it: the page, its zoom mode and the pages' place stay as they are. */
  function setCalling(on: boolean) {
    // The context panel and a selection belong to markup; neither comes back open.
    panel.onOpenChange(false)
    clearSelection()
    // A relocation under way is a markup gesture; Calling does not carry it over.
    endRelocate()
    // Back from Calling replaces its history entry, so Back goes on to where markup was.
    void navigate({
      search: (prev) => ({ ...prev, mode: on ? ('calling' as const) : undefined }),
      replace: !on,
      resetScroll: false,
    })
  }

  const controlProps: DocumentControlsProps | null = version
    ? {
        version: (display) => (
          <VersionSwitcher
            showId={showId}
            docId={doc.id}
            versions={versions}
            currentId={currentId}
            selectedId={version.id}
            localOnly={localOnly}
            display={display}
            onSelect={(id) => void navigate({ search: { v: id === currentId ? undefined : id } })}
          />
        ),
        panel: viewerReady
          ? {
              open: panel.open,
              onToggle: panel.toggle,
              onOpenTab: panel.openTab,
              review: reviewCount > 0 || versions.length > 1 ? { count: reviewCount } : null,
            }
          : null,
        onUploadRevision:
          canUpload && online
            ? (opener) => {
                uploadOpener.current = opener
                setUploading(true)
              }
            : null,
        thumbnails: { open: thumbsOpen, onToggle: () => setThumbsOpen((open) => !open) },
        print: null,
        onPrint: null,
        onCalling: null,
        onGoToPage: null,
        onRenumber: null,
      }
    : null
  /** The top bar's controls; a ready version adds Print, undo and redo, and (phone) draws its own menu. */
  const controls = (ready?: { history: ReactNode }) =>
    controlProps && (
      <DocumentControls
        {...controlProps}
        print={ready && !inCalling ? <PrintButton /> : null}
        onCalling={ready && viewerReady ? () => setCalling(true) : null}
        onGoToPage={ready ? () => viewer.current?.focusPageInput() : null}
        onRenumber={
          ready && canRenumber
            ? () =>
                void navigate({
                  to: '/shows/$showId/cues',
                  params: { showId },
                  search: renumberSearch,
                })
            : null
        }
        onPrint={ready && !inCalling ? openPrint : null}
        history={ready?.history}
        viewerOwnsPhoneBar={Boolean(ready)}
      />
    )

  return (
    <div className="document-page flex min-h-0 min-w-0 flex-1 flex-col">
      {/* The title is in the breadcrumbs; the page keeps its heading for assistive technology. */}
      <h1 className="sr-only">{doc.title}</h1>
      {uploading && (
        <UploadRevisionDialog
          showId={showId}
          documentId={doc.id}
          documentTitle={doc.title ?? 'document'}
          returnFocusTo={uploadOpener.current}
          onClose={() => setUploading(false)}
          onReanchored={() => {
            setUploading(false)
            void navigate({ search: { review: true }, replace: true })
          }}
        />
      )}
      {!version ? (
        <p className="p-6 text-ink-2">This document has no versions.</p>
      ) : version.status !== 'ready' ? (
        <>
          {controls()}
          <VersionStatus version={version} />
        </>
      ) : !version.searchable_key || pages.length === 0 ? (
        <>
          {controls()}
          <p className="viewer-message p-6 text-ink-2">Loading pages…</p>
        </>
      ) : (
        <MarkupSessionProvider
          key={version.id}
          showId={showId}
          documentId={doc.id}
          versionId={version.id}
          pages={pages}
          snapDefault={doc.snap_to_text}
          viewer={viewer}
          versionReadOnly={
            inCalling
              ? CALLING_READ_ONLY
              : isCurrent
                ? null
                : versionReadOnlyReason(version.version_number ?? 0)
          }
          historic={historic}
        >
          <ModeAnnouncer
            calling={inCalling}
            page={Math.min(viewPage, pages.length - 1)}
            pageCount={pages.length}
          />
          <MarkupKeys calling={{ active: inCalling, onToggle: () => setCalling(!inCalling) }} />
          <PaletteDocumentHostRegistration
            documentId={doc.id}
            versionId={version.id}
            pageCount={pages.length}
            onPrint={openPrint}
            calling={inCalling}
            onToggleCalling={() => setCalling(!inCalling)}
          />
          <PresencePublisher
            showId={showId}
            documentId={doc.id}
            versionId={version.id}
            pageIndex={Math.min(viewPage, pages.length - 1)}
          />
          <FocusCue
            cueId={cue}
            onDone={() =>
              void navigate({
                search: (prev) => ({ ...prev, cue: undefined }),
                replace: true,
                resetScroll: false,
              })
            }
          />
          {!inCalling && controls({ history: <UndoRedoButtons /> })}
          {!inCalling && printing && (
            <PrintDialog
              documentId={doc.id}
              versionId={version.id}
              returnFocusTo={printOpener.current}
              onClose={() => setPrinting(false)}
            />
          )}
          <ScriptViewer
            viewer={viewer}
            versionId={version.id}
            pdfUrl={blobUrl(version.searchable_key)}
            pages={viewerPages}
            initialPage={(p ?? 1) - 1}
            onPageChange={onPageChange}
            renderOverlay={renderOverlay}
            thumbnails={thumbnails}
            phoneItems={
              controlProps && !inCalling
                ? (close, opener) =>
                    documentMenuItems(
                      {
                        ...controlProps,
                        onPrint: openPrint,
                        // the phone's menu is the only way in: there is no bar button or ⇧C
                        onCalling: () => setCalling(true),
                      },
                      close,
                      opener,
                    )
                : undefined
            }
            panel={panel}
            showId={showId}
            documentId={doc.id}
            versionNumbers={versionNumbers}
            reviewCount={reviewCount}
            isCurrent={isCurrent}
            currentId={currentId}
            onSwitchToCurrent={() => void navigate({ search: { review: true } })}
            calling={
              inCalling
                ? {
                    show: shows[0]?.title ?? '',
                    document: `${doc.title ?? 'Document'}${version.version_number ? ` v${version.version_number}` : ''}`,
                    onExit: () => setCalling(false),
                  }
                : null
            }
          />
        </MarkupSessionProvider>
      )}
    </div>
  )
}

interface ScriptPanelProps {
  panel: PanelState
  showId: string
  documentId: string
  versionNumbers: ReadonlyMap<string, number>
  reviewCount: number
  isCurrent: boolean
  currentId: string | null
  onSwitchToCurrent: () => void
}

/** Set while the script is in Calling mode: what its status line says, and how it ends. */
interface CallingProps {
  show: string
  document: string
  onExit: () => void
}

/** The viewer with the markup session's tools, status and context panel wired in. */
function ScriptViewer({
  viewer,
  panel,
  showId,
  documentId,
  versionNumbers,
  reviewCount,
  isCurrent,
  currentId,
  onSwitchToCurrent,
  calling,
  ...props
}: Omit<
  ComponentProps<typeof Viewer>,
  'tools' | 'phoneTools' | 'status' | 'ref' | 'side' | 'phoneAction' | 'readOnly' | 'calling'
> &
  ScriptPanelProps & { viewer: Ref<ViewerHandle>; calling: CallingProps | null }) {
  const session = useMarkupSession()
  const selection = useSelection()
  const active = session.active
  const stage = usePageTurn((direction) => session.viewer.current?.turnPage(direction))
  return (
    <>
      <SelectionAnnouncer />
      <Viewer
        ref={viewer}
        {...props}
        readOnly={calling !== null}
        calling={
          calling
            ? {
                header: <CallingStatusLine show={calling.show} document={calling.document} />,
                floating: (page) => (
                  <CallingView page={page} pageCount={props.pages.length} onExit={calling.onExit} />
                ),
                stage,
              }
            : undefined
        }
        tools={<ToolStrip />}
        phoneTools={<ToolStrip variant="inline" />}
        status={{
          snap: session.snap,
          onSnapChange: session.setSnap,
          activeLayer: active
            ? { name: session.layerName(active), colour: session.layerColour(active) }
            : null,
        }}
        side={
          <ScriptPanel
            panel={panel}
            showId={showId}
            documentId={documentId}
            versionNumbers={versionNumbers}
            reviewCount={reviewCount}
            isCurrent={isCurrent}
            currentId={currentId}
            onSwitchToCurrent={onSwitchToCurrent}
          />
        }
        phoneAction={<PlaceCueButton hidden={selection !== null || panel.open} />}
      />
    </>
  )
}

/** Selects and scrolls to the cue the URL names, once, as soon as the markup has loaded it. */
function FocusCue({ cueId, onDone }: { cueId: string | undefined; onDone: () => void }) {
  const session = useMarkupSession()
  const handled = useRef<string | null>(null)
  const target = cueId ? session.view.ordered.find((c) => c.id === cueId) : undefined
  useEffect(() => {
    // The address dropped it: the same cue may be asked for again (the palette does).
    if (!cueId) handled.current = null
    if (!cueId || !target || handled.current === cueId) return
    handled.current = cueId
    session.showCue(target)
    onDone()
  }, [cueId, target, session, onDone])
  return null
}

/** The markup keys, live while a version is open (and, in Calling mode, only its navigation keys). */
function MarkupKeys({ calling }: { calling: CallingKeys }) {
  useMarkupShortcuts(calling)
  return null
}

/** The tag a closed sheet or drawer hands focus back to: the row that was selected last. */
function selectedTag(selection: { table: string; id: string } | null): HTMLElement | null {
  if (!selection) return null
  const attr = selection.table === 'annotations' ? 'data-annotation-id' : 'data-cue-id'
  return document.querySelector<HTMLElement>(`[${attr}="${CSS.escape(selection.id)}"]`)
}

/**
 * The context panel's four tabs: the selected cue's or annotation's editor over the layers (Cue),
 * the layers alone, the selected row's change log (History) and the revision review (Review, with
 * its count).
 */
function ScriptPanel({
  panel,
  showId,
  documentId,
  versionNumbers,
  reviewCount,
  isCurrent,
  currentId,
  onSwitchToCurrent,
}: ScriptPanelProps) {
  const session = useMarkupSession()
  const selection = useSelection()
  const phone = useBreakpoint() === 'phone'
  // Done clears the selection before the drawer closes: it still has to find the tag.
  const lastSelection = useRef(selection)
  if (selection) lastSelection.current = selection
  // At phone width the drawer covers the lower half of the screen: a tag that lands under it (a cue
  // placed at the middle of the page, one tapped low down) is scrolled up into the part still seen.
  const selectedId = selection?.id
  const selectedTable = selection?.table
  // the session changes with every markup edit; only a new selection moves the page
  const latest = useRef(session)
  latest.current = session
  useEffect(() => {
    if (!phone || !panel.open || !selectedId || !selectedTable) return
    let frame = 0
    let tries = 0
    let observer: ResizeObserver | undefined
    const check = () => {
      const tag = selectedTag({ table: selectedTable, id: selectedId })
      const sheet = document.querySelector<HTMLElement>('[data-panel="drawer"]')
      if (!tag || !sheet) {
        if (tries++ < 30) frame = requestAnimationFrame(check)
        return
      }
      if (!observer && typeof ResizeObserver !== 'undefined') {
        // "More fields" or the tall Review tab can grow the drawer over a tag that was clear of it
        observer = new ResizeObserver(check)
        observer.observe(sheet)
      }
      // the drawer slides in: its height is final, its position is not yet
      const top = window.innerHeight - sheet.offsetHeight
      const stage = document.querySelector('.viewer-pages')?.getBoundingClientRect().top ?? 0
      const at = tag.getBoundingClientRect()
      if (at.bottom <= top - 8 && at.top >= stage) return
      const { view, viewer } = latest.current
      const row =
        selectedTable === 'cues'
          ? view.ordered.find((c) => c.id === selectedId)
          : [...view.annotationsByPage.values()].flat().find((a) => a.id === selectedId)
      // put it in the middle of what the drawer leaves of the stage
      const stageEl = document.querySelector('.viewer-pages')?.getBoundingClientRect()
      const band = Math.max(0, top - (stageEl?.top ?? 0))
      const fraction = stageEl && stageEl.height > 0 ? band / 2 / stageEl.height : 1 / 3
      if (row) viewer.current?.scrollToPoint(row.anchor.pageIndex, row.anchor.y, fraction)
    }
    frame = requestAnimationFrame(check)
    return () => {
      cancelAnimationFrame(frame)
      observer?.disconnect()
    }
  }, [phone, panel.open, selectedId, selectedTable])
  const done = phone
    ? () => {
        clearSelection()
        panel.onOpenChange(false)
      }
    : undefined

  const tabs: PanelTab[] = [
    {
      id: 'cue',
      label: 'Cue',
      content: (
        <>
          {selection?.table === 'cues' && (
            <CueEditor key={selection.id} cueId={selection.id} onDone={done} />
          )}
          {selection?.table === 'annotations' && (
            <AnnotationEditor key={selection.id} annotationId={selection.id} onDone={done} />
          )}
          {!selection && (
            <Note>
              {phone
                ? 'Select a cue or an annotation on the page to edit it. Close this and tap Place cue to add a cue.'
                : 'Select a cue or an annotation on the page to edit it, or press c to place one.'}
            </Note>
          )}
          {/* the phone's sheet is the mockup's: Layers is its own tab there */}
          {!phone && <LayerPanel showId={showId} versionId={session.versionId} labelled />}
        </>
      ),
    },
    {
      id: 'layers',
      label: 'Layers',
      content: <LayerPanel showId={showId} versionId={session.versionId} />,
    },
    {
      id: 'history',
      label: 'History',
      content: !selection ? (
        <Note>Select a cue or an annotation to see its history.</Note>
      ) : selection.table === 'cues' ? (
        <CueHistory key={selection.id} cueId={selection.id} />
      ) : (
        <AnnotationHistory key={selection.id} annotationId={selection.id} />
      ),
    },
    {
      id: 'review',
      label: 'Review',
      badge: reviewCount,
      wide: true,
      content: isCurrent ? (
        <ReviewPanel documentId={documentId} versionNumbers={versionNumbers} />
      ) : (
        <section aria-label="Revision review" className="review-panel flex flex-col gap-2">
          <Note>The review is of the current version.</Note>
          {currentId && (
            <Button type="button" variant="line" size="sm" onClick={onSwitchToCurrent}>
              Go to the current version
            </Button>
          )}
        </section>
      ),
    },
  ]
  return (
    <ContextPanel
      tabs={tabs}
      value={panel.tab}
      onValueChange={(id) => panel.setTab(id as PanelTabId)}
      open={panel.open}
      onOpenChange={panel.onOpenChange}
      showDone={phone && !(panel.tab === 'cue' && selection)}
      returnFocusTo={() => {
        // Closed from inside the panel (Done, Escape) or with focus gone: back to the tag that
        // opened it, or to the menu button when a menu row did. Closed by a control outside it (the
        // tablet's toggle), that control keeps the focus it has.
        const at = document.activeElement
        const inside = !at || at === document.body || at.closest('[data-panel]') !== null
        if (!inside) return null
        if (panel.openedBy() === 'selection') return selectedTag(lastSelection.current)
        return document.querySelector<HTMLElement>('button[aria-label="Document options"]')
      }}
    />
  )
}
