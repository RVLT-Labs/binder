import type { CueListRow } from '@binder/core'
import type { CueFields, CueType } from '@binder/shared'
import { deptChrome } from '@binder/shared'
import { type ReactNode, useId } from 'react'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/segmented'
import { CommitInput, leaveFieldOnEscape } from '../markup/CommitInput'
import { Field, FieldError, Note, SectionLabel, Swatch } from '../panel/fields'
import { useNumberEdit } from './numberEdit'

const TYPES: Array<{ value: CueType; label: string }> = [
  { value: 'go', label: 'Go' },
  { value: 'standby', label: 'Standby' },
  { value: 'warn', label: 'Warn' },
]

export interface CueDetailProps {
  row: CueListRow
  department: { code: string; colour: string | null } | null
  /** Why nothing can be edited, or null. */
  readOnly: string | null
  /** A phone's cards do not edit, so its panel carries the number and type too. */
  phone: boolean
  onEdit: (patch: Partial<CueFields>) => void
  onShowOnPage: () => void
  /** The cue's change log: drawn under a "History" label (the `cues` mockup's panel). */
  history?: ReactNode
}

/**
 * The cue list's Cue tab (the `cues` mockup's panel): the department and the number in 18 px mono
 * with "Show on page" beside it, then Label, Trigger and Notes, and the latest history. Number and
 * type are edited in the table's row; on a phone, where there is no table, they are here.
 */
export function CueDetail({
  row,
  department,
  readOnly,
  phone,
  onEdit,
  onShowOnPage,
  history,
}: CueDetailProps) {
  const ids = useId()
  const number = useNumberEdit((_id, patch) => onEdit(patch))
  const error = number.errors[row.id]
  const editable = readOnly === null
  return (
    <section
      aria-label="Cue details"
      className="flex flex-col gap-3.5"
      onKeyDown={leaveFieldOnEscape}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 flex items-center gap-1.5 font-sans text-[13px] font-semibold text-ink">
          <Swatch colour={department?.colour ? deptChrome(department.colour) : 'var(--faint)'} />
          <span>
            {department?.code ?? '?'}{' '}
            <span className="ml-1 align-middle font-mono text-[18px] font-semibold tabular-nums max-md:text-[22px]">
              {row.display}
            </span>
          </span>
        </h2>
        <Button
          type="button"
          variant="line"
          size="sm"
          disabled={!row.placed}
          onClick={onShowOnPage}
          className="shrink-0"
        >
          Show on page
        </Button>
      </div>
      {!row.placed && <Note>This cue is not on a page yet.</Note>}
      {readOnly && <Note>{readOnly}</Note>}
      <fieldset disabled={!editable} className="m-0 grid min-w-0 gap-3.5 border-0 p-0">
        {phone && (
          <>
            <Field label="Number" htmlFor={`${ids}-number`}>
              <CommitInput
                id={`${ids}-number`}
                className="font-mono tabular-nums"
                value={row.display}
                aria-invalid={error ? true : undefined}
                onCommit={(text) => number.commit(row, text)}
                onCancel={() => number.clear(row.id)}
              />
            </Field>
            {error && <FieldError>{error}</FieldError>}
            <Field label="Type">
              <Segmented
                aria-label="Type"
                value={row.type}
                onValueChange={(type) => onEdit({ type: type as CueType })}
                options={TYPES}
                disabled={!editable}
                className="flex w-full [&>*]:flex-1"
              />
            </Field>
          </>
        )}
        <Field label="Label" htmlFor={`${ids}-label`}>
          <CommitInput
            id={`${ids}-label`}
            value={row.label}
            onCommit={(label) => label !== row.label && onEdit({ label })}
          />
        </Field>
        {row.trigger && (
          <Field label="Trigger">
            {/* `.quote`: mono 11.5 px, a 2 px rule in the department colour, the card fill */}
            <p
              className="cue-quote m-0 rounded-r-[8px] border-l-2 bg-card px-2.5 py-2 font-mono text-[11.5px] leading-snug text-ink-2 max-md:px-3 max-md:text-[12px]"
              style={{
                borderColor: department?.colour ? deptChrome(department.colour) : undefined,
              }}
            >
              “{row.trigger}” <span className="whitespace-nowrap text-faint">{row.page}</span>
            </p>
          </Field>
        )}
        <Field label="Notes" htmlFor={`${ids}-notes`}>
          <CommitInput
            id={`${ids}-notes`}
            multiline
            className="min-h-[52px] resize-none py-1.5 text-ink-2"
            value={row.notes}
            onCommit={(notes) => notes !== row.notes && onEdit({ notes })}
          />
        </Field>
      </fieldset>
      {history && (
        <>
          <SectionLabel className="mt-1">History</SectionLabel>
          {history}
        </>
      )}
    </section>
  )
}
