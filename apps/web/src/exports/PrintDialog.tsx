import { layerSelectionLabel } from '@binder/core'
import { type LayerRef, layerKey } from '@binder/shared'
import { usePowerSync, useQuery } from '@powersync/react'
import { type FormEvent, useEffect, useId, useMemo, useRef, useState } from 'react'
import { PrintIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DialogFooter, DialogShell } from '@/components/ui/dialog-shell'
import { Label } from '@/components/ui/label'
import { closeModal, openModal, restoreFocus } from '@/lib/modalDialog'
import { cn, focusRing } from '@/lib/utils'
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

/** `.dx-cb-row`: 28 px rows (44 on a phone) with a 10 px gap. */
const ROW = 'flex min-h-11 items-center gap-2.5 md:min-h-0 md:h-7'
/** `.dx-link`: a blue 12.5 px / 600 text link. */
const PRESET = 'rounded-sm text-[12.5px] font-semibold text-blue max-md:min-h-11 max-md:px-1'

const INFO_SQL = `
  SELECT d.title AS doc_title, v.version_number AS version_number, s.title AS show_title
  FROM document_versions v
  JOIN documents d ON d.id = v.document_id
  JOIN shows s ON s.id = d.show_id
  WHERE v.id = ?`
const CUE_COUNTS_SQL = `
  SELECT department_id AS id, count(*) AS n FROM cues
  WHERE show_id = ? AND json_extract(anchor, '$.documentVersionId') = ? GROUP BY department_id`
const PERSONAL_COUNT_SQL = `
  SELECT count(*) AS n FROM annotations
  WHERE show_id = ? AND layer_kind = 'personal' AND layer_id = ?
    AND json_extract(anchor, '$.documentVersionId') = ?`

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
  const { data: infoRows } = useQuery<{
    doc_title: string | null
    version_number: number | null
    show_title: string | null
  }>(INFO_SQL, [versionId])
  const infoRow = infoRows[0]
  const info = infoRow
    ? {
        docTitle: infoRow.doc_title,
        versionNumber: infoRow.version_number,
        showTitle: infoRow.show_title,
      }
    : null
  // What each layer holds on this version: local rows, no fetch.
  const { data: cueRows } = useQuery<{ id: string; n: number }>(CUE_COUNTS_SQL, [
    session.showId,
    versionId,
  ])
  const { data: personalRows } = useQuery<{ n: number }>(PERSONAL_COUNT_SQL, [
    session.showId,
    session.userId ?? '',
    versionId,
  ])
  const counts = {
    dept: new Map(cueRows.map((r) => [r.id, Number(r.n)])),
    personal: Number(personalRows[0]?.n ?? 0),
  }
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

  const title = info?.docTitle
    ? `Print ${info.docTitle} v${info.versionNumber ?? ''}`.trim()
    : 'Print'
  const pageCount = session.pages.length
  return (
    <DialogShell
      ref={dialog}
      labelledBy={headingId}
      className="print-dialog max-w-[min(34rem,calc(100vw-32px))] px-[26px] pt-[22px] pb-[18px]"
      onClose={() => {
        restoreFocus(returnFocusTo)
        onClose()
      }}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            {info?.showTitle && <p className="t-over m-0 truncate">{info.showTitle}</p>}
            <h2 id={headingId} className="t-title m-0 [overflow-wrap:anywhere]">
              {title}
            </h2>
          </div>
          {pageCount > 0 && (
            <span className="shrink-0 pt-4 text-[12px] text-muted">
              <span className="font-mono tabular-nums">{pageCount}</span>{' '}
              {pageCount === 1 ? 'page' : 'pages'}
            </span>
          )}
        </div>
        <fieldset className="print-layers m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
          <legend className="sr-only">Layers</legend>
          <div className="flex items-center justify-between text-[11px] font-semibold text-muted">
            <span aria-hidden>Layers</span>
            {/* `.dx-link`: the presets are two blue text links at the right of the header */}
            <fieldset aria-label="Presets" className="print-presets m-0 flex gap-3 border-0 p-0">
              <button
                type="button"
                aria-label="Calling script: all layers"
                className={cn(PRESET, focusRing)}
                onClick={() => setPicked(new Set(callingScript(departments).map(layerKey)))}
              >
                All
              </button>
              <button
                type="button"
                className={cn(PRESET, focusRing)}
                onClick={() => setPicked(new Set())}
              >
                Clean copy
              </button>
            </fieldset>
          </div>
          <div>
            {departments.map((d) => {
              const layer: LayerRef = { kind: 'department', id: d.id }
              const id = `${ids}-${d.id}`
              return (
                <div key={d.id} className={ROW}>
                  <Checkbox
                    id={id}
                    checked={picked.has(layerKey(layer))}
                    onCheckedChange={(on) => toggle(layer, on === true)}
                  />
                  {/* The department's own colour, from the data. */}
                  <span
                    aria-hidden
                    className="size-2.5 shrink-0 rounded-[3px] bg-faint"
                    style={d.colour ? { background: d.colour } : undefined}
                  />
                  <Label htmlFor={id} className="flex-1 cursor-pointer text-[13px] text-ink">
                    {d.code}
                  </Label>
                  <span className="font-mono text-[12px] tabular-nums text-muted">
                    {counts.dept.get(d.id) ?? 0}
                  </span>
                </div>
              )
            })}
            {personal && (
              <div className={ROW}>
                <Checkbox
                  id={`${ids}-personal`}
                  checked={includesPersonal}
                  onCheckedChange={(on) => toggle(personal, on === true)}
                />
                <span aria-hidden className="size-2.5 shrink-0 rounded-[3px] bg-dept-personal" />
                <Label htmlFor={`${ids}-personal`} className="cursor-pointer text-[13px] text-ink">
                  Personal<span className="sr-only"> layer</span>
                </Label>
                <span aria-hidden className="text-[12px] text-faint">
                  only you
                </span>
                <span className="ml-auto font-mono text-[12px] tabular-nums text-muted">
                  {counts.personal}
                </span>
              </div>
            )}
          </div>
        </fieldset>
        {includesPersonal && (
          <p role="status" className="m-0 text-[12px] text-muted">
            Only you will see this export.
          </p>
        )}
        <p className="m-0 text-[12px] text-muted">
          Footer layers: {selectionSummary(selection, departments)}
        </p>
        {!online && (
          <p className="m-0 text-[12px] text-muted">
            You are offline. The file downloads now and is recorded when you reconnect.
          </p>
        )}
        {error && (
          <p role="alert" className="field-error m-0 text-[12px] text-t-out">
            {error}
          </p>
        )}
        <DialogFooter divided className="mt-0 items-center">
          <span className="text-[12px] text-muted max-md:order-last max-md:text-center md:mr-auto">
            Saved to Exports. Works offline.
          </span>
          <Button
            type="button"
            variant="ghost"
            onClick={() => closeModal(dialog.current, returnFocusTo)}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !session.userId}>
            {busy ? 'Preparing…' : 'Download PDF'}
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
        className="shrink-0 max-md:size-11 max-md:px-0"
        onClick={() => setOpen(true)}
      >
        <PrintIcon aria-hidden />
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
