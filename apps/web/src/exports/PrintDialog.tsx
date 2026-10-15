import { layerSelectionLabel } from '@binder/core'
import { type LayerRef, layerKey } from '@binder/shared'
import { usePowerSync } from '@powersync/react'
import { type FormEvent, useEffect, useId, useMemo, useRef, useState } from 'react'
import { pushNotice } from '../components/noticeStore'
import { useMarkupSession } from '../markup/MarkupSession'
import { useOnline } from '../offline/useOnline'
import { flushForSession } from './flusher'
import { runPrintExport } from './runPrintExport'

/** The layers the dialog offers, in the order it lists them. */
export interface PrintChoices {
  departments: Array<{ id: string; code: string }>
  /** The signed-in user's own id, for their personal layer. */
  userId: string
}

/** "Calling script: all layers": every non-hidden department, and never a personal layer. */
export function callingScript(departments: PrintChoices['departments']): LayerRef[] {
  return departments.map((d) => ({ kind: 'department', id: d.id }))
}

/** What the layers footer will say for the checked layers. */
export function selectionSummary(
  selection: readonly LayerRef[],
  departments: PrintChoices['departments'],
): string {
  return layerSelectionLabel([...selection], departments)
}

export interface PrintDialogProps {
  documentId: string
  versionId: string
  onClose: () => void
}

/**
 * Print: choose which layers go on the page, then export a marked-up PDF. It is made on this
 * device from the cached script, downloads at once, and is recorded (as an ExportRecord for the
 * show) as soon as there is a network, so it works the same offline.
 */
export function PrintDialog({ documentId, versionId, onClose }: PrintDialogProps) {
  const session = useMarkupSession()
  const db = usePowerSync()
  const online = useOnline()
  const headingId = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  // Hidden departments are not offered; every member sees every other department layer.
  const departments = useMemo(
    () =>
      session.departments.filter((d) => !d.hidden).map((d) => ({ id: d.id, code: d.code ?? '' })),
    [session.departments],
  )
  const [picked, setPicked] = useState<ReadonlySet<string>>(
    () => new Set(callingScript(departments).map(layerKey)),
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    dialog.current?.showModal()
    // Fetch the stamping code now, while there may be a network, so exporting works once it is gone.
    void import('./printCore').catch(() => {})
  }, [])

  const personal: LayerRef | null = session.userId ? { kind: 'personal', id: session.userId } : null
  const selection: LayerRef[] = [
    ...callingScript(departments).filter((l) => picked.has(layerKey(l))),
    ...(personal && picked.has(layerKey(personal)) ? [personal] : []),
  ]
  const includesPersonal = personal !== null && picked.has(layerKey(personal))

  function toggle(layer: LayerRef, on: boolean) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (on) next.add(layerKey(layer))
      else next.delete(layerKey(layer))
      return next
    })
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const ctx = session.editContext()
    if (!ctx || busy) return
    setBusy(true)
    setError(null)
    try {
      const { filename } = await runPrintExport(db, ctx, {
        documentId,
        versionId,
        layers: selection,
      })
      pushNotice({
        kind: 'info',
        message: online
          ? `Downloaded ${filename}.`
          : `Downloaded ${filename}. It will be recorded in Exports when you are back online.`,
      })
      // Right after queueing: a no-op offline, and the online event takes over when it returns.
      void flushForSession()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <dialog ref={dialog} className="print-dialog" aria-labelledby={headingId} onClose={onClose}>
      <form onSubmit={submit}>
        <h2 id={headingId}>Print</h2>
        <p className="muted">
          Marks the script with the layers you choose. Page size and the searchable text stay as
          they are, and every page gets a footer.
        </p>
        <fieldset className="print-presets" aria-label="Presets">
          <button
            type="button"
            onClick={() => setPicked(new Set(callingScript(departments).map(layerKey)))}
          >
            Calling script: all layers
          </button>
          <button type="button" onClick={() => setPicked(new Set())}>
            Clean copy
          </button>
        </fieldset>
        <fieldset className="print-layers">
          <legend>Layers</legend>
          {departments.map((d) => {
            const layer: LayerRef = { kind: 'department', id: d.id }
            return (
              <label key={d.id}>
                <input
                  type="checkbox"
                  checked={picked.has(layerKey(layer))}
                  onChange={(e) => toggle(layer, e.target.checked)}
                />
                {d.code}
              </label>
            )
          })}
          {personal && (
            <label>
              <input
                type="checkbox"
                checked={includesPersonal}
                onChange={(e) => toggle(personal, e.target.checked)}
              />
              Personal layer
            </label>
          )}
        </fieldset>
        {includesPersonal && (
          <p role="status" className="muted">
            Only you will see this export.
          </p>
        )}
        <p className="muted">Footer layers: {selectionSummary(selection, departments)}</p>
        {!online && (
          <p className="muted">
            You are offline. The file downloads now and is recorded when you reconnect.
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
          <button type="submit" disabled={busy || !session.userId}>
            {busy ? 'Preparing…' : 'Export PDF'}
          </button>
        </div>
      </form>
    </dialog>
  )
}

/** The viewer toolbar's Print button, with the dialog it opens. */
export function PrintButton() {
  const session = useMarkupSession()
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Print
      </button>
      {open && (
        <PrintDialog
          documentId={session.documentId}
          versionId={session.versionId}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
