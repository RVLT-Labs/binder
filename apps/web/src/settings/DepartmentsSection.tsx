import { COLOUR_RE, DEPARTMENT_COLOUR_PRESETS, deptChrome } from '@binder/shared'
import { useQuery } from '@powersync/react'
import { useMutation } from '@tanstack/react-query'
import { type FormEvent, type ReactNode, useId, useState } from 'react'
import { PlusIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Segmented } from '@/components/ui/segmented'
import { cn } from '@/lib/utils'
import { api } from '../api/client'
import { MarkerSideControl, SIDE_LABEL, useMarkerSides } from '../markup/MarkerSideEditor'
import type { DepartmentRow } from '../markup/useDepartments'
import { SECTION_LABEL } from '../panel/fields'
import { ColourField } from './ColourField'
import { ADD_ROW, FIELD_LABEL, Field } from './parts'

type NumberFormat = 'decimal' | 'point'

const FORMATS: Array<{ value: NumberFormat; label: ReactNode }> = [
  { value: 'decimal', label: '10.5' },
  { value: 'point', label: '10.50' },
]
const FORMAT_ITEM = 'font-mono font-medium flex-1 md:flex-none'

const errorText = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong')

/** The first preset colour no department of the show uses yet (the first one when all are taken). */
export function firstUnusedColour(departments: Array<{ colour: string | null }>): string {
  const used = new Set(departments.map((d) => d.colour?.toUpperCase()))
  return (
    DEPARTMENT_COLOUR_PRESETS.find((p) => !used.has(p.colour)) ?? DEPARTMENT_COLOUR_PRESETS[0]
  ).colour
}

// swatch, code, name, number format, marker side, cues, hidden: the settings mockup's columns
// (without the drag grip and Remove, which the app has no action for).
const COLUMNS = 'md:grid-cols-[24px_56px_minmax(0,1fr)_128px_128px_74px_64px]'
const ROW_GRID = cn('md:grid md:items-center md:gap-x-3', COLUMNS)

/** The department code as the mockups' tinted pill (`.ac-code`, `.mb-code`). */
function CodePill({ code, colour }: { code: string; colour: string | null }) {
  const c = colour && COLOUR_RE.test(colour) ? deptChrome(colour) : 'var(--muted)'
  return (
    <span
      className="inline-flex h-6 min-w-[46px] items-center justify-center rounded-[7px] px-2.5 font-mono text-[12.5px] font-semibold md:h-[22px] md:min-w-11 md:px-[9px] md:text-[12px]"
      style={{ color: c, background: `color-mix(in oklab, ${c} 14%, transparent)` }}
    >
      {code}
    </span>
  )
}

/** The small label over a control on a phone card; the table's header row says it at 768 and up. */
const CARD_LABEL = cn(FIELD_LABEL, 'mb-[3px] md:hidden')

function Cues({ count }: { count: number }) {
  return (
    <span className="font-mono text-[12px] text-ink-2 tabular-nums md:text-right md:text-[12.5px]">
      {count}
      <span className="ml-1 font-sans text-[11px] text-faint">{count === 1 ? 'cue' : 'cues'}</span>
    </span>
  )
}

export function DepartmentsSection({
  showId,
  departments,
  editable,
}: {
  showId: string
  departments: DepartmentRow[]
  editable: boolean
}) {
  const sides = useMarkerSides(showId)
  const { data: counts } = useQuery<{ department_id: string; n: number }>(
    'SELECT department_id, count(*) AS n FROM cues WHERE show_id = ? GROUP BY department_id',
    [showId],
  )
  const cueCount = (id: string) => counts.find((c) => c.department_id === id)?.n ?? 0
  return (
    <section aria-labelledby="departments-heading" className="flex flex-col gap-2">
      <h2 id="departments-heading" className={SECTION_LABEL}>
        Departments
      </h2>
      <div
        aria-hidden
        className={cn(
          'hidden border-b border-line px-3 pb-1 text-[11px] font-semibold text-muted',
          'md:grid md:gap-x-3',
          COLUMNS,
        )}
      >
        <span />
        <span>Code</span>
        <span>Name</span>
        <span>Number format</span>
        <span>Marker side</span>
        <span className="text-right">Cues</span>
        <span title="Hiding a department removes it from the pickers but keeps its cues.">
          Hidden
        </span>
      </div>
      <ul aria-label="Departments" className="m-0 flex list-none flex-col gap-2.5 p-0 md:gap-0">
        {departments.map((d) => (
          <li key={d.id} className="md:border-t md:border-line md:first:border-t-0">
            {editable ? (
              <EditableRow
                department={d}
                cues={cueCount(d.id)}
                side={sides.sideOf(d.id)}
                onSide={(s) => void sides.setSide(d.id, s)}
              />
            ) : (
              <ReadOnlyRow department={d} cues={cueCount(d.id)} side={sides.sideOf(d.id)} />
            )}
          </li>
        ))}
      </ul>
      {editable && <AddDepartment showId={showId} departments={departments} />}
    </section>
  )
}

/** A department's card on a phone, a table row from 768 up. */
const ROW_BOX = cn(
  'flex flex-col gap-1.5 rounded-[var(--r)] border-2 border-line-2 bg-card px-3.5 pt-2.5 pb-3 shadow-card',
  'md:min-h-10 md:rounded-none md:border-0 md:bg-transparent md:px-3 md:py-0 md:shadow-none',
  ROW_GRID,
)

/** Phone: the code, name and cue count along the top of the card. Table: the cells join the row. */
const HEAD = 'flex items-center justify-between gap-2.5 md:contents'
/** Phone: Colour, Number format and Marker side in one row of the card. */
const CONTROLS = 'grid grid-cols-[44px_1.05fr_1fr] items-end gap-2 md:contents'

function ReadOnlyRow({
  department: d,
  cues,
  side,
}: {
  department: DepartmentRow
  cues: number
  side: 'left' | 'right'
}) {
  const format = d.number_format === 'point' ? '10.50' : '10.5'
  return (
    <div className={ROW_BOX}>
      <div className={HEAD}>
        <span className="flex min-w-0 items-center gap-2.5 md:contents">
          <span className="md:col-start-2 md:row-start-1">
            <CodePill code={d.code ?? ''} colour={d.colour} />
          </span>
          <span className="min-w-0 truncate text-[15px] font-semibold text-ink md:col-start-3 md:row-start-1 md:text-[13px]">
            {d.name}
          </span>
        </span>
        <span className="md:col-start-6 md:row-start-1 md:justify-self-end">
          <Cues count={cues} />
        </span>
      </div>
      <div className={CONTROLS}>
        <div className="md:col-start-1 md:row-start-1">
          <div className={CARD_LABEL}>Colour</div>
          <span
            aria-hidden
            className="grid size-11 place-items-center rounded-[12px] border-2 border-line-2 bg-paper md:size-6 md:rounded-[7px]"
          >
            <i
              className="block size-4 rounded-[5px] md:size-3 md:rounded-[4px]"
              style={{ background: d.colour ? deptChrome(d.colour) : 'var(--faint)' }}
            />
          </span>
        </div>
        <div className="md:col-start-4 md:row-start-1">
          <div className={CARD_LABEL}>Number format</div>
          <span className="font-mono text-[13px] text-ink-2 md:text-[12.5px]">
            <span className="sr-only">numbers </span>
            {format}
          </span>
        </div>
        <div className="md:col-start-5 md:row-start-1">
          <div className={CARD_LABEL}>Marker side</div>
          <span className="text-[13px] text-ink-2">
            <span className="sr-only">tags </span>
            {SIDE_LABEL[side]}
          </span>
        </div>
      </div>
      {d.hidden ? (
        <span className="text-[12px] text-muted md:col-start-7 md:row-start-1">hidden</span>
      ) : null}
    </div>
  )
}

function EditableRow({
  department,
  cues,
  side,
  onSide,
}: {
  department: DepartmentRow
  cues: number
  side: 'left' | 'right'
  onSide: (side: 'left' | 'right') => void
}) {
  const [name, setName] = useState(department.name ?? '')
  const [error, setError] = useState<string | null>(null)
  const hiddenId = useId()
  const save = useMutation({
    mutationFn: (patch: Record<string, unknown>) =>
      api.patch(`/departments/${department.id}`, patch),
    onSuccess: () => setError(null),
    onError: (err) => setError(errorText(err)),
  })
  const code = department.code ?? ''
  return (
    <div className={ROW_BOX}>
      <div className={HEAD}>
        <span className="flex min-w-0 flex-1 items-center gap-2.5 md:contents">
          <span className="md:col-start-2 md:row-start-1">
            <CodePill code={code} colour={department.colour} />
          </span>
          <Input
            aria-label={`${code} name`}
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            onBlur={() =>
              name.trim() && name !== department.name && save.mutate({ name: name.trim() })
            }
            // Reads as the mockup's plain name until it is hovered or focused.
            className="min-w-0 flex-1 border-transparent bg-transparent px-1.5 text-[15px] font-semibold hover:border-input focus-visible:bg-paper md:col-start-3 md:row-start-1 md:-ml-[9px] md:flex-none md:text-[13px]"
          />
        </span>
        <span className="md:col-start-6 md:row-start-1 md:justify-self-end">
          <Cues count={cues} />
        </span>
      </div>
      <div className={CONTROLS}>
        <div className="md:col-start-1 md:row-start-1">
          <div className={CARD_LABEL}>Colour</div>
          <ColourField
            label={`${code} colour`}
            value={department.colour ?? '#999999'}
            onChange={(colour) => save.mutate({ colour })}
          />
        </div>
        <div className="min-w-0 md:col-start-4 md:row-start-1">
          <div className={CARD_LABEL}>Number format</div>
          <Segmented
            aria-label={`${code} number format`}
            value={department.number_format ?? 'decimal'}
            onValueChange={(v) => save.mutate({ numberFormat: v as NumberFormat })}
            options={FORMATS}
            itemClassName={FORMAT_ITEM}
            className="flex md:inline-flex"
          />
        </div>
        <div className="min-w-0 md:col-start-5 md:row-start-1">
          <div className={CARD_LABEL}>Marker side</div>
          <MarkerSideControl
            code={code}
            side={side}
            onChange={onSide}
            className="flex md:inline-flex"
          />
        </div>
      </div>
      <div className="flex items-center gap-2 max-md:min-h-11 md:col-start-7 md:row-start-1">
        <Checkbox
          id={hiddenId}
          checked={department.hidden === 1}
          onCheckedChange={(on) => save.mutate({ hidden: on === true })}
        />
        <label htmlFor={hiddenId} className="text-[13px] text-ink-2 md:sr-only">
          Hidden
        </label>
      </div>
      {error && (
        <p
          role="alert"
          className="m-0 text-[12px] text-ink-2 md:col-span-full md:row-start-2 md:pb-2"
        >
          {error}
        </p>
      )}
    </div>
  )
}

function AddDepartment({ showId, departments }: { showId: string; departments: DepartmentRow[] }) {
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [picked, setPicked] = useState<string | null>(null)
  const [numberFormat, setNumberFormat] = useState<NumberFormat>('decimal')
  // The next colour in the preset order that no department has taken, until one is picked.
  const colour = picked ?? firstUnusedColour(departments)
  const add = useMutation({
    mutationFn: () =>
      api.post(`/shows/${showId}/departments`, { code, name: name.trim(), colour, numberFormat }),
    onSuccess: () => {
      setCode('')
      setName('')
      setPicked(null)
      setOpen(false)
    },
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    add.mutate()
  }
  return (
    <>
      <Button
        type="button"
        variant="line"
        aria-expanded={open}
        className={cn('w-full md:hidden', open && 'hidden')}
        onClick={() => setOpen(true)}
      >
        <PlusIcon aria-hidden />
        Add department
      </Button>
      <form
        onSubmit={submit}
        aria-label="Add department"
        className={cn(
          ADD_ROW,
          'flex flex-wrap items-end gap-3 md:flex-nowrap',
          !open && 'max-md:hidden',
        )}
      >
        <Field label="Code" className="w-24 max-md:flex-1">
          <Input
            aria-label="New department code"
            placeholder="PYRO"
            value={code}
            maxLength={8}
            onChange={(e) => setCode(e.target.value)}
            className="font-mono"
            required
          />
        </Field>
        <Field label="Name" className="min-w-0 flex-[2] max-md:basis-full">
          <Input
            aria-label="New department name"
            placeholder="Pyrotechnics"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </Field>
        <Field label="Colour">
          <ColourField
            label="New department colour"
            value={colour}
            onChange={setPicked}
            className="md:h-[30px] md:w-[34px]"
          />
        </Field>
        <Field label="Number format" className="max-md:flex-1">
          <Segmented
            aria-label="New department number format"
            value={numberFormat}
            onValueChange={(v) => setNumberFormat(v as NumberFormat)}
            options={FORMATS}
            itemClassName={FORMAT_ITEM}
            className="flex md:inline-flex"
          />
        </Field>
        <Button type="submit" variant="line" aria-label="Add department" loading={add.isPending}>
          Add
        </Button>
        <Button type="button" variant="ghost" className="md:hidden" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        {add.isError && (
          <p role="alert" className="m-0 basis-full text-[12px] text-ink-2">
            {errorText(add.error)}
          </p>
        )}
      </form>
    </>
  )
}
