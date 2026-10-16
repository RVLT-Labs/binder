import { COLOUR_RE, DEPARTMENT_COLOUR_PRESETS, deptChrome, isTooCloseToRed } from '@binder/shared'
import { useId, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn, focusRing } from '@/lib/utils'

export const RED_MESSAGE = "Red is kept for Binder's own alerts. Pick another colour."
export const INVALID_MESSAGE = 'Use a colour like #2F6BD6.'

/** A hex colour still being typed: a `#` and up to five digits is not wrong yet. */
const STILL_TYPING = /^#[0-9A-Fa-f]{0,5}$/

/**
 * The mockups' colour swatch button (`.ac-swbtn`, 44 px on a phone): the department's colour on
 * dark chrome, opening a small popover with the presets (radio buttons) and a custom colour field.
 * A custom colour is checked as a colour first (a malformed one would otherwise slip past the red
 * check) and then against the red Binder keeps for its own alerts; `onChange` only hears about a
 * colour that passes both.
 */
export function ColourField({
  label,
  value,
  onChange,
  className,
}: {
  /** The button's accessible name, e.g. "LX colour". */
  label: string
  value: string
  onChange: (colour: string) => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const shown = COLOUR_RE.test(value) ? deptChrome(value) : 'var(--faint)'
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            'grid size-11 shrink-0 place-items-center rounded-[12px] border-2 border-line-2 bg-paper md:h-6 md:w-6 md:rounded-[7px]',
            "md:relative md:after:absolute md:after:-inset-2.5 md:after:content-['']",
            focusRing,
            className,
          )}
        >
          <i
            aria-hidden
            className="block size-4 rounded-[5px] md:size-3 md:rounded-[4px]"
            style={{ background: shown }}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-64 flex-col gap-3 p-3">
        <Choices label={label} value={value} onChange={onChange} close={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  )
}

function Choices({
  label,
  value,
  onChange,
  close,
}: {
  label: string
  value: string
  onChange: (colour: string) => void
  close: () => void
}) {
  const name = useId()
  const [draft, setDraft] = useState(value)
  const [error, setError] = useState<string | null>(null)

  /** Validates `raw`; true when it was handed to `onChange`. `final` is blur or Enter. */
  function check(raw: string, final: boolean): boolean {
    const colour = raw.trim().toUpperCase()
    if (!COLOUR_RE.test(colour)) {
      setError(final || !STILL_TYPING.test(colour) ? INVALID_MESSAGE : null)
      return false
    }
    if (isTooCloseToRed(colour)) {
      setError(RED_MESSAGE)
      return false
    }
    setError(null)
    onChange(colour)
    return true
  }

  return (
    <>
      <div role="presentation" className="flex flex-wrap gap-2">
        {DEPARTMENT_COLOUR_PRESETS.map((p) => (
          <label key={p.code} className="relative block size-9 cursor-pointer md:size-7">
            <input
              type="radio"
              name={name}
              aria-label={`${p.code} preset`}
              checked={value.toUpperCase() === p.colour}
              onChange={() => {
                setDraft(p.colour)
                setError(null)
                onChange(p.colour)
                close()
              }}
              className="peer absolute inset-0 m-0 size-full cursor-pointer appearance-none rounded-[8px] border-2 border-line-2 checked:border-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red"
            />
            <i
              aria-hidden
              className="pointer-events-none absolute inset-1.5 rounded-[4px]"
              style={{ background: deptChrome(p.colour) }}
            />
          </label>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Input
          aria-label="Custom colour"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${name}-err` : undefined}
          value={draft}
          maxLength={9}
          spellCheck={false}
          autoCapitalize="characters"
          className="flex-1 font-mono"
          onChange={(e) => {
            setDraft(e.target.value)
            check(e.target.value, false)
          }}
          onBlur={(e) => check(e.target.value, true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              if (check(e.currentTarget.value, true)) close()
            }
          }}
        />
        <input
          type="color"
          aria-label={`${label}: pick any colour`}
          value={COLOUR_RE.test(draft) ? draft.toLowerCase() : '#000000'}
          onChange={(e) => {
            setDraft(e.target.value.toUpperCase())
            check(e.target.value, true)
          }}
          className="size-11 shrink-0 cursor-pointer rounded-[10px] border-2 border-line-2 bg-paper p-0.5 md:size-[30px]"
        />
      </div>
      {error && (
        <p id={`${name}-err`} role="alert" className="m-0 text-[12px] text-ink-2">
          {error}
        </p>
      )}
    </>
  )
}
