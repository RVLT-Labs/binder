import { type FormEvent, useEffect, useId, useRef, useState } from 'react'

/**
 * The API accepts 200 MB, but Cloudflare's proxy in front of it stops request bodies at 100 MB, so
 * larger files are refused here before any bytes are sent.
 */
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024
const PROXY_LIMIT_MESSAGE = 'Files over 100 MB cannot be uploaded through the current proxy.'

export type UploadTarget =
  | { kind: 'document' }
  | { kind: 'version'; documentId: string; documentTitle: string }

const KINDS = [
  ['libretto', 'Libretto'],
  ['score', 'Score'],
  ['blocking', 'Blocking'],
  ['other', 'Other'],
] as const

export interface UploadDialogProps {
  showId: string
  target: UploadTarget
  onClose: () => void
}

/**
 * Uploads a PDF as a new document or a new version of one. Uses XMLHttpRequest for upload
 * progress. On success the dialog closes; the document list then follows processing via sync.
 */
export function UploadDialog({ showId, target, onClose }: UploadDialogProps) {
  const headingId = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const request = useRef<{ abort: () => void } | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [kind, setKind] = useState('libretto')
  const [title, setTitle] = useState('')
  const [ocrMode, setOcrMode] = useState('auto')
  const [label, setLabel] = useState('')
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

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
        onClose()
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
    <dialog ref={dialog} className="upload-dialog" aria-labelledby={headingId} onClose={onClose}>
      <form onSubmit={submit}>
        <h2 id={headingId}>{heading}</h2>
        <label>
          PDF file
          <input
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => {
              const next = e.target.files?.[0] ?? null
              setFile(next)
              if (next && !title) setTitle(next.name.replace(/\.pdf$/i, ''))
            }}
          />
        </label>
        {target.kind === 'document' ? (
          <>
            <label>
              Kind
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                {KINDS.map(([value, name]) => (
                  <option key={value} value={value}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Title
              <input
                required
                maxLength={200}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label>
              Text recognition
              <select value={ocrMode} onChange={(e) => setOcrMode(e.target.value)}>
                <option value="auto">Automatic (OCR scanned pages)</option>
                <option value="never">Never</option>
              </select>
            </label>
          </>
        ) : (
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
        )}
        {uploading && (
          <progress aria-label="Upload progress" max={1} value={progress}>
            {Math.round(progress * 100)}%
          </progress>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={uploading || !file}>
            Upload
          </button>
        </div>
      </form>
    </dialog>
  )
}

/** POSTs multipart form data with upload progress (0 to 1). Rejects with the server's message. */
function postWithProgress(
  url: string,
  body: FormData,
  onProgress: (fraction: number) => void,
): { promise: Promise<void>; abort: () => void } {
  const xhr = new XMLHttpRequest()
  const promise = new Promise<void>((resolve, reject) => {
    xhr.open('POST', url)
    xhr.withCredentials = true
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else reject(new Error(serverMessage(xhr)))
    }
    xhr.onerror = () => reject(new Error('Upload failed: could not reach the server.'))
    xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'))
    xhr.send(body)
  })
  return { promise, abort: () => xhr.abort() }
}

function serverMessage(xhr: XMLHttpRequest): string {
  try {
    const message = JSON.parse(xhr.responseText)?.message
    if (typeof message === 'string' && message) return message
  } catch {
    // Not JSON: the response came from a proxy, not the API.
  }
  if (xhr.status === 413) return PROXY_LIMIT_MESSAGE
  return `Upload failed (${xhr.status}).`
}
