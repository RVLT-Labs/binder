import { usePowerSync } from '@powersync/react'
import { useState } from 'react'
import { pushNotice } from '../components/noticeStore'
import { flushSoon } from '../exports/flusher'
import { runCueSheetExport, type SheetFormat } from '../exports/runCueSheetExport'
import type { EditContext } from '../markup/mutations'
import { useOnline } from '../offline/useOnline'

const FORMATS: Array<{ format: SheetFormat; label: string }> = [
  { format: 'pdf', label: 'PDF' },
  { format: 'xlsx', label: 'XLSX' },
  { format: 'csv', label: 'CSV' },
]

export interface CueSheetButtonsProps {
  departmentId: string
  departmentCode: string
  /** The live edit context (its user and show); null before the session is ready. */
  editContext(): EditContext | null
}

/**
 * The cue list's export buttons: the department's cue sheet as PDF, XLSX or CSV. Each is made on
 * this device and downloads at once, then is recorded as an ExportRecord for the show as soon as
 * there is a network, so it works the same offline. Anyone who can see the list can export it,
 * including on an archived show, and an empty list exports as its header row.
 */
export function CueSheetButtons({
  departmentId,
  departmentCode,
  editContext,
}: CueSheetButtonsProps) {
  const db = usePowerSync()
  const online = useOnline()
  const [busy, setBusy] = useState<SheetFormat | null>(null)

  async function run(format: SheetFormat) {
    const ctx = editContext()
    if (!ctx || busy) return
    setBusy(format)
    try {
      const { filename } = await runCueSheetExport(db, ctx, { departmentId, format })
      pushNotice({
        kind: 'info',
        message: online
          ? `Downloaded ${filename}.`
          : `Downloaded ${filename}. It will be recorded in Exports when you are back online.`,
      })
      // Right after queueing: a no-op offline, and the online event takes over when it returns.
      flushSoon()
    } catch (err) {
      pushNotice({
        kind: 'error',
        message: `Could not export the ${departmentCode} cue sheet: ${err instanceof Error ? err.message : String(err)}`,
      })
    } finally {
      setBusy(null)
    }
  }

  return (
    <fieldset className="cue-sheet-export" aria-label="Export cue sheet">
      <span className="muted">Export {departmentCode} cue sheet:</span>{' '}
      {FORMATS.map(({ format, label }) => (
        <button
          key={format}
          type="button"
          disabled={busy !== null}
          onClick={() => void run(format)}
        >
          {busy === format ? 'Preparing…' : label}
        </button>
      ))}
    </fieldset>
  )
}
