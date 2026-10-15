import { diffVersionLines } from '@binder/core'
import { useQuery } from '@powersync/react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import type { DocumentRow, DocumentVersionRow } from '../powersync/schema'
import { ComparePane } from '../revisions/ComparePane'
import { changeList, tintedLines } from '../revisions/compareModel'
import { useVersionText } from '../revisions/useVersionText'

interface CompareSearch {
  from?: string
  to?: string
}

export const Route = createFileRoute('/shows/$showId/docs/$docId/compare')({
  validateSearch: (search: Record<string, unknown>): CompareSearch => ({
    from: typeof search.from === 'string' && search.from ? search.from : undefined,
    to: typeof search.to === 'string' && search.to ? search.to : undefined,
  }),
  component: ComparePage,
})

const label = (v: DocumentVersionRow) => `v${v.version_number}${v.label ? ` · ${v.label}` : ''}`

/**
 * Two versions of a document side by side: removed lines tinted on the old one, added lines on the
 * new, and a list of the changes that takes both sides to the page it is on. The diff is computed
 * here from the word layers in the blob cache, so it works offline.
 */
function ComparePage() {
  const { showId, docId } = Route.useParams()
  const { from, to } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const { data: docs } = useQuery<DocumentRow>(
    'SELECT * FROM documents WHERE id = ? AND show_id = ?',
    [docId, showId],
  )
  const { data: versions } = useQuery<DocumentVersionRow>(
    "SELECT * FROM document_versions WHERE document_id = ? AND status = 'ready' ORDER BY version_number",
    [docId],
  )
  const doc = docs[0]
  const toVersion =
    versions.find((v) => v.id === to) ??
    versions.find((v) => v.id === doc?.current_version_id) ??
    versions.at(-1)
  const fromVersion =
    versions.find((v) => v.id === from) ??
    versions.filter((v) => (v.version_number ?? 0) < (toVersion?.version_number ?? 0)).at(-1)

  const oldText = useVersionText(fromVersion?.id ?? null)
  const newText = useVersionText(toVersion?.id ?? null)
  const diff = useMemo(
    () => (oldText && newText ? diffVersionLines(oldText, newText) : null),
    [oldText, newText],
  )
  const changes = useMemo(() => (diff ? changeList(diff.entries) : []), [diff])
  const oldTint = useMemo(() => (diff ? tintedLines(diff.entries, 'old') : new Map()), [diff])
  const newTint = useMemo(() => (diff ? tintedLines(diff.entries, 'new') : new Map()), [diff])
  const [oldPage, setOldPage] = useState(0)
  const [newPage, setNewPage] = useState(0)
  const [active, setActive] = useState<number | null>(null)

  const choose = (patch: CompareSearch) =>
    void navigate({
      search: { from: fromVersion?.id, to: toVersion?.id, ...patch },
      replace: true,
    })

  return (
    <div className="compare-page-root">
      <header className="document-header">
        <Link to="/shows/$showId/docs/$docId" params={{ showId, docId }}>
          ← {doc?.title ?? 'Document'}
        </Link>
        <h1>Compare versions</h1>
        <label>
          From
          <select
            value={fromVersion?.id ?? ''}
            onChange={(e) => {
              setActive(null)
              choose({ from: e.target.value })
            }}
          >
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                {label(v)}
              </option>
            ))}
          </select>
        </label>
        <label>
          To
          <select
            value={toVersion?.id ?? ''}
            onChange={(e) => {
              setActive(null)
              choose({ to: e.target.value })
            }}
          >
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                {label(v)}
              </option>
            ))}
          </select>
        </label>
      </header>
      {!fromVersion || !toVersion ? (
        <p className="viewer-message">A document needs two ready versions to compare.</p>
      ) : fromVersion.id === toVersion.id ? (
        <p className="viewer-message">Choose two different versions to compare.</p>
      ) : (
        <div className="compare-body">
          <ComparePane
            side="old"
            title={`Old · ${label(fromVersion)}`}
            versionId={fromVersion.id}
            text={oldText}
            pageIndex={oldPage}
            onPageChange={setOldPage}
            tint={oldTint}
          />
          <ComparePane
            side="new"
            title={`New · ${label(toVersion)}`}
            versionId={toVersion.id}
            text={newText}
            pageIndex={newPage}
            onPageChange={setNewPage}
            tint={newTint}
          />
          <nav className="compare-changes" aria-label="Changes">
            {!diff ? (
              <p role="status">Comparing…</p>
            ) : (
              <>
                <p role="status" className="compare-summary">
                  {diff.removed} removed, {diff.added} added
                </p>
                {changes.length === 0 ? (
                  <p>No differences in the text.</p>
                ) : (
                  <ol>
                    {changes.map((c, i) => (
                      <li key={c.index}>
                        <button
                          type="button"
                          className="compare-change"
                          data-op={c.op}
                          aria-current={active === i ? 'true' : undefined}
                          onClick={() => {
                            setActive(i)
                            setOldPage(c.oldPage)
                            setNewPage(c.newPage)
                          }}
                        >
                          <span className="compare-op" aria-hidden="true">
                            {c.op === 'removed' ? '−' : '+'}
                          </span>
                          <span className="visually-hidden">
                            {c.op === 'removed' ? 'Removed: ' : 'Added: '}
                          </span>
                          {c.text}
                        </button>
                      </li>
                    ))}
                  </ol>
                )}
              </>
            )}
          </nav>
        </div>
      )}
    </div>
  )
}
