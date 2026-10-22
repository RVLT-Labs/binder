import { formatCueNumber, markerLead, parseCueNumber, withMark } from '@binder/core'
import { type CueFields, type CueMark, type CueType, markOf } from '@binder/shared'
import { usePowerSync, useQuery } from '@powersync/react'
import { useId, useState } from 'react'
import { ChevronDownIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/segmented'
import { cn } from '@/lib/utils'
import { pushNotice } from '../components/noticeStore'
import { relativeTime } from '../history/relative'
import { useNow } from '../history/useNow'
import { Field, FieldError, Note, SelectField, StatusPill, Swatch } from '../panel/fields'
import type { Database } from '../powersync/schema'
import { usePresencePeers } from '../presence/PresenceProvider'
import { useBreakpoint } from '../shell/useBreakpoint'
import { CommitInput, leaveFieldOnEscape } from './CommitInput'
import { useMarkupSession } from './MarkupSession'
import { fromCueRow, updateCue } from './mutations'
import { loadWordLayer } from './wordLayers'

export const NUMBER_HINT = 'Cue numbers look like 10, 10.5, or 0.50.'

const TYPES: Array<{ value: CueType; label: string }> = [
  { value: 'go', label: 'Go' },
  { value: 'standby', label: 'Standby' },
  { value: 'warn', label: 'Warn' },
]

const MARKS: Array<{ value: CueMark; label: string }> = [
  { value: 'underline', label: 'Underline' },
  { value: 'highlight', label: 'Highlight' },
  { value: 'line', label: 'Line' },
  { value: 'pointer', label: 'Line with pointer' },
]

/**
 * The Mark options sit four across in a panel as narrow as 290 px, so "Line with pointer" must be
 * able to wrap: no fixed height (a minimum only, 44 px on the phone and on coarse pointers, 36 px
 * on the tablet, 27 px on desktop) and wrapping text. The tablet step keeps 9 px padding, 12.5 px.
 */
export const MARK_ITEM_CLASS = [
  'h-auto min-h-11 whitespace-normal py-1 text-center leading-tight',
  'md:h-auto md:min-h-[27px]',
  'md:max-[1024px]:h-auto md:max-[1024px]:min-h-9 md:max-[1024px]:px-[9px] md:max-[1024px]:text-[12.5px]',
  'pointer-coarse:min-h-11',
].join(' ')

export interface CueEditorProps {
  cueId: string
  /** Phone: closes the drawer. Draws the red Done beside Delete (the mockup's sheet actions). */
  onDone?: () => void
}

type CueRow = Database['cues'] & { id: string }

/**
 * The selected cue's fields (the mockup's cue panel): the department swatch, the cue's number in
 * mono and its anchor state, then Number, Label, Type and Layer, the trigger words it sits on and
 * Notes. Text fields save when they lose focus or on Enter; choices save at once. A cue on a layer
 * the user cannot edit, a locked layer, or an archived show is read-only. At phone width Number,
 * Layer and Notes wait behind "More fields" so the sheet stays the mockup's size. Render it with
 * `key={cueId}` so another cue starts with a fresh form.
 */
export function CueEditor({ cueId, onDone }: CueEditorProps) {
  const session = useMarkupSession()
  const db = usePowerSync()
  const phone = useBreakpoint() === 'phone'
  // who else is here, by name, for "edited by"; and the clock that keeps its time counting
  const { peers } = usePresencePeers()
  const now = useNow()
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
  const moved = cue.anchor?.tag !== undefined
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

  /**
   * Switches how the cue marks its place. A line takes the caret's x and keeps the range; leaving a
   * line covers just the word the bar sits in (the range of a line runs to the end of its line) and
   * keeps x where the caret was.
   */
  async function saveMark(mark: CueMark) {
    const anchor = cue.anchor
    if (!anchor || mark === markOf(anchor)) return
    // The page's words belong to the version open in the viewer: another version's cue has none here.
    const key =
      anchor.documentVersionId === session.versionId
        ? session.pages[anchor.pageIndex]?.words_key
        : null
    let layer = null
    try {
      layer = key ? await loadWordLayer(key) : null
    } catch {
      // a page whose words will not load still changes mark; withMark copes without a layer
    }
    await save({ anchor: withMark(anchor, mark, { layer, oneWord: true }) })
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

  const numberField = (
    <Field label="Number" htmlFor={`${ids}-number`}>
      <CommitInput
        id={`${ids}-number`}
        inputMode="decimal"
        className="font-mono tabular-nums"
        value={number}
        onCommit={saveNumber}
        onCancel={() => setNumberError(null)}
        aria-invalid={numberError ? true : undefined}
        aria-describedby={numberError ? errorId : undefined}
      />
    </Field>
  )
  const layerField = (
    <Field label="Layer" htmlFor={`${ids}-layer`} className="min-w-0 flex-1">
      <SelectField
        id={`${ids}-layer`}
        swatch={department?.colour ?? undefined}
        value={cue.departmentId}
        onChange={(e) => save({ departmentId: e.target.value })}
      >
        {choices.map((d) => (
          <option key={d.id} value={d.id} title={d.name ?? undefined}>
            {d.code}
          </option>
        ))}
      </SelectField>
    </Field>
  )
  const notesField = (
    <Field label="Notes" htmlFor={`${ids}-notes`}>
      <CommitInput
        id={`${ids}-notes`}
        multiline
        className="min-h-[52px] py-1.5 text-ink-2"
        value={cue.notes}
        onCommit={(notes) => notes !== cue.notes && save({ notes })}
      />
    </Field>
  )
  const quote = cue.anchor?.text && (
    <Field label="Trigger">
      {/* `.quote`: mono 11.5 px, a 2 px rule in the department colour, the card fill */}
      <p
        className="cue-quote m-0 rounded-r-[8px] border-l-2 bg-card px-2.5 py-2 font-mono text-[11.5px] leading-snug text-ink-2 max-md:px-3 max-md:text-[12px]"
        style={{ borderColor: department?.colour ?? undefined }}
      >
        “{cue.anchor.text.quote}”{' '}
        <span className="whitespace-nowrap text-muted">p.{cue.anchor.pageIndex + 1}</span>
      </p>
    </Field>
  )
  const editor =
    row.updated_by && row.updated_by === session.userId
      ? 'you'
      : (peers.find((p) => p.userId === row.updated_by)?.name ?? 'a teammate')
  const edited = row.updated_at && `edited by ${editor} · ${relativeTime(row.updated_at, now)}`

  return (
    // Escape in a field (a choice here; text fields cancel their draft first) leaves the field and
    // keeps the cue selected; only an Escape outside the form deselects.
    <section
      className="cue-editor flex flex-col gap-3.5"
      aria-label="Cue editor"
      onKeyDown={leaveFieldOnEscape}
    >
      <div className="flex items-center justify-between max-md:min-h-8">
        <h2 className="m-0 flex items-center gap-1.5 font-sans text-[13px] font-semibold text-ink">
          <Swatch colour={department?.colour ?? 'var(--faint)'} />
          <span>
            {markerLead(cue.type, code)}{' '}
            <span className="ml-1 align-middle font-mono text-[18px] font-semibold tabular-nums max-md:text-[22px]">
              {number}
            </span>
          </span>
        </h2>
        <StatusPill status={cue.anchor?.status} dot />
      </div>
      {!editable && <Note>{reason}</Note>}
      <fieldset disabled={!editable} className="m-0 grid min-w-0 gap-3.5 border-0 p-0">
        {!phone && numberField}
        {numberError && !phone && <FieldError id={errorId}>{numberError}</FieldError>}
        <Field label="Label" htmlFor={`${ids}-label`}>
          <CommitInput
            id={`${ids}-label`}
            value={cue.label}
            onCommit={(label) => label !== cue.label && save({ label })}
          />
        </Field>
        <div className={cn('flex gap-3', phone && 'flex-col')}>
          <Field label="Type" className="shrink-0">
            <Segmented
              aria-label="Type"
              value={cue.type}
              onValueChange={(type) => save({ type: type as CueType })}
              options={TYPES}
              disabled={!editable}
              className={phone ? 'flex w-full [&>*]:flex-1' : undefined}
              // the tablet sheet's segmented buttons: 9 px padding, 12.5 px (t-markup)
              itemClassName="md:max-[1024px]:h-9 md:max-[1024px]:px-[9px] md:max-[1024px]:text-[12.5px]"
            />
          </Field>
          {!phone && layerField}
        </div>
        <Field label="Mark">
          <Segmented
            aria-label="Mark"
            value={markOf(cue.anchor)}
            onValueChange={(mark) => void saveMark(mark as CueMark)}
            options={MARKS}
            disabled={!editable || !cue.anchor}
            className="flex w-full [&>*]:flex-1"
            itemClassName={MARK_ITEM_CLASS}
          />
        </Field>
        <Field label="Bubble">
          {/* the state is a word, not a colour: "Moved" only once the bubble has been placed */}
          <fieldset
            aria-label="Bubble"
            className="m-0 flex min-h-[27px] min-w-0 items-center border-0 p-0 justify-between gap-3 max-md:flex-col max-md:items-stretch max-md:gap-2"
          >
            <span className="text-[13px] text-ink-2 max-md:text-[14px]">
              {moved ? 'Moved' : 'In the margin'}
            </span>
            {moved && (
              <Button
                type="button"
                variant="line"
                size="sm"
                disabled={!editable}
                className="pointer-coarse:min-h-11 max-md:w-full"
                onClick={() => void session.setBubble(cueId, null)}
              >
                Reset to margin
              </Button>
            )}
          </fieldset>
        </Field>
        {quote}
        {!phone && notesField}
        {phone && (
          <details className="group rounded-[12px] border-2 border-line-2 px-3">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-[14px] font-semibold text-ink-2 [&::-webkit-details-marker]:hidden">
              More fields
              <ChevronDownIcon
                aria-hidden
                className="size-4 text-muted transition-transform group-open:rotate-180"
              />
            </summary>
            <div className="grid gap-3.5 pb-3">
              {numberField}
              {numberError && <FieldError id={errorId}>{numberError}</FieldError>}
              {layerField}
              {notesField}
            </div>
          </details>
        )}
        <div className={cn('flex items-center justify-between gap-3', phone && 'mt-0.5')}>
          <Button
            type="button"
            variant={phone ? 'line' : 'ghost'}
            size="sm"
            aria-label="Delete cue"
            className={cn(phone ? 'w-28' : 'text-muted hover:text-ink')}
            onClick={() => void session.removeCue(cueId)}
          >
            Delete
          </Button>
          {onDone ? (
            <Button type="button" className="flex-1" onClick={onDone}>
              Done
            </Button>
          ) : (
            edited && <span className="text-[12px] text-muted">{edited}</span>
          )}
        </div>
      </fieldset>
    </section>
  )
}
