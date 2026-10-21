import { deptChrome } from '@binder/shared'
import { type Ref, useEffect, useRef } from 'react'
import { Kbd } from '@/components/ui/kbd'
import { Segmented } from '@/components/ui/segmented'
import { cn } from '@/lib/utils'
import { isEditableTarget } from '../markup/useMarkupShortcuts'
import { Swatch } from '../panel/fields'

export interface DepartmentOption {
  id: string
  code: string
  /** The department's colour from data; drawn as its chrome tint. */
  colour: string | null
  /** How many cues the department has. */
  count: number
}

/**
 * The department switch (the mockup's `.seg` / `.mb-seg`): one segmented control, each segment the
 * code and its cue count in mono, full width at 44 px on a phone (where each also carries its
 * colour swatch).
 */
export function DepartmentSwitch({
  departments,
  value,
  onChange,
}: {
  departments: DepartmentOption[]
  value: string
  onChange: (id: string) => void
}) {
  // A show can have seven departments, more than fit across a phone: the control scrolls sideways
  // inside its own box, and the chosen department is kept in view.
  const box = useRef<HTMLDivElement>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: the chosen department moved
  useEffect(() => {
    box.current
      ?.querySelector('[aria-checked="true"]')
      ?.scrollIntoView?.({ inline: 'nearest', block: 'nearest' })
  }, [value])
  return (
    <div
      ref={box}
      className="max-md:w-full max-md:min-w-0 max-md:overflow-x-auto max-md:[scrollbar-width:none] max-md:rounded-[12px]"
    >
      <Segmented
        aria-label="Department"
        value={value}
        onValueChange={onChange}
        className="max-md:flex max-md:w-full max-md:min-w-max max-md:bg-paper"
        itemClassName="max-md:flex-1 max-md:shrink-0 max-md:px-3.5"
        options={departments.map((d) => ({
          value: d.id,
          label: (
            <>
              {d.colour && <Swatch colour={deptChrome(d.colour)} className="md:hidden" />}
              {d.code}
              <span className="font-mono text-[12px] font-medium text-muted tabular-nums">
                {d.count}
              </span>
            </>
          ),
        }))}
      />
    </div>
  )
}

export type FlagFilter = 'duplicate' | 'approximate' | 'unresolved'
export type FlagCounts = Record<FlagFilter, number>

/** Each flag's pill (`.pill.warn`, `.pill.rep`, red-soft) and the word it carries. */
const FLAGS: Array<{ flag: FlagFilter; word: string; look: string }> = [
  { flag: 'duplicate', word: 'duplicate', look: 'bg-warn-soft text-warn' },
  { flag: 'approximate', word: 'approximate', look: 'bg-rep-soft text-rep' },
  { flag: 'unresolved', word: 'unresolved', look: 'bg-red-soft text-t-out' },
]

/**
 * Filter pills: how many cues carry each flag, and a toggle to list only those. A flag nobody has is
 * not offered (unless it is switched on, so it can be switched off). On a phone they are the
 * mockup's muted outlined chips (`.mb-fchip`: they only count), at the 44 px touch size.
 */
export function FlagPills({
  counts,
  active,
  onToggle,
}: {
  counts: FlagCounts
  active: Record<FlagFilter, boolean>
  onToggle: (flag: FlagFilter) => void
}) {
  return (
    <>
      {FLAGS.filter(({ flag }) => counts[flag] > 0 || active[flag]).map(({ flag, word, look }) => (
        <button
          key={flag}
          type="button"
          aria-pressed={active[flag]}
          onClick={() => onToggle(flag)}
          className={cn(
            'inline-flex h-5 shrink-0 items-center gap-[5px] whitespace-nowrap rounded-full px-2 font-sans text-[11px] font-semibold leading-none',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red focus-visible:ring-offset-2 focus-visible:ring-offset-paper',
            'aria-pressed:shadow-[inset_0_0_0_1.5px_currentColor]',
            look,
            // phone: a muted 2 px outlined chip, 44 px high; pressed is the elevated fill
            'max-md:h-11 max-md:border-2 max-md:border-line-2 max-md:bg-paper max-md:px-[13px] max-md:text-[12.5px] max-md:text-ink-2 max-md:aria-pressed:bg-elev max-md:aria-pressed:text-ink max-md:aria-pressed:shadow-none',
          )}
        >
          <span className="max-md:font-mono max-md:font-medium max-md:text-muted">
            {counts[flag]}
          </span>{' '}
          {word}
        </button>
      ))}
    </>
  )
}

/**
 * The "/ filter" box at the right of the filter row, and `/` (outside a field) puts the cursor in
 * it. `field` is the phone's Search row: a full-width field with no shortcut hint.
 */
export function FilterBox({
  value,
  onChange,
  variant = 'inline',
  inputRef,
}: {
  value: string
  onChange: (value: string) => void
  variant?: 'inline' | 'field'
  inputRef?: Ref<HTMLInputElement>
}) {
  const own = useRef<HTMLInputElement | null>(null)
  const inline = variant === 'inline'
  // the phone's Search button opens this field to type in: the cursor goes straight to it
  useEffect(() => {
    if (!inline) own.current?.focus()
  }, [inline])
  useEffect(() => {
    if (!inline) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || isEditableTarget(e.target)) return
      e.preventDefault()
      own.current?.focus()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [inline])
  const set = (el: HTMLInputElement | null) => {
    own.current = el
    if (typeof inputRef === 'function') inputRef(el)
    else if (inputRef) inputRef.current = el
  }
  return (
    <label
      className={cn(
        inline
          ? 'ml-auto flex items-center gap-1.5 text-[12px] text-muted max-md:hidden'
          : 'flex w-full items-center',
      )}
    >
      {inline && <Kbd>/</Kbd>}
      <input
        ref={set}
        type="search"
        aria-label="Filter cues"
        placeholder="filter"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          inline
            ? 'w-14 rounded-[5px] bg-transparent px-1 text-[12px] text-ink outline-none placeholder:text-muted focus:w-40 focus-visible:ring-2 focus-visible:ring-red'
            : 'h-12 w-full rounded-[12px] border-2 border-input bg-paper px-3.5 text-[16px] text-ink placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red',
          '[&::-webkit-search-cancel-button]:appearance-none',
        )}
      />
    </label>
  )
}
