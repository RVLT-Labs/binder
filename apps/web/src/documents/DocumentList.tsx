import { useQuery } from '@powersync/react'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { UploadDialog, type UploadTarget } from './UploadDialog'

interface DocumentListRow {
  id: string
  title: string | null
  kind: string | null
  version_number: number | null
  status: string | null
  error: string | null
}

/** Each document with its newest version, whose status follows processing live through sync. */
const LIST_SQL = `
  SELECT d.id, d.title, d.kind, v.version_number, v.status, v.error
  FROM documents d
  LEFT JOIN document_versions v ON v.id = (
    SELECT id FROM document_versions WHERE document_id = d.id ORDER BY version_number DESC LIMIT 1
  )
  WHERE d.show_id = ?
  ORDER BY d.sort_order, d.created_at, d.id`

export function DocumentList({ showId, canUpload }: { showId: string; canUpload: boolean }) {
  const { data, isLoading } = useQuery<DocumentListRow>(LIST_SQL, [showId])
  const [upload, setUpload] = useState<UploadTarget | null>(null)

  return (
    <section className="documents">
      <div className="documents-header">
        <h2>Documents</h2>
        {canUpload && (
          <button type="button" onClick={() => setUpload({ kind: 'document' })}>
            Upload document
          </button>
        )}
      </div>
      {isLoading ? (
        <p>Loading…</p>
      ) : data.length === 0 ? (
        <p>No documents yet.</p>
      ) : (
        <ul aria-label="Documents" className="document-list">
          {data.map((doc) => (
            <li key={doc.id}>
              <Link to="/shows/$showId/docs/$docId" params={{ showId, docId: doc.id }}>
                {doc.title}
              </Link>
              <span className="document-kind">{doc.kind}</span>
              {doc.version_number !== null && (
                <span className="version-status" data-status={doc.status}>
                  v{doc.version_number} {doc.status}
                  {doc.status === 'failed' && doc.error ? `: ${doc.error}` : ''}
                </span>
              )}
              {canUpload && (
                <button
                  type="button"
                  onClick={() =>
                    setUpload({
                      kind: 'version',
                      documentId: doc.id,
                      documentTitle: doc.title ?? 'document',
                    })
                  }
                >
                  New version
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {upload && <UploadDialog showId={showId} target={upload} onClose={() => setUpload(null)} />}
    </section>
  )
}
