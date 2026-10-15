import { useQuery } from '@powersync/react'
import { createFileRoute, Outlet, useChildMatches, useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { blobUrl } from '../blobs/fetchBlob'
import { PrintButton } from '../exports/PrintDialog'
import { AnnotationHistory, CueHistory } from '../history/HistoryPanel'
import { AnnotationEditor } from '../markup/AnnotationEditor'
import { CueEditor } from '../markup/CueEditor'
import { LayerPanel } from '../markup/LayerPanel'
import { PageMarkup } from '../markup/MarkupOverlay'
import { MarkupSessionProvider, useMarkupSession } from '../markup/MarkupSession'
import { MarkupTools } from '../markup/MarkupTools'
import { SelectionAnnouncer } from '../markup/SelectionAnnouncer'
import { useSelection } from '../markup/selection'
import { useMarkupShortcuts } from '../markup/useMarkupShortcuts'
import { useOnline } from '../offline/useOnline'
import type { DocumentRow, DocumentVersionRow, PageRow } from '../powersync/schema'
import { PresencePublisher } from '../presence/PresencePublisher'
import { useVersionAnchors } from '../revisions/api'
import { ReviewPanel } from '../revisions/ReviewPanel'
import { UploadRevisionDialog } from '../revisions/UploadRevisionDialog'
import { useCanUpload } from '../revisions/useCanUpload'
import { useReviewCount } from '../revisions/useReviewCount'
import { VersionSwitcher } from '../revisions/VersionSwitcher'
import { versionReadOnlyReason } from '../revisions/versionView'
import { Viewer, type ViewerHandle } from '../viewer/Viewer'

interface DocumentSearch {
  /** A version to view instead of the document's current one. */
  v?: string
  /** One-based page to open at. */
  p?: number
  /** A cue to select and scroll to once the markup has loaded (from the cue list). */
  cue?: string
  /** Open the revision review panel. */
  review?: boolean
}

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
  }),
  component: DocumentPage,
})

function versionName(v: DocumentVersionRow): string {
  return `Version ${v.version_number}${v.label ? ` · ${v.label}` : ''}`
}

function DocumentPage() {
  const { showId, docId } = Route.useParams()
  const { v, p, cue, review } = Route.useSearch()
  const children = useChildMatches()
  const online = useOnline()
  const canUpload = useCanUpload(showId)
  const reviewCount = useReviewCount(docId)
  const [uploading, setUploading] = useState(false)
  const navigate = useNavigate({ from: Route.fullPath })
  const viewer = useRef<ViewerHandle>(null)
  /** Zero-based page in view, as the viewer last settled on it: what presence tells the show. */
  const [viewPage, setViewPage] = useState(() => (p ?? 1) - 1)
  const { data: docs, isLoading } = useQuery<DocumentRow>(
    'SELECT * FROM documents WHERE id = ? AND show_id = ?',
    [docId, showId],
  )
  const { data: versions } = useQuery<DocumentVersionRow>(
    'SELECT * FROM document_versions WHERE document_id = ? ORDER BY version_number',
    [docId],
  )
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
  if (isLoading) return <p>Loading…</p>
  if (!doc) return <p>Document not found.</p>

  return (
    <div className="document-page">
      <header className="document-header">
        <h1>{doc.title}</h1>
        {version && (
          <VersionSwitcher
            showId={showId}
            docId={doc.id}
            versions={versions}
            currentId={currentId}
            selectedId={version.id}
            localOnly={localOnly}
            onSelect={(id) => void navigate({ search: { v: id === currentId ? undefined : id } })}
          />
        )}
        {(reviewCount > 0 || review || versions.length > 1) && (
          <button
            type="button"
            className="review-count"
            aria-pressed={review === true}
            onClick={() =>
              void navigate({
                search: (prev) => ({ ...prev, review: prev.review ? undefined : true }),
                replace: true,
                resetScroll: false,
              })
            }
          >
            {reviewCount} to review
          </button>
        )}
        {canUpload && online && (
          <button type="button" onClick={() => setUploading(true)}>
            Upload revision
          </button>
        )}
      </header>
      {uploading && (
        <UploadRevisionDialog
          showId={showId}
          documentId={doc.id}
          documentTitle={doc.title ?? 'document'}
          onClose={() => setUploading(false)}
          onReanchored={() => {
            setUploading(false)
            void navigate({ search: { review: true }, replace: true })
          }}
        />
      )}
      {!version ? (
        <p>This document has no versions.</p>
      ) : version.status !== 'ready' ? (
        <VersionStatus version={version} />
      ) : !version.searchable_key || pages.length === 0 ? (
        <p className="viewer-message">Loading pages…</p>
      ) : (
        <MarkupSessionProvider
          key={version.id}
          showId={showId}
          documentId={doc.id}
          versionId={version.id}
          pages={pages}
          snapDefault={doc.snap_to_text}
          viewer={viewer}
          versionReadOnly={isCurrent ? null : versionReadOnlyReason(version.version_number ?? 0)}
          historic={historic}
        >
          <MarkupKeys />
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
          <Viewer
            ref={viewer}
            versionId={version.id}
            pdfUrl={blobUrl(version.searchable_key)}
            pages={viewerPages}
            versionLabel={versionName(version)}
            initialPage={(p ?? 1) - 1}
            onPageChange={onPageChange}
            renderOverlay={renderOverlay}
            tools={
              <>
                <MarkupTools />
                <PrintButton />
              </>
            }
            side={
              <MarkupSide
                showId={showId}
                documentId={doc.id}
                versionNumbers={versionNumbers}
                reviewOpen={review === true}
                isCurrent={isCurrent}
                currentId={currentId}
                onSwitchToCurrent={() => void navigate({ search: { review: true } })}
                onCloseReview={() =>
                  void navigate({
                    search: (prev) => ({ ...prev, review: undefined }),
                    replace: true,
                    resetScroll: false,
                  })
                }
              />
            }
          />
        </MarkupSessionProvider>
      )}
    </div>
  )
}

/** Selects and scrolls to the cue the URL names, once, as soon as the markup has loaded it. */
function FocusCue({ cueId, onDone }: { cueId: string | undefined; onDone: () => void }) {
  const session = useMarkupSession()
  const handled = useRef<string | null>(null)
  const target = cueId ? session.view.ordered.find((c) => c.id === cueId) : undefined
  useEffect(() => {
    if (!cueId || !target || handled.current === cueId) return
    handled.current = cueId
    session.showCue(target)
    onDone()
  }, [cueId, target, session, onDone])
  return null
}

/** The markup keys, live while a version is open. */
function MarkupKeys() {
  useMarkupShortcuts()
  return null
}

/** The review, layers, and the selected cue's or annotation's editor. */
function MarkupSide({
  showId,
  documentId,
  versionNumbers,
  reviewOpen,
  isCurrent,
  currentId,
  onSwitchToCurrent,
  onCloseReview,
}: {
  showId: string
  documentId: string
  versionNumbers: ReadonlyMap<string, number>
  reviewOpen: boolean
  isCurrent: boolean
  currentId: string | null
  onSwitchToCurrent: () => void
  onCloseReview: () => void
}) {
  const selection = useSelection()
  return (
    <>
      <SelectionAnnouncer />
      {reviewOpen &&
        (isCurrent ? (
          <ReviewPanel
            documentId={documentId}
            versionNumbers={versionNumbers}
            onClose={onCloseReview}
          />
        ) : (
          <section className="review-panel" aria-label="Revision review">
            <p>The review is of the current version.</p>
            {currentId && (
              <button type="button" onClick={onSwitchToCurrent}>
                Go to the current version
              </button>
            )}
          </section>
        ))}
      <LayerPanel showId={showId} />
      {selection?.table === 'cues' && (
        <CueEditor
          key={selection.id}
          cueId={selection.id}
          historySlot={<CueHistory cueId={selection.id} />}
        />
      )}
      {selection?.table === 'annotations' && (
        <AnnotationEditor
          key={selection.id}
          annotationId={selection.id}
          historySlot={<AnnotationHistory annotationId={selection.id} />}
        />
      )}
    </>
  )
}

function VersionStatus({ version }: { version: DocumentVersionRow }) {
  const name = versionName(version)
  const text =
    version.status === 'failed'
      ? `${name} failed to process: ${version.error ?? 'unknown error'}`
      : version.status === 'processing'
        ? `${name} is processing…`
        : `${name} is queued for processing.`
  return (
    <p role="status" className="viewer-message" data-status={version.status}>
      {text}
    </p>
  )
}
