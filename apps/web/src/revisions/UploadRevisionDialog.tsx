import { useQuery } from '@powersync/react'
import { type FormEvent, useEffect, useId, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { DialogFooter, DialogHeader, DialogShell } from '@/components/ui/dialog-shell'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { openModal, restoreFocus } from '@/lib/modalDialog'
import { MAX_UPLOAD_BYTES, PROXY_LIMIT_MESSAGE, postWithProgress } from '../documents/UploadDialog'
import { revisionPhase } from './revisionPhase'
import { LEAVE_UPLOAD_QUESTION, useUploadGuard } from './useUploadGuard'

export const NO_VERSION_MESSAGE =
  'The upload went through, but the server did not say which version it made, so it cannot be followed here. Check the version list.'

export interface UploadRevisionDialogProps {
  showId: string
  documentId: string
  documentTitle: string
  onClose: () => void
  /** Called once the new version is the document's current one: the review comes next. */
  onReanchored: (versionId: string) => void
  /** The control that opened the dialog: focus goes back to it however the dialog closes. */
  returnFocusTo?: HTMLElement | null
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
  returnFocusTo = null,
}: UploadRevisionDialogProps) {
  const headingId = useId()
  const ids = useId()
  const focusBack = useRef(returnFocusTo)
  const dialog = useRef<HTMLDialogElement>(null)
  const request = useRef<{ abort: () => void } | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [label, setLabel] = useState('')
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [versionId, setVersionId] = useState<string | null>(null)

  const uploading = progress !== null && versionId === null
  useUploadGuard(uploading)

  /** Closes the dialog; while the file is still going up, asks first and stops the upload. */
  function requestClose() {
    if (uploading && !window.confirm(LEAVE_UPLOAD_QUESTION)) return
    request.current?.abort()
    onClose()
  }

  useEffect(() => {
    if (dialog.current) openModal(dialog.current)
    return () => {
      request.current?.abort()
      // The dialog is gone by now (this runs as it unmounts), so its opener can take focus again.
      restoreFocus(focusBack.current)
    }
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
        else {
          setProgress(null)
          setError(NO_VERSION_MESSAGE)
        }
      },
      (err: Error) => {
        request.current = null
        setProgress(null)
        if (err.name !== 'AbortError') setError(err.message)
      },
    )
  }

  return (
    <DialogShell
      ref={dialog}
      labelledBy={headingId}
      className="upload-dialog"
      onCancel={(e) => {
        // Escape while uploading asks first instead of dropping the file silently.
        if (uploading) {
          e.preventDefault()
          requestClose()
        }
      }}
      onClose={onClose}
    >
      <DialogHeader id={headingId} className="mb-4">
        Upload revision
      </DialogHeader>
      {versionId ? (
        <RevisionProgress
          showId={showId}
          documentId={documentId}
          versionId={versionId}
          onClose={onClose}
          onReanchored={onReanchored}
        />
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <p className="m-0 text-[14px] text-muted">
            A new version of {documentTitle}. Cues and notes move with the text.
          </p>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${ids}-file`}>PDF file</Label>
            <Input
              id={`${ids}-file`}
              type="file"
              accept="application/pdf,.pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${ids}-label`}>Version label</Label>
            <Input
              id={`${ids}-label`}
              required
              maxLength={200}
              placeholder="e.g. V5 18 Aug rehearsal cuts"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          {uploading && (
            <progress
              aria-label="Upload progress"
              max={1}
              value={progress ?? 0}
              className="h-2 w-full appearance-none overflow-hidden rounded-full [&::-moz-progress-bar]:bg-ink [&::-webkit-progress-bar]:bg-paper-2 [&::-webkit-progress-value]:bg-ink"
            >
              {Math.round((progress ?? 0) * 100)}%
            </progress>
          )}
          {error && (
            <p role="alert" className="m-0 text-[14px] text-t-out">
              {error}
            </p>
          )}
          <DialogFooter className="mt-2">
            <Button type="button" variant="line" onClick={requestClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={uploading || !file || label.trim() === '' || error === NO_VERSION_MESSAGE}
            >
              Upload
            </Button>
          </DialogFooter>
        </form>
      )}
    </DialogShell>
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
    <div className="flex flex-col gap-4">
      {state.phase === 'processing' && (
        <p role="status" className="m-0 text-[14px] text-ink-2">
          Processing the new version…
        </p>
      )}
      {state.phase === 'reanchoring' && (
        <p role="status" className="m-0 text-[14px] text-ink-2">
          Re-anchoring…
        </p>
      )}
      {state.phase === 'done' && (
        <p role="status" className="m-0 text-[14px] text-ink-2">
          Re-anchored.
        </p>
      )}
      {state.phase === 'failed' && (
        <p role="alert" className="m-0 text-[14px] text-t-out">
          The new version failed to process: {state.error}
        </p>
      )}
      <DialogFooter className="mt-2">
        <Button type="button" variant="line" onClick={onClose}>
          {state.phase === 'failed' ? 'Close' : 'Close and keep working'}
        </Button>
      </DialogFooter>
    </div>
  )
}
