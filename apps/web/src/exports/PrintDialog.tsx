import { layerSelectionLabel } from '@binder/core'
import { type LayerRef, layerKey } from '@binder/shared'
import { usePowerSync } from '@powersync/react'
import { Printer } from 'lucide-react'
import { type FormEvent, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DialogFooter, DialogHeader, DialogShell } from '@/components/ui/dialog-shell'
import { Label } from '@/components/ui/label'
import { closeModal, openModal, restoreFocus } from '@/lib/modalDialog'
import { pushNotice } from '../components/noticeStore'
import { useMarkupSession } from '../markup/MarkupSession'
import { useOnline } from '../offline/useOnline'
import { flushSoon } from './flusher'
import { runPrintExport } from './runPrintExport'

/** The layers the dialog offers, in the order it lists them. */
export interface PrintChoices {
  departments: Array<{ id: string; code: string; colour?: string | null }>
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
  /** The control that opened the dialog: focus goes back to it however the dialog closes. */
  returnFocusTo?: HTMLElement | null
}

/**
 * Print: choose which layers go on the page, then export a marked-up PDF. It is made on this
 * device from the cached script, downloads at once, and is recorded (as an ExportRecord for the
 * show) as soon as there is a network, so it works the same offline.
 */
export function PrintDialog({
  documentId,
  versionId,
  onClose,
  returnFocusTo = null,
}: PrintDialogProps) {
  const session = useMarkupSession()
  const db = usePowerSync()
  const online = useOnline()
  const headingId = useId()
  const ids = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  // Hidden departments are not offered; every member sees every other department layer.
  const departments = useMemo(
    () =>
      session.departments
        .filter((d) => !d.hidden)
        .map((d) => ({ id: d.id, code: d.code ?? '', colour: d.colour })),
    [session.departments],
  )
  const [picked, setPicked] = useState<ReadonlySet<string>>(
    () => new Set(callingScript(departments).map(layerKey)),
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (dialog.current) openModal(dialog.current)
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
      flushSoon()
      // Through the dialog's own close, so its `close` handler hands focus back to the opener.
      closeModal(dialog.current, returnFocusTo)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <DialogShell
      ref={dialog}
      labelledBy={headingId}
      className="print-dialog max-w-[min(34rem,calc(100vw-32px))]"
      onClose={() => {
        restoreFocus(returnFocusTo)
        onClose()
      }}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <DialogHeader id={headingId} className="mb-0">
          Print
        </DialogHeader>
        <p className="m-0 text-[14px] text-muted">
          Marks the script with the layers you choose. Page size and the searchable text stay as
          they are, and every page gets a footer.
        </p>
        <fieldset
          aria-label="Presets"
          className="print-presets m-0 flex flex-wrap gap-2 border-0 p-0"
        >
          <Button
            type="button"
            variant="line"
            size="sm"
            onClick={() => setPicked(new Set(callingScript(departments).map(layerKey)))}
          >
            Calling script: all layers
          </Button>
          <Button type="button" variant="line" size="sm" onClick={() => setPicked(new Set())}>
            Clean copy
          </Button>
        </fieldset>
        <fieldset className="print-layers m-0 grid grid-cols-1 gap-x-6 border-0 p-0 sm:grid-cols-2">
          <legend className="col-span-full mb-1 p-0 text-[11px] font-bold tracking-[0.08em] text-muted uppercase">
            Layers
          </legend>
          {departments.map((d) => {
            const layer: LayerRef = { kind: 'department', id: d.id }
            const id = `${ids}-${d.id}`
            return (
              <div key={d.id} className="flex min-h-11 items-center gap-3 md:min-h-9">
                <Checkbox
                  id={id}
                  checked={picked.has(layerKey(layer))}
                  onCheckedChange={(on) => toggle(layer, on === true)}
                />
                <Label
                  htmlFor={id}
                  className="flex flex-1 cursor-pointer items-center gap-2 text-[14px] text-ink"
                >
                  {/* The department's own colour, from the data. */}
                  <span
                    aria-hidden
                    className="size-3 rounded-[3px] bg-faint"
                    style={d.colour ? { background: d.colour } : undefined}
                  />
                  {d.code}
                </Label>
              </div>
            )
          })}
          {personal && (
            <div className="col-span-full flex min-h-11 items-center gap-3 md:min-h-9">
              <Checkbox
                id={`${ids}-personal`}
                checked={includesPersonal}
                onCheckedChange={(on) => toggle(personal, on === true)}
              />
              <Label
                htmlFor={`${ids}-personal`}
                className="flex cursor-pointer items-center gap-2 text-[14px] text-ink"
              >
                <span aria-hidden className="size-3 rounded-[3px] bg-dept-personal" />
                Personal layer
              </Label>
              <span className="text-[12px] text-muted">only you</span>
            </div>
          )}
        </fieldset>
        {includesPersonal && (
          <p role="status" className="m-0 text-[14px] text-muted">
            Only you will see this export.
          </p>
        )}
        <p className="m-0 text-[14px] text-muted">
          Footer layers: {selectionSummary(selection, departments)}
        </p>
        {!online && (
          <p className="m-0 text-[14px] text-muted">
            You are offline. The file downloads now and is recorded when you reconnect.
          </p>
        )}
        {error && (
          <p role="alert" className="field-error m-0 text-[14px] text-t-out">
            {error}
          </p>
        )}
        <DialogFooter divided className="mt-2">
          <Button
            type="button"
            variant="line"
            onClick={() => closeModal(dialog.current, returnFocusTo)}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !session.userId}>
            {busy ? 'Preparing…' : 'Export PDF'}
          </Button>
        </DialogFooter>
      </form>
    </DialogShell>
  )
}

/** The top bar's Print button, with the dialog it opens. */
export function PrintButton() {
  const session = useMarkupSession()
  const [open, setOpen] = useState(false)
  const opener = useRef<HTMLButtonElement>(null)
  return (
    <>
      <Button
        ref={opener}
        type="button"
        variant="line"
        size="sm"
        className="shrink-0 max-md:size-11 max-md:px-0 md:h-8 md:px-3.5 md:text-[13px]"
        onClick={() => setOpen(true)}
      >
        <Printer aria-hidden className="!size-4" strokeWidth={1.8} />
        <span className="max-md:sr-only">Print</span>
      </Button>
      {open && (
        <PrintDialog
          documentId={session.documentId}
          versionId={session.versionId}
          returnFocusTo={opener.current}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
