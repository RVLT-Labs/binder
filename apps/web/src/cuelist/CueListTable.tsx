import { type CueListRow, parseCueNumber } from '@binder/core'
import type { CueFields, CueType } from '@binder/shared'
import { type MouseEvent, useState } from 'react'
import { CommitInput } from '../markup/CommitInput'
import { NUMBER_HINT } from '../markup/CueEditor'

const TYPES: Array<{ value: CueType; label: string }> = [
  { value: 'go', label: 'Go' },
  { value: 'standby', label: 'Standby' },
  { value: 'warn', label: 'Warning' },
]

const FLAG_TEXT: Record<CueListRow['flags'][number], string> = {
  duplicate: 'Duplicate',
  approximate: 'Approximate',
  unresolved: 'Unresolved',
  'older-version': 'Older version',
}

export interface CueListTableProps {
  rows: CueListRow[]
  /** Why nothing can be edited (archived show, a layer outside the user's scope), or null. */
  readOnly: string | null
  onEdit(id: string, patch: Partial<CueFields>): void
  /** A placed row was chosen: open the viewer at its page with the cue selected. */
  onOpen(row: CueListRow): void
}

/** True for a click that landed on a field or button, which should not also open the row. */
const onControl = (target: EventTarget) =>
  target instanceof Element && target.closest('input, select, textarea, button, a') !== null

/** A department's cues with inline edits of number, type, label and notes. */
export function CueListTable({ rows, readOnly, onEdit, onOpen }: CueListTableProps) {
  const [numberErrors, setNumberErrors] = useState<Record<string, string>>({})

  const clearError = (id: string) =>
    setNumberErrors((prev) => {
      const { [id]: _gone, ...rest } = prev
      return rest
    })

  function commitNumber(row: CueListRow, text: string) {
    // Retyping the stored number is not an edit and ends any complaint about an earlier try.
    if (text === row.display) {
      clearError(row.id)
      return
    }
    const parsed = parseCueNumber(text)
    if (!parsed) {
      setNumberErrors((prev) => ({ ...prev, [row.id]: NUMBER_HINT }))
      return
    }
    clearError(row.id)
    onEdit(row.id, parsed)
  }

  const disabled = readOnly !== null
  return (
    <table className="cue-list" aria-label="Cues">
      <thead>
        <tr>
          <th scope="col">Number</th>
          <th scope="col">Type</th>
          <th scope="col">Label</th>
          <th scope="col">Page</th>
          <th scope="col">Trigger</th>
          <th scope="col">Notes</th>
          <th scope="col">Flags</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => {
          const error = numberErrors[row.id]
          const open = row.placed ? () => onOpen(row) : undefined
          return (
            <tr
              key={row.id}
              data-cue-id={row.id}
              data-placed={row.placed}
              className={row.placed ? 'cue-row-placed' : undefined}
              onClick={
                open
                  ? (e: MouseEvent) => {
                      if (!onControl(e.target)) open()
                    }
                  : undefined
              }
            >
              <td>
                <CommitInput
                  id={`cue-${row.id}-number`}
                  aria-label={`Number, row ${i + 1}`}
                  aria-invalid={error ? true : undefined}
                  value={row.display}
                  disabled={disabled}
                  onCommit={(text) => commitNumber(row, text)}
                  onCancel={() => clearError(row.id)}
                />
                {error && (
                  <p role="alert" className="field-error">
                    {error}
                  </p>
                )}
              </td>
              <td>
                <select
                  aria-label={`Type, row ${i + 1}`}
                  value={row.type}
                  disabled={disabled}
                  onChange={(e) => onEdit(row.id, { type: e.target.value as CueType })}
                >
                  {TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <CommitInput
                  id={`cue-${row.id}-label`}
                  aria-label={`Label, row ${i + 1}`}
                  value={row.label}
                  disabled={disabled}
                  onCommit={(label) => label !== row.label && onEdit(row.id, { label })}
                />
              </td>
              <td className="cue-page">
                {open ? (
                  <button type="button" className="link-button" onClick={open}>
                    {row.page}
                  </button>
                ) : (
                  <span className="muted">{row.page}</span>
                )}
              </td>
              <td className="cue-trigger">{row.trigger}</td>
              <td>
                <CommitInput
                  id={`cue-${row.id}-notes`}
                  aria-label={`Notes, row ${i + 1}`}
                  value={row.notes}
                  disabled={disabled}
                  onCommit={(notes) => notes !== row.notes && onEdit(row.id, { notes })}
                />
              </td>
              <td>
                {row.flags.map((flag) => (
                  <span key={flag} className="badge" data-flag={flag}>
                    {FLAG_TEXT[flag]}
                  </span>
                ))}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
