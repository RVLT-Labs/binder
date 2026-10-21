import { layerSelectionLabel } from '@binder/core'
import {
  type LayerRef,
  layerKey,
  normalisePageRange,
  type PaperSize,
  parsePageRange,
  scriptExportFilename,
  validateExportFilename,
} from '@binder/shared'
import { usePowerSync, useQuery } from '@powersync/react'
import {
  type ButtonHTMLAttributes,
  type FormEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import { PrintIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DialogFooter, DialogShell } from '@/components/ui/dialog-shell'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Segmented } from '@/components/ui/segmented'
import { closeModal, openModal, restoreFocus } from '@/lib/modalDialog'
import { cn, focusRing } from '@/lib/utils'
import { pushNotice } from '../components/noticeStore'
import { useMarkupSession } from '../markup/MarkupSession'
import { useOnline } from '../offline/useOnline'
import { flushSoon } from './flusher'
import { PrintPreview } from './PrintPreview'
import { nearestPaper, readPaperSize } from './paperSize'
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

/** `.dx-opt-h`: the small muted heading over each group of options. */
const HEADING = 'text-[11px] font-semibold text-muted'

/** `.dx-cb-row`: 28 px rows (44 on a phone) with a 10 px gap. */
const ROW = 'flex min-h-11 items-center gap-2.5'
/** `.dx-link`: a blue 12.5 px / 600 text link. */
const PRESET =
  'rounded-sm text-[12.5px] font-semibold text-blue max-md:min-h-11 max-md:min-w-11 max-md:px-1'
/** Link artwork stays compact; the actual button reserves its independent two-axis target. */
export function PrintPresetButton({
  className,
  style,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      type="button"
      className={cn(PRESET, focusRing, className)}
      style={{ ...style, minHeight: 44, minWidth: 44 }}
    />
  )
}

/** On a phone the label fills its 44 px row, so a tap anywhere on the row toggles it. */
const LABEL_FILL = 'max-md:flex max-md:items-center max-md:self-stretch'

const INFO_SQL = `
  SELECT d.title AS doc_title, v.version_number AS version_number, v.page_count AS page_count,
    s.title AS show_title, s.settings AS settings
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
    page_count: number | null
    show_title: string | null
    settings: string | null
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
  const [pagesMode, setPagesMode] = useState<'all' | 'range'>('all')
  const [rangeText, setRangeText] = useState('')
  const [paperPick, setPaperPick] = useState<PaperSize | null>(null)
  const [includeCueNotes, setIncludeCueNotes] = useState(true)
  const [includeStandbyWarn, setIncludeStandbyWarn] = useState(true)
  const [includeAnnotations, setIncludeAnnotations] = useState(true)
  /** The file name once the user has typed in the field; until then it follows the choices. */
  const [typedName, setTypedName] = useState<string | null>(null)
  const rangeField = useRef<HTMLInputElement>(null)

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

  const pageCount = infoRow?.page_count ?? session.pages.length
  // The paper starts at the sheet page 1 already is (so an untouched print changes nothing), else
  // at the show's own paper; the user's pick wins from then on.
  const firstPage = session.pages[0]
  const paper: PaperSize =
    paperPick ??
    nearestPaper(firstPage?.width, firstPage?.height) ??
    readPaperSize(infoRow?.settings)
  const range = pagesMode === 'range' ? parsePageRange(rangeText, pageCount) : null
  const rangeInvalid = range !== null && !range.ok
  // Nothing typed yet is not yet an error to scold: Download just waits.
  const rangeError = range && !range.ok && rangeText.trim() !== '' ? range.message : null
  const defaultName = scriptExportFilename({
    show: info?.showTitle ?? '',
    document: info?.docTitle ?? '',
    versionNumber: info?.versionNumber ?? 1,
    layerLabel: selectionSummary(selection, departments),
  })
  const filename = typedName ?? defaultName
  const nameCheck = validateExportFilename(filename)
  const rangeEmpty = range !== null && !range.ok && rangeText.trim() === ''
  const rangeHintId = `${ids}-range-hint`
  const rangeErrorId = `${ids}-range-error`
  const nameErrorId = `${ids}-name-error`

  async function submit(e: FormEvent) {
    e.preventDefault()
    const ctx = session.editContext()
    if (!ctx || busy || rangeInvalid || !nameCheck.ok) return
    setBusy(true)
    setError(null)
    try {
      const { filename: saved } = await runPrintExport(db, ctx, {
        documentId,
        versionId,
        layers: selection,
        options: {
          pages: pagesMode === 'all' ? 'all' : (normalisePageRange(rangeText) ?? rangeText),
          paper,
          includeStandbyWarn,
          includeAnnotations,
          includeCueNotes,
        },
        filename,
      })
      pushNotice({
        kind: 'info',
        message: online
          ? `Downloaded ${saved}.`
          : `Downloaded ${saved}. It will be recorded in Exports when you are back online.`,
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
  const printedDepartments = departments.filter((d) =>
    picked.has(layerKey({ kind: 'department', id: d.id })),
  )
  return (
    <DialogShell
      ref={dialog}
      labelledBy={headingId}
      className="print-dialog max-h-[calc(100dvh-32px)] max-w-[min(53.75rem,calc(100vw-32px))] overflow-y-auto px-[26px] pt-[22px] pb-[18px]"
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
        <div className="flex flex-col gap-4 md:flex-row md:gap-7">
          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <fieldset className="print-layers m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
              <legend className="sr-only">Layers</legend>
              <div className={cn(HEADING, 'flex items-center justify-between')}>
                <span aria-hidden>Layers</span>
                {/* `.dx-link`: the presets are two blue text links at the right of the header */}
                <fieldset
                  aria-label="Presets"
                  className="print-presets m-0 flex gap-3 border-0 p-0"
                >
                  <PrintPresetButton
                    aria-label="Calling script: all layers"
                    onClick={() => setPicked(new Set(callingScript(departments).map(layerKey)))}
                  >
                    All
                  </PrintPresetButton>
                  <PrintPresetButton
                    disabled={!personal}
                    onClick={() => setPicked(new Set(personal ? [layerKey(personal)] : []))}
                  >
                    Only mine
                  </PrintPresetButton>
                </fieldset>
              </div>
              <div>
                {departments.map((d) => {
                  const layer: LayerRef = { kind: 'department', id: d.id }
                  const id = `${ids}-${d.id}`
                  return (
                    <div key={d.id} className={ROW}>
                      <Checkbox
                        className="shrink-0"
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
                      <Label
                        htmlFor={id}
                        className={cn(LABEL_FILL, 'flex-1 cursor-pointer text-[13px] text-ink')}
                      >
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
                      className="shrink-0"
                      id={`${ids}-personal`}
                      checked={includesPersonal}
                      onCheckedChange={(on) => toggle(personal, on === true)}
                    />
                    <span
                      aria-hidden
                      className="size-2.5 shrink-0 rounded-[3px] bg-dept-personal"
                    />
                    <Label
                      htmlFor={`${ids}-personal`}
                      className={cn(LABEL_FILL, 'cursor-pointer text-[13px] text-ink')}
                    >
                      Personal<span className="sr-only"> layer</span>
                    </Label>
                    <span aria-hidden className="text-[12px] text-muted">
                      only you
                    </span>
                    <span className="ml-auto font-mono text-[12px] tabular-nums text-muted">
                      {counts.personal}
                    </span>
                  </div>
                )}
              </div>
            </fieldset>
            <div className="grid gap-4 md:grid-cols-2 md:gap-5">
              <div className="grid content-start gap-2">
                <span aria-hidden className={HEADING}>
                  Pages
                </span>
                <div className="flex flex-wrap items-center gap-2.5">
                  <Segmented
                    aria-label="Pages"
                    value={pagesMode}
                    onValueChange={(mode) => {
                      setPagesMode(mode === 'range' ? 'range' : 'all')
                      if (mode === 'range') rangeField.current?.focus()
                    }}
                    options={[
                      { value: 'all', label: pageCount > 0 ? `All ${pageCount}` : 'All' },
                      { value: 'range', label: 'Range' },
                    ]}
                  />
                  <Input
                    ref={rangeField}
                    aria-label="Page range"
                    aria-invalid={rangeError ? true : undefined}
                    aria-describedby={rangeError ? rangeErrorId : undefined}
                    placeholder={`1–${Math.max(pageCount, 1)}`}
                    autoComplete="off"
                    spellCheck={false}
                    value={rangeText}
                    onChange={(e) => {
                      setRangeText(e.target.value)
                      setPagesMode('range')
                    }}
                    className="w-28 font-mono tabular-nums md:w-[84px]"
                  />
                </div>
                {rangeEmpty && (
                  <p id={rangeHintId} className="m-0 text-[12px] text-muted">
                    Enter a page range
                  </p>
                )}
                {rangeError && (
                  <p id={rangeErrorId} role="alert" className="m-0 text-[12px] text-t-out">
                    {rangeError}
                  </p>
                )}
              </div>
              <div className="grid content-start gap-2">
                <span aria-hidden className={HEADING}>
                  Paper
                </span>
                <div>
                  <Segmented
                    aria-label="Paper"
                    value={paper}
                    onValueChange={(next) => setPaperPick(next === 'Letter' ? 'Letter' : 'A4')}
                    options={[
                      { value: 'A4', label: 'A4' },
                      { value: 'Letter', label: 'Letter' },
                    ]}
                  />
                </div>
              </div>
            </div>
            <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
              <legend className="sr-only">Include</legend>
              <span aria-hidden className={HEADING}>
                Include
              </span>
              <div>
                {(
                  [
                    ['cue-notes', 'Cue notes', includeCueNotes, setIncludeCueNotes],
                    [
                      'standby-warn',
                      'Standby and warn tags',
                      includeStandbyWarn,
                      setIncludeStandbyWarn,
                    ],
                    ['annotations', 'Annotations', includeAnnotations, setIncludeAnnotations],
                  ] as const
                ).map(([key, label, on, set]) => (
                  <div key={key} className={ROW}>
                    <Checkbox
                      className="shrink-0"
                      id={`${ids}-${key}`}
                      checked={on}
                      onCheckedChange={(next) => set(next === true)}
                    />
                    <Label
                      htmlFor={`${ids}-${key}`}
                      className={cn(LABEL_FILL, 'flex-1 cursor-pointer text-[13px] text-ink')}
                    >
                      {label}
                    </Label>
                  </div>
                ))}
              </div>
            </fieldset>
          </div>
          <div className="flex flex-col items-center md:w-[230px] md:flex-none md:pt-1">
            <PrintPreview
              paper={paper}
              departments={printedDepartments}
              sideOf={(id) => session.markerSide(id)}
              standbyWarn={includeStandbyWarn}
            />
          </div>
        </div>
        {includesPersonal && (
          <p role="status" className="m-0 text-[12px] text-muted">
            Only you will see this export.
          </p>
        )}
        <div className="grid gap-[3px]">
          <Label htmlFor={`${ids}-filename`} className="text-[11px] font-semibold text-ink-2">
            File name
          </Label>
          <Input
            id={`${ids}-filename`}
            value={filename}
            onChange={(e) => setTypedName(e.target.value)}
            aria-invalid={nameCheck.ok ? undefined : true}
            aria-describedby={nameCheck.ok ? undefined : nameErrorId}
            autoComplete="off"
            spellCheck={false}
            className="font-mono tabular-nums"
          />
          {!nameCheck.ok && (
            <p id={nameErrorId} role="alert" className="m-0 text-[12px] text-t-out">
              {nameCheck.reason}
            </p>
          )}
        </div>
        {!online && (
          <p className="m-0 text-[12px] text-muted">
            You are offline. The file downloads now and is recorded when you reconnect.
          </p>
        )}
        {error && (
          <p role="alert" className="m-0 text-[12px] text-t-out">
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
          <Button
            type="submit"
            disabled={busy || !session.userId || rangeInvalid || !nameCheck.ok}
            aria-describedby={
              rangeEmpty
                ? rangeHintId
                : rangeError
                  ? rangeErrorId
                  : nameCheck.ok
                    ? undefined
                    : nameErrorId
            }
          >
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
