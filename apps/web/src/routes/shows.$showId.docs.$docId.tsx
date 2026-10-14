import { useQuery } from '@powersync/react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { blobUrl } from '../blobs/fetchBlob'
import { AnnotationEditor } from '../markup/AnnotationEditor'
import { CueEditor } from '../markup/CueEditor'
import { LayerPanel } from '../markup/LayerPanel'
import { PageMarkup } from '../markup/MarkupOverlay'
import { MarkupSessionProvider, useMarkupSession } from '../markup/MarkupSession'
import { MarkupTools } from '../markup/MarkupTools'
import { SelectionAnnouncer } from '../markup/SelectionAnnouncer'
import { useSelection } from '../markup/selection'
import { useMarkupShortcuts } from '../markup/useMarkupShortcuts'
import type { DocumentRow, DocumentVersionRow, PageRow } from '../powersync/schema'
import { Viewer, type ViewerHandle } from '../viewer/Viewer'

interface DocumentSearch {
  /** A version to view instead of the document's current one. */
  v?: string
  /** One-based page to open at. */
  p?: number
  /** A cue to select and scroll to once the markup has loaded (from the cue list). */
  cue?: string
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
  }),
  component: DocumentPage,
})

function versionName(v: DocumentVersionRow): string {
  return `Version ${v.version_number}${v.label ? ` · ${v.label}` : ''}`
}

function DocumentPage() {
  const { showId, docId } = Route.useParams()
  const { v, p, cue } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const viewer = useRef<ViewerHandle>(null)
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

  if (isLoading) return <p>Loading…</p>
  if (!doc) return <p>Document not found.</p>

  return (
    <div className="document-page">
      <header className="document-header">
        <Link to="/shows/$showId" params={{ showId }}>
          ← Documents
        </Link>
        <h1>{doc.title}</h1>
        {version && (
          <select
            aria-label="Version"
            value={version.id}
            onChange={(e) => void navigate({ search: { v: e.target.value } })}
          >
            {versions.map((x) => (
              <option key={x.id} value={x.id}>
                v{x.version_number} · {x.status}
                {x.label ? ` · ${x.label}` : ''}
                {x.id === doc.current_version_id ? ' (current)' : ''}
              </option>
            ))}
          </select>
        )}
      </header>
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
        >
          <MarkupKeys />
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
            tools={<MarkupTools />}
            side={<MarkupSide showId={showId} />}
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

/** Layers, and the selected cue's or annotation's editor. */
function MarkupSide({ showId }: { showId: string }) {
  const selection = useSelection()
  return (
    <>
      <SelectionAnnouncer />
      <LayerPanel showId={showId} />
      {selection?.table === 'cues' && <CueEditor key={selection.id} cueId={selection.id} />}
      {selection?.table === 'annotations' && (
        <AnnotationEditor key={selection.id} annotationId={selection.id} />
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
