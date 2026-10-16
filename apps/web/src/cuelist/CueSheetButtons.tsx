import { usePowerSync } from '@powersync/react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
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
  /**
   * `button` (the top bar): an Export button that opens the formats. `group`: the formats alone, for
   * a menu that already is the place (the phone's "More").
   */
  variant?: 'button' | 'group'
  /** An export finished (or failed): the menu that holds the group can close. */
  onDone?: () => void
}

/**
 * The cue list's export: the department's cue sheet as PDF, XLSX or CSV, behind the top bar's
 * Export button (the mockup draws one) as the "Export cue sheet" group. Each is made on
 * this device and downloads at once, then is recorded as an ExportRecord for the show as soon as
 * there is a network, so it works the same offline. Anyone who can see the list can export it,
 * including on an archived show, and an empty list exports as its header row.
 */
export function CueSheetButtons({
  departmentId,
  departmentCode,
  editContext,
  variant = 'button',
  onDone,
}: CueSheetButtonsProps) {
  const db = usePowerSync()
  const online = useOnline()
  const [busy, setBusy] = useState<SheetFormat | null>(null)
  const [open, setOpen] = useState(false)

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
      setOpen(false)
      onDone?.()
    }
  }

  const group = (
    <fieldset aria-label="Export cue sheet" className="m-0 grid min-w-0 gap-2 border-0 p-0">
      <span className="font-sans text-[11px] font-semibold text-muted">
        Export {departmentCode} cue sheet
      </span>
      <span className="flex gap-2">
        {FORMATS.map(({ format, label }) => (
          <Button
            key={format}
            type="button"
            variant="line"
            size="sm"
            className="flex-1"
            disabled={busy !== null}
            onClick={() => void run(format)}
          >
            {busy === format ? 'Preparing…' : label}
          </Button>
        ))}
      </span>
    </fieldset>
  )
  if (variant === 'group') return group

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="line" size="sm">
          Export
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-3">
        {group}
      </PopoverContent>
    </Popover>
  )
}
