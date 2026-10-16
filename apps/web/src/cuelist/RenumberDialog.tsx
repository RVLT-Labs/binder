import { DEFAULT_BLOCK_SIZE } from '@binder/shared'
import { usePowerSync, useQuery } from '@powersync/react'
import { type FormEvent, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { DialogFooter, DialogHeader, DialogShell } from '@/components/ui/dialog-shell'
import { Input } from '@/components/ui/input'
import { closeModal, openModal, restoreFocus } from '@/lib/modalDialog'
import type { EditContext } from '../markup/mutations'
import { Field, FieldError, Note, SelectField } from '../panel/fields'
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
  /** The control that opened the dialog: focus goes back to it however the dialog closes. */
  returnFocusTo?: HTMLElement | null
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
  returnFocusTo = null,
}: RenumberDialogProps) {
  const headingId = useId()
  const ids = useId()
  const focusBack = useRef(returnFocusTo)
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

  const { data: current } = useQuery<{ current_version_id: string | null }>(
    'SELECT current_version_id FROM documents WHERE id = ?',
    [documentId],
  )
  const currentVersionId = current[0]?.current_version_id ?? null

  useEffect(() => {
    if (dialog.current) openModal(dialog.current)
    // The dialog is gone by now (this runs as it unmounts), so its opener can take focus again.
    return () => restoreFocus(focusBack.current)
  }, [])

  const blockSize = /^\d+$/.test(blockText.trim()) ? Number(blockText.trim()) : Number.NaN
  const blockValid = Number.isInteger(blockSize) && blockSize >= 2 && blockSize <= 1000
  const placed = useMemo(
    () =>
      renumberCuesOf(rows, documentId, currentVersionId).filter(
        (c) => c.anchor !== null && c.major > 0,
      ).length,
    [rows, documentId, currentVersionId],
  )
  const preview = useMemo(
    () => (blockValid ? previewRenumber(rows, documentId, blockSize, currentVersionId) : null),
    [rows, documentId, blockSize, blockValid, currentVersionId],
  )

  const spilled = preview?.flagged.filter((f) => f.reason === 'spilled').length ?? 0
  const overflow = preview?.flagged.filter((f) => f.reason === 'overflow').length ?? 0

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
    <DialogShell ref={dialog} labelledBy={headingId} onClose={onClose}>
      <form onSubmit={apply} className="flex flex-col gap-4">
        <DialogHeader id={headingId} className="mb-0">
          Renumber {departmentCode} from script order
        </DialogHeader>
        <Note>
          Cues are ordered by where they sit in the script. The first takes the block size and the
          rest the following whole numbers. Unplaced cues and the 0 range are left alone.
        </Note>
        <Field label="Document" htmlFor={`${ids}-document`}>
          <SelectField
            id={`${ids}-document`}
            value={documentId}
            onChange={(e) => setDocumentId(e.target.value)}
          >
            {documents.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
          </SelectField>
        </Field>
        <Field label="Block size" htmlFor={`${ids}-block`}>
          <Input
            id={`${ids}-block`}
            inputMode="numeric"
            className="font-mono tabular-nums"
            value={blockText}
            onChange={(e) => setBlockText(e.target.value)}
            aria-invalid={blockValid ? undefined : true}
          />
        </Field>
        {!blockValid && <FieldError>{BLOCK_ERROR}</FieldError>}
        {preview && (
          <p role="status" className="renumber-preview m-0 text-[13px] text-ink-2">
            {placed === 0
              ? 'No placed cues in this document.'
              : `${preview.changes.length} of ${placed} cues will change, ${spilled} will spill into points.${
                  overflow > 0
                    ? ` ${overflow} ${overflow === 1 ? "cue doesn't" : "cues don't"} fit and keep their numbers.`
                    : ''
                }`}
          </p>
        )}
        {error && <FieldError>{error}</FieldError>}
        <DialogFooter className="mt-2">
          <Button type="button" variant="line" onClick={() => closeModal(dialog.current, null)}>
            Cancel
          </Button>
          <Button type="submit" disabled={!preview || busy || placed === 0}>
            Apply renumbering
          </Button>
        </DialogFooter>
      </form>
    </DialogShell>
  )
}
