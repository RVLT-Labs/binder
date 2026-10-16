import { type FormEvent, useEffect, useId, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { DialogFooter, DialogHeader, DialogShell } from '@/components/ui/dialog-shell'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { closeModal, openModal, restoreFocus } from '@/lib/modalDialog'
import { cn } from '@/lib/utils'

/**
 * The API accepts 200 MB, but Cloudflare's proxy in front of it stops request bodies at 100 MB, so
 * larger files are refused here before any bytes are sent.
 */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024
export const PROXY_LIMIT_MESSAGE = 'Files over 100 MB cannot be uploaded through the current proxy.'

export type UploadTarget =
  | { kind: 'document' }
  | { kind: 'version'; documentId: string; documentTitle: string }

const KINDS = [
  ['libretto', 'Libretto'],
  ['score', 'Score'],
  ['blocking', 'Blocking'],
  ['other', 'Other'],
] as const

/** A native select dressed like the registry Input (the registry has no Select that keeps the platform picker). */
export const SELECT_CLASS = cn(
  'flex min-h-11 w-full rounded-[var(--radius)] border-2 border-input bg-card px-3.5 py-2 text-[16px] text-ink',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red focus-visible:ring-offset-2 focus-visible:ring-offset-paper',
)

export interface UploadDialogProps {
  showId: string
  target: UploadTarget
  onClose: () => void
  /** The control that opened the dialog: focus goes back to it however the dialog closes. */
  returnFocusTo?: HTMLElement | null
  /** A file already chosen, e.g. one dropped on the Documents screen. */
  initialFile?: File | null
}

/**
 * Uploads a PDF as a new document or a new version of one. Uses XMLHttpRequest for upload
 * progress. On success the dialog closes; the document list then follows processing via sync.
 */
export function UploadDialog({
  showId,
  target,
  onClose,
  returnFocusTo = null,
  initialFile = null,
}: UploadDialogProps) {
  const headingId = useId()
  const ids = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const request = useRef<{ abort: () => void } | null>(null)
  const [file, setFile] = useState<File | null>(initialFile)
  const [kind, setKind] = useState('libretto')
  const [title, setTitle] = useState(initialFile ? titleOf(initialFile) : '')
  const [ocrMode, setOcrMode] = useState('auto')
  const [label, setLabel] = useState('')
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (dialog.current) openModal(dialog.current)
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
    let url: string
    if (target.kind === 'document') {
      url = `/api/shows/${showId}/documents`
      form.append('kind', kind)
      form.append('title', title.trim())
      form.append('ocrMode', ocrMode)
    } else {
      url = `/api/shows/${showId}/documents/${target.documentId}/versions`
      form.append('label', label.trim())
    }
    form.append('file', file)

    setError(null)
    setProgress(0)
    const upload = postWithProgress(url, form, setProgress)
    request.current = upload
    upload.promise.then(
      () => {
        request.current = null
        // The dialog's own `close` event tells the caller to stop rendering it.
        closeModal(dialog.current, returnFocusTo)
      },
      (err: Error) => {
        request.current = null
        setProgress(null)
        if (err.name !== 'AbortError') setError(err.message)
      },
    )
  }

  const uploading = progress !== null
  const heading =
    target.kind === 'document' ? 'Upload document' : `New version of ${target.documentTitle}`

  return (
    <DialogShell
      ref={dialog}
      labelledBy={headingId}
      onClose={() => {
        restoreFocus(returnFocusTo)
        onClose()
      }}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <DialogHeader id={headingId} className="mb-0">
          {heading}
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${ids}-file`}>PDF file</Label>
          <Input
            id={`${ids}-file`}
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => {
              const next = e.target.files?.[0] ?? null
              setFile(next)
              if (next && !title) setTitle(titleOf(next))
            }}
          />
          {initialFile && file === initialFile && (
            <p className="m-0 truncate font-mono text-[12px] tabular-nums text-muted">
              {file.name}
            </p>
          )}
        </div>
        {target.kind === 'document' ? (
          <>
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${ids}-kind`}>Kind</Label>
              <select
                id={`${ids}-kind`}
                className={SELECT_CLASS}
                value={kind}
                onChange={(e) => setKind(e.target.value)}
              >
                {KINDS.map(([value, name]) => (
                  <option key={value} value={value}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${ids}-title`}>Title</Label>
              <Input
                id={`${ids}-title`}
                required
                maxLength={200}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${ids}-ocr`}>Text recognition</Label>
              <select
                id={`${ids}-ocr`}
                className={SELECT_CLASS}
                value={ocrMode}
                onChange={(e) => setOcrMode(e.target.value)}
              >
                <option value="auto">Automatic (OCR scanned pages)</option>
                <option value="never">Never</option>
              </select>
            </div>
          </>
        ) : (
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
        )}
        {uploading && (
          <progress
            aria-label="Upload progress"
            max={1}
            value={progress}
            className="h-2 w-full appearance-none overflow-hidden rounded-full [&::-moz-progress-bar]:bg-ink [&::-webkit-progress-bar]:bg-paper-2 [&::-webkit-progress-value]:bg-ink"
          >
            {Math.round(progress * 100)}%
          </progress>
        )}
        {error && (
          <p role="alert" className="m-0 text-[14px] text-t-out">
            {error}
          </p>
        )}
        <DialogFooter className="mt-2">
          <Button
            type="button"
            variant="line"
            onClick={() => closeModal(dialog.current, returnFocusTo)}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={uploading || !file}>
            Upload
          </Button>
        </DialogFooter>
      </form>
    </DialogShell>
  )
}

const titleOf = (file: File) => file.name.replace(/\.pdf$/i, '')

/**
 * POSTs multipart form data with upload progress (0 to 1). Resolves with the parsed response (null
 * when it is not JSON); rejects with the server's message.
 */
export function postWithProgress(
  url: string,
  body: FormData,
  onProgress: (fraction: number) => void,
): { promise: Promise<unknown>; abort: () => void } {
  const xhr = new XMLHttpRequest()
  const promise = new Promise<unknown>((resolve, reject) => {
    xhr.open('POST', url)
    xhr.withCredentials = true
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(parsed(xhr))
      else reject(new Error(serverMessage(xhr)))
    }
    xhr.onerror = () => reject(new Error('Upload failed: could not reach the server.'))
    xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'))
    xhr.send(body)
  })
  return { promise, abort: () => xhr.abort() }
}

function parsed(xhr: XMLHttpRequest): unknown {
  try {
    return JSON.parse(xhr.responseText)
  } catch {
    return null
  }
}

export function serverMessage(xhr: XMLHttpRequest): string {
  try {
    const message = JSON.parse(xhr.responseText)?.message
    if (typeof message === 'string' && message) return message
  } catch {
    // Not JSON: the response came from a proxy, not the API.
  }
  if (xhr.status === 413) return PROXY_LIMIT_MESSAGE
  return `Upload failed (${xhr.status}).`
}
