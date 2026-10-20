import type { CueListRow } from '@binder/core'
import type { CueFields, CueType } from '@binder/shared'
import type { KeyboardEvent, MouseEvent } from 'react'
import { cn } from '@/lib/utils'
import { CommitInput } from '../markup/CommitInput'
import { FieldError } from '../panel/fields'
import { FlagPill } from './FlagPill'
import { useNumberEdit } from './numberEdit'

const TYPES: Array<{ value: CueType; label: string }> = [
  { value: 'go', label: 'Go' },
  { value: 'standby', label: 'Standby' },
  { value: 'warn', label: 'Warn' },
]

export interface CueListTableProps {
  rows: CueListRow[]
  /** The row whose details the panel shows: it wears the red outline and fill. */
  selectedId: string | null
  /** Why nothing can be edited (archived show, a layer outside the user's scope), or null. */
  readOnly: string | null
  onEdit(id: string, patch: Partial<CueFields>): void
  /** A row was chosen (a click, Enter or Space): the panel shows it. */
  onSelect(row: CueListRow): void
}

/** True for a click that landed on a field or button, which should not also select the row. */
const onControl = (target: EventTarget) =>
  target instanceof Element && target.closest('input, select, textarea, button, a') !== null

/**
 * A cell's field drawn as the mockup's plain text (`.table td`): no box until it is hovered, and
 * the red focus ring and paper ground while it is edited. 17 px high, so a row is the mockup's 36.
 */
const CELL_FIELD =
  'block h-[17px] rounded-[4px] border-0 bg-transparent px-0 py-0 leading-[17px] shadow-none ' +
  'hover:bg-elev focus-visible:bg-paper focus-visible:px-1 focus-visible:ring-2 focus-visible:ring-red focus-visible:ring-offset-0 ' +
  'md:h-[17px] md:max-[1024px]:h-7 md:px-0 md:focus-visible:px-1 disabled:opacity-100 disabled:hover:bg-transparent'

const TH = 'border-b border-line px-2.5 py-1.5 text-left text-[11px] font-semibold text-muted'
const TD = 'border-t border-line px-2.5 py-[9px] align-middle leading-[17px] text-ink'

/** The page cell: the number alone under a "Page" heading, with the document's name when there are several. */
function pageText(row: CueListRow): string {
  if (!row.anchor) return '—'
  const n = String(row.anchor.pageIndex + 1)
  return row.documentTitle ? `${row.documentTitle} ${n}` : n
}

/**
 * A department's cues (the `cues` mockup's `.table`) with inline edits of number, type, label and
 * notes. Mono tabular numbers, the trigger in mono, flags as pills with words; a click on a row
 * (or Enter on it) selects it for the panel, and the selected row has the red outline and fill.
 */
export function CueListTable({ rows, selectedId, readOnly, onEdit, onSelect }: CueListTableProps) {
  const numbers = useNumberEdit(onEdit)
  const disabled = readOnly !== null
  const onRowKey = (row: CueListRow) => (e: KeyboardEvent<HTMLTableRowElement>) => {
    if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return
    e.preventDefault()
    onSelect(row)
  }

  return (
    <table className="w-full table-fixed border-collapse text-[13px]" aria-label="Cues">
      <thead>
        <tr>
          <th scope="col" className={cn(TH, 'w-[70px]')}>
            Cue
          </th>
          <th scope="col" className={cn(TH, 'w-20')}>
            Type
          </th>
          <th scope="col" className={cn(TH, 'w-[20%]')}>
            Label
          </th>
          <th scope="col" className={cn(TH, 'w-[52px] text-right')}>
            Page
          </th>
          <th scope="col" className={cn(TH, 'w-[25%]')}>
            Trigger
          </th>
          <th scope="col" className={TH}>
            Notes
          </th>
          <th scope="col" className={cn(TH, 'w-24')}>
            <span className="sr-only">Flags</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => {
          const error = numbers.errors[row.id]
          const selected = row.id === selectedId
          return (
            <tr
              key={row.id}
              data-cue-id={row.id}
              data-placed={row.placed}
              data-selected={selected || undefined}
              aria-current={selected ? 'true' : undefined}
              tabIndex={0}
              className={cn(
                'cursor-pointer rounded-[4px] focus-visible:outline-2 focus-visible:outline-red',
                row.placed && 'cue-row-placed',
                // `.sel`: a 2 px red outline 2 px out; `tr.sel td`: a 12 % red wash and a 3 px red bar at the left
                selected &&
                  'outline outline-2 outline-offset-2 outline-red [&>td:first-child]:shadow-[inset_3px_0_0_var(--red)] [&>td]:bg-red/12',
              )}
              onClick={(e: MouseEvent) => {
                if (!onControl(e.target)) onSelect(row)
              }}
              onKeyDown={onRowKey(row)}
            >
              <td className={TD}>
                <CommitInput
                  id={`cue-${row.id}-number`}
                  aria-label={`Number, row ${i + 1}`}
                  aria-invalid={error ? true : undefined}
                  className={cn(CELL_FIELD, 'font-mono text-[13px] font-semibold tabular-nums')}
                  value={row.display}
                  disabled={disabled}
                  onCommit={(text) => numbers.commit(row, text)}
                  onCancel={() => numbers.clear(row.id)}
                />
                {error && <FieldError className="mt-1">{error}</FieldError>}
              </td>
              <td className={TD}>
                <select
                  aria-label={`Type, row ${i + 1}`}
                  value={row.type}
                  disabled={disabled}
                  onChange={(e) => onEdit(row.id, { type: e.target.value as CueType })}
                  className={cn(
                    CELL_FIELD,
                    'w-full cursor-pointer appearance-none text-[13px] text-ink lowercase',
                  )}
                >
                  {TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </td>
              <td className={TD}>
                <CommitInput
                  id={`cue-${row.id}-label`}
                  aria-label={`Label, row ${i + 1}`}
                  className={cn(CELL_FIELD, 'text-[13px] text-ink')}
                  placeholder="—"
                  value={row.label}
                  disabled={disabled}
                  onCommit={(label) => label !== row.label && onEdit(row.id, { label })}
                />
              </td>
              <td
                className={cn(
                  TD,
                  'cue-page text-right font-mono tabular-nums',
                  !row.placed && 'text-muted',
                )}
              >
                {pageText(row)}
              </td>
              <td
                className={cn(
                  TD,
                  'cue-trigger truncate font-mono text-[12px] leading-[17px] text-ink-2',
                )}
                title={row.trigger || undefined}
              >
                {row.trigger}
              </td>
              <td className={TD}>
                <CommitInput
                  id={`cue-${row.id}-notes`}
                  aria-label={`Notes, row ${i + 1}`}
                  className={cn(CELL_FIELD, 'text-[12px] text-ink')}
                  value={row.notes}
                  disabled={disabled}
                  onCommit={(notes) => notes !== row.notes && onEdit(row.id, { notes })}
                />
              </td>
              <td className={TD}>
                <span className="flex flex-wrap gap-1">
                  {row.flags.map((flag) => (
                    <FlagPill key={flag} flag={flag} />
                  ))}
                </span>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
