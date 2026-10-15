import { useQuery } from '@powersync/react'
import { type FormEvent, useEffect, useId, useRef, useState } from 'react'
import { MAX_UPLOAD_BYTES, PROXY_LIMIT_MESSAGE, postWithProgress } from '../documents/UploadDialog'
import { revisionPhase } from './revisionPhase'

export interface UploadRevisionDialogProps {
  showId: string
  documentId: string
  documentTitle: string
  onClose: () => void
  /** Called once the new version is the document's current one: the review comes next. */
  onReanchored: (versionId: string) => void
}

/**
 * Uploads a new version of a document and follows it to the end: processing, then "Re-anchoring…"
 * until the document's synced current version becomes it, then it hands over to the review. A
 * version that fails to process shows why instead of waiting.
 */
export function UploadRevisionDialog({
  showId,
  documentId,
  documentTitle,
  onClose,
  onReanchored,
}: UploadRevisionDialogProps) {
  const headingId = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const request = useRef<{ abort: () => void } | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [label, setLabel] = useState('')
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [versionId, setVersionId] = useState<string | null>(null)

  useEffect(() => {
    dialog.current?.showModal()
    return () => request.current?.abort()
  }, [])

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!file) return
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(`This file is ${Math.ceil(file.size / (1024 * 1024))} MB. ${PROXY_LIMIT_MESSAGE}`)
      return
    }
    // The server reads the text fields before the file, so the file part goes last.
    const form = new FormData()
    form.append('label', label.trim())
    form.append('file', file)
    setError(null)
    setProgress(0)
    const upload = postWithProgress(
      `/api/shows/${showId}/documents/${documentId}/versions`,
      form,
      setProgress,
    )
    request.current = upload
    upload.promise.then(
      (body) => {
        request.current = null
        const id = (body as { version?: { id?: unknown } } | null)?.version?.id
        if (typeof id === 'string') setVersionId(id)
        else onClose()
      },
      (err: Error) => {
        request.current = null
        setProgress(null)
        if (err.name !== 'AbortError') setError(err.message)
      },
    )
  }

  const uploading = progress !== null && versionId === null
  return (
    <dialog ref={dialog} className="upload-dialog" aria-labelledby={headingId} onClose={onClose}>
      <h2 id={headingId}>Upload revision</h2>
      {versionId ? (
        <RevisionProgress
          showId={showId}
          documentId={documentId}
          versionId={versionId}
          onClose={onClose}
          onReanchored={onReanchored}
        />
      ) : (
        <form onSubmit={submit}>
          <p className="muted">
            A new version of {documentTitle}. Cues and notes move with the text.
          </p>
          <label>
            PDF file
            <input
              type="file"
              accept="application/pdf,.pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <label>
            Version label
            <input
              required
              maxLength={200}
              placeholder="e.g. V5 18 Aug rehearsal cuts"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </label>
          {uploading && (
            <progress aria-label="Upload progress" max={1} value={progress ?? 0}>
              {Math.round((progress ?? 0) * 100)}%
            </progress>
          )}
          {error && <p role="alert">{error}</p>}
          <div className="dialog-actions">
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" disabled={uploading || !file || label.trim() === ''}>
              Upload
            </button>
          </div>
        </form>
      )}
    </dialog>
  )
}

/** The uploaded version's way from processing to current, read from the synced rows. */
function RevisionProgress({
  documentId,
  versionId,
  onClose,
  onReanchored,
}: Pick<UploadRevisionDialogProps, 'documentId' | 'onClose' | 'onReanchored'> & {
  showId: string
  versionId: string
}) {
  const { data: versions } = useQuery<{ status: string | null; error: string | null }>(
    'SELECT status, error FROM document_versions WHERE id = ?',
    [versionId],
  )
  const { data: docs } = useQuery<{ current_version_id: string | null }>(
    'SELECT current_version_id FROM documents WHERE id = ?',
    [documentId],
  )
  const state = revisionPhase({
    newVersionId: versionId,
    currentVersionId: docs[0]?.current_version_id ?? null,
    version: versions[0] ?? null,
  })
  const done = state.phase === 'done'
  const notified = useRef(false)
  useEffect(() => {
    if (!done || notified.current) return
    notified.current = true
    onReanchored(versionId)
  }, [done, onReanchored, versionId])

  return (
    <>
      {state.phase === 'processing' && <p role="status">Processing the new version…</p>}
      {state.phase === 'reanchoring' && <p role="status">Re-anchoring…</p>}
      {state.phase === 'done' && <p role="status">Re-anchored.</p>}
      {state.phase === 'failed' && (
        <p role="alert">The new version failed to process: {state.error}</p>
      )}
      <div className="dialog-actions">
        <button type="button" onClick={onClose}>
          {state.phase === 'failed' ? 'Close' : 'Close and keep working'}
        </button>
      </div>
    </>
  )
}
