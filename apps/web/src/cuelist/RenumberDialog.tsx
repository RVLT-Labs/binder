import { DEFAULT_BLOCK_SIZE } from '@binder/shared'
import { usePowerSync, useQuery } from '@powersync/react'
import { type FormEvent, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { EditContext } from '../markup/mutations'
import {
  type CueNumberRow,
  previewRenumber,
  renumberCuesOf,
  renumberLocally,
} from './renumberLocally'

export interface RenumberDialogProps {
  departmentId: string
  departmentCode: string
  documents: Array<{ id: string; title: string }>
  /** The edit context as of now (the live membership scope), or null until it has synced. */
  editContext: () => EditContext | null
  onClose: () => void
}

const BLOCK_ERROR = 'The block size is a whole number from 2 to 1000.'

/**
 * "Renumber from script order": pick a document and a block size, see how many cues change and
 * spill, then apply. Applying is one local write, so it also works offline.
 */
export function RenumberDialog({
  departmentId,
  departmentCode,
  documents,
  editContext,
  onClose,
}: RenumberDialogProps) {
  const headingId = useId()
  const db = usePowerSync()
  const dialog = useRef<HTMLDialogElement>(null)
  const [documentId, setDocumentId] = useState(documents[0]?.id ?? '')
  const [blockText, setBlockText] = useState(String(DEFAULT_BLOCK_SIZE))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { data: rows } = useQuery<CueNumberRow>(
    'SELECT id, major, minor, anchor FROM cues WHERE department_id = ?',
    [departmentId],
  )

  useEffect(() => {
    dialog.current?.showModal()
  }, [])

  const blockSize = /^\d+$/.test(blockText.trim()) ? Number(blockText.trim()) : Number.NaN
  const blockValid = Number.isInteger(blockSize) && blockSize >= 2 && blockSize <= 1000
  const placed = useMemo(
    () => renumberCuesOf(rows, documentId).filter((c) => c.anchor !== null && c.major > 0).length,
    [rows, documentId],
  )
  const preview = useMemo(
    () => (blockValid ? previewRenumber(rows, documentId, blockSize) : null),
    [rows, documentId, blockSize, blockValid],
  )

  async function apply(e: FormEvent) {
    e.preventDefault()
    const ctx = editContext()
    if (!preview || !ctx || busy) return
    setBusy(true)
    setError(null)
    try {
      await renumberLocally(db, ctx, { departmentId, documentId, blockSize })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <dialog ref={dialog} className="renumber-dialog" aria-labelledby={headingId} onClose={onClose}>
      <form onSubmit={apply}>
        <h2 id={headingId}>Renumber {departmentCode} from script order</h2>
        <p className="muted">
          Cues are ordered by where they sit in the script. The first takes the block size and the
          rest the following whole numbers. Unplaced cues and the 0 range are left alone.
        </p>
        <label>
          Document
          <select value={documentId} onChange={(e) => setDocumentId(e.target.value)}>
            {documents.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Block size
          <input
            inputMode="numeric"
            value={blockText}
            onChange={(e) => setBlockText(e.target.value)}
            aria-invalid={blockValid ? undefined : true}
          />
        </label>
        {!blockValid && <p className="field-error">{BLOCK_ERROR}</p>}
        {preview && (
          <p role="status" className="renumber-preview">
            {placed === 0
              ? 'No placed cues in this document.'
              : `${preview.changes.length} of ${placed} cues will change, ${preview.flagged.length} will spill into points.`}
          </p>
        )}
        {error && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" onClick={() => dialog.current?.close()}>
            Cancel
          </button>
          <button type="submit" disabled={!preview || busy || placed === 0}>
            Apply renumbering
          </button>
        </div>
      </form>
    </dialog>
  )
}
