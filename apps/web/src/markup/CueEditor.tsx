import { formatCueNumber, markerText, parseCueNumber } from '@binder/core'
import type { CueFields, CueType } from '@binder/shared'
import { usePowerSync, useQuery } from '@powersync/react'
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react'
import { pushNotice } from '../components/noticeStore'
import type { Database } from '../powersync/schema'
import { useMarkupSession } from './MarkupSession'
import { fromCueRow, updateCue } from './mutations'

export const NUMBER_HINT = 'Cue numbers look like 10, 10.5, or 0.50.'

const TYPES: Array<{ value: CueType; label: string }> = [
  { value: 'go', label: 'Go' },
  { value: 'standby', label: 'Standby' },
  { value: 'warn', label: 'Warning' },
]

export interface CueEditorProps {
  cueId: string
  /** Filled by the cue's history (Task 12). */
  historySlot?: ReactNode
}

type CueRow = Database['cues'] & { id: string }

/**
 * The selected cue's fields. Text fields save when they lose focus or on Enter; choices save at
 * once. A cue on a layer the user cannot edit, a locked layer, or an archived show is read-only.
 * Render it with `key={cueId}` so another cue starts with a fresh form.
 */
export function CueEditor({ cueId, historySlot }: CueEditorProps) {
  const session = useMarkupSession()
  const db = usePowerSync()
  const { data } = useQuery<CueRow>('SELECT * FROM cues WHERE id = ?', [cueId])
  const [numberError, setNumberError] = useState<string | null>(null)
  const ids = useId()
  const errorId = `${ids}-error`
  const row = data[0]
  if (!row) return null

  const cue = fromCueRow(row)
  const department = session.departments.find((d) => d.id === cue.departmentId)
  const code = department?.code ?? '?'
  const format = department?.number_format === 'point' ? 'point' : 'decimal'
  const number = formatCueNumber(cue.major, cue.minor, format)
  const reason = session.whyCantEdit(row)
  const editable = reason === null
  const choices = session.departments.filter(
    (d) =>
      d.id === cue.departmentId ||
      session.editable.some((l) => l.kind === 'department' && l.id === d.id),
  )

  async function save(patch: Partial<CueFields>) {
    const ctx = session.editContext()
    if (!ctx) return
    try {
      await updateCue(db, ctx, cueId, patch)
    } catch (err) {
      pushNotice({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }

  function saveNumber(text: string) {
    const parsed = parseCueNumber(text)
    if (!parsed) {
      setNumberError(NUMBER_HINT)
      return
    }
    setNumberError(null)
    if (parsed.major !== cue.major || parsed.minor !== cue.minor) void save(parsed)
  }

  return (
    // Escape in a field (a choice here; text fields cancel their draft first) leaves the field and
    // keeps the cue selected; only an Escape outside the form deselects.
    <section className="cue-editor" aria-label="Cue editor" onKeyDown={leaveFieldOnEscape}>
      <h2>{markerText(cue.type, code, number)}</h2>
      {!editable && <p className="muted">{reason}</p>}
      <fieldset disabled={!editable}>
        <label htmlFor={`${ids}-number`}>
          Number
          <CommitInput
            id={`${ids}-number`}
            value={number}
            onCommit={saveNumber}
            aria-invalid={numberError ? true : undefined}
            aria-describedby={numberError ? errorId : undefined}
          />
        </label>
        {numberError && (
          <p id={errorId} role="alert" className="field-error">
            {numberError}
          </p>
        )}
        <label htmlFor={`${ids}-label`}>
          Label
          <CommitInput
            id={`${ids}-label`}
            value={cue.label}
            onCommit={(label) => label !== cue.label && save({ label })}
          />
        </label>
        <label>
          Type
          <select value={cue.type} onChange={(e) => save({ type: e.target.value as CueType })}>
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Department
          <select value={cue.departmentId} onChange={(e) => save({ departmentId: e.target.value })}>
            {choices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.code} · {d.name}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={`${ids}-notes`}>
          Notes
          <CommitInput
            id={`${ids}-notes`}
            multiline
            value={cue.notes}
            onCommit={(notes) => notes !== cue.notes && save({ notes })}
          />
        </label>
        {cue.anchor?.text && (
          <p className="cue-quote">
            <span className="muted">Line:</span> “{cue.anchor.text.quote}”
          </p>
        )}
        <button type="button" className="danger" onClick={() => void session.removeCue(cueId)}>
          Delete cue
        </button>
      </fieldset>
      {historySlot}
    </section>
  )
}

function leaveFieldOnEscape(e: KeyboardEvent<HTMLElement>) {
  if (e.key !== 'Escape' || e.defaultPrevented) return
  const field = e.target
  if (
    field instanceof HTMLSelectElement ||
    field instanceof HTMLInputElement ||
    field instanceof HTMLTextAreaElement
  ) {
    e.preventDefault()
    field.blur()
  }
}

interface CommitInputProps {
  id: string
  value: string
  onCommit: (value: string) => void
  multiline?: boolean
  'aria-invalid'?: boolean
  'aria-describedby'?: string
}

/**
 * A text field that edits a draft and commits it on blur or Enter; Escape throws the draft away and
 * leaves the field. It follows `value` while not focused.
 */
function CommitInput({ value, onCommit, multiline = false, ...aria }: CommitInputProps) {
  const [draft, setDraft] = useState(value)
  const [focused, setFocused] = useState(false)
  /** Set by Escape so the blur that follows does not commit the abandoned draft. */
  const cancelled = useRef(false)
  useEffect(() => {
    if (!focused) setDraft(value)
  }, [value, focused])
  const common = {
    ...aria,
    value: draft,
    onFocus: () => setFocused(true),
    onBlur: () => {
      setFocused(false)
      if (cancelled.current) cancelled.current = false
      else onCommit(multiline ? draft : draft.trim())
    },
  }
  function cancelOnEscape(e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    if (e.key !== 'Escape') return false
    e.preventDefault()
    cancelled.current = true
    setDraft(value)
    e.currentTarget.blur()
    return true
  }
  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (cancelOnEscape(e)) return
    if (e.key === 'Enter') {
      e.preventDefault()
      onCommit(draft.trim())
    }
  }
  return multiline ? (
    <textarea
      {...common}
      rows={3}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={cancelOnEscape}
    />
  ) : (
    <input {...common} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKeyDown} />
  )
}
