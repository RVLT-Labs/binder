import { formatCueNumber } from '@binder/core'
import { deptChrome } from '@binder/shared'
import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/segmented'
import { openModal } from '@/lib/modalDialog'
import { cn } from '@/lib/utils'
import { type MatchableCue, type MatchableDepartment, matchCues } from '../palette/matchCues'

export interface KeypadCue extends MatchableCue {
  id: string
  label: string
}

export interface KeypadDepartment extends MatchableDepartment {
  /** The stored colour, from data; null when the department has none. */
  colour: string | null
}

/** Where Go lands: a cue, or a page (zero-based). */
export type GoTarget = { kind: 'cue'; cue: KeypadCue } | { kind: 'page'; index: number }

export interface RecentChip {
  /** `LX 12`, `p.14`: the chip as it reads. */
  label: string
  target: GoTarget
}

export interface GoToKeypadProps {
  /** Which half is showing when it opens; Cue by default. */
  mode?: 'cue' | 'page'
  cues: readonly KeypadCue[]
  departments: readonly KeypadDepartment[]
  pageCount: number
  /** This session's last few jumps that still exist on the open document. */
  recent?: readonly RecentChip[]
  onGo: (target: GoTarget) => void
  /** Cancel, Escape, or a tap on the dimmed page. */
  onCancel: () => void
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0'] as const

/** The most a cue number takes: four digits of major, a point and two of minor. */
function canAppend(text: string, key: string, mode: 'cue' | 'page'): boolean {
  if (mode === 'page') return /^\d$/.test(key) && text.length < 4
  if (key === '.') return text !== '' && !text.includes('.')
  if (!/^\d$/.test(key)) return false
  const [major, minor] = text.split('.')
  return text.includes('.') ? (minor ?? '').length < 2 : major.length < 4
}

/** What a typed cue number points at: the cue with exactly that number, else the first that starts with it. */
function findCue(
  text: string,
  cues: readonly KeypadCue[],
  departments: readonly KeypadDepartment[],
): KeypadCue | null {
  const found = matchCues(text, cues, departments)
  const formats = new Map(departments.map((d) => [d.id, d.numberFormat]))
  const exact = found.find(
    (c) => formatCueNumber(c.major, c.minor, formats.get(c.departmentId) ?? 'decimal') === text,
  )
  return exact ?? found[0] ?? null
}

/** The key caps' look: a lifted fill with a hard shadow, mono digits (the mockup's `.ov-key`). */
const KEY =
  'grid h-16 place-items-center rounded-[16px] border-2 border-line-2 bg-elev font-mono text-[28px] tabular-nums text-ink shadow-card transition-[transform,box-shadow] hover:border-ink-2 active:translate-y-[3px] active:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red disabled:cursor-not-allowed disabled:opacity-45'

/**
 * Go to…, Calling mode's one overlay (DESIGN §9): a cue number or a page on a keypad, with the cue
 * it will land on shown as you type. A native modal dialog, so the markup keys stay out of it; the
 * page behind is dimmed, not hidden. Mount it to open it; `onCancel` (and `onGo`, which closes it
 * too) say it is done, and the caller puts focus back.
 */
export function GoToKeypad({
  mode: initialMode = 'cue',
  cues,
  departments,
  pageCount,
  recent = [],
  onGo,
  onCancel,
}: GoToKeypadProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const readout = useRef<HTMLOutputElement>(null)
  const [mode, setMode] = useState(initialMode)
  const [text, setText] = useState('')
  /** Set once Go or Cancel has answered, so the dialog's own (asynchronous) `close` event is not a second answer. */
  const settled = useRef(false)

  useEffect(() => {
    if (!dialog.current) return
    openModal(dialog.current)
    // Typed digits and Enter land on the readout; Tab still reaches the keys.
    readout.current?.focus()
  }, [])

  const departmentById = new Map(departments.map((d) => [d.id, d]))
  const cue = mode === 'cue' ? findCue(text, cues, departments) : null
  const page = mode === 'page' && text !== '' ? Number(text) : null
  const pageOk = page !== null && page >= 1 && page <= pageCount
  const target: GoTarget | null =
    mode === 'cue'
      ? cue
        ? { kind: 'cue', cue }
        : null
      : pageOk
        ? { kind: 'page', index: page - 1 }
        : null

  function press(key: string) {
    if (canAppend(text, key, mode)) setText(text + key)
  }

  function go(to: GoTarget | null = target) {
    if (!to || settled.current) return
    settled.current = true
    dialog.current?.close()
    onGo(to)
  }

  function cancel() {
    if (settled.current) return
    settled.current = true
    dialog.current?.close()
    onCancel()
  }

  function onKeyDown(e: KeyboardEvent<HTMLDialogElement>) {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (/^\d$/.test(e.key) || e.key === '.') {
      e.preventDefault()
      press(e.key)
    } else if (e.key === 'Backspace') {
      e.preventDefault()
      setText(text.slice(0, -1))
    } else if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault()
      go()
    }
  }

  const code = (c: KeypadCue) => {
    const d = departmentById.get(c.departmentId)
    return `${d?.code ?? ''} ${formatCueNumber(c.major, c.minor, d?.numberFormat ?? 'decimal')}`.trim()
  }

  return (
    <dialog
      ref={dialog}
      aria-label="Go to"
      onKeyDown={onKeyDown}
      // Escape (and anything else that closes a native dialog) ends here.
      onClose={cancel}
      onClick={(e) => {
        // The dialog has no padding of its own: a tap that lands on it is a tap on the dimmed page.
        if (e.target === e.currentTarget) cancel()
      }}
      className={cn(
        // The strip's holder does not take the pointer; the keypad, inside it, does.
        'pointer-events-auto m-auto max-h-[calc(100dvh-24px)] w-[min(384px,calc(100vw-24px))] overflow-y-auto rounded-[20px] border-2 border-line-2 bg-card p-0 text-ink shadow-dialog backdrop:bg-scrim-strong',
      )}
    >
      <div className="flex flex-col gap-3.5 p-[22px]">
        <Segmented
          aria-label="Go to"
          value={mode}
          onValueChange={(next) => {
            setMode(next as 'cue' | 'page')
            setText('')
          }}
          options={[
            { value: 'cue', label: 'Cue' },
            { value: 'page', label: 'Page' },
          ]}
          className="flex w-full rounded-[12px] md:rounded-[12px]"
          itemClassName="flex-1 md:h-11 md:text-[16px] md:font-bold md:px-3 font-bold text-[16px] data-[state=on]:shadow-[inset_0_-3px_0_var(--red)]"
        />
        <div className="flex h-[76px] items-center rounded-[14px] border-2 border-line-2 bg-paper px-[18px]">
          <output
            ref={readout}
            // The readout is where focus starts, so typed digits and Enter land somewhere; Tab goes on to the keys.
            tabIndex={-1}
            aria-label={mode === 'cue' ? 'Cue number' : 'Page number'}
            className="font-mono text-[40px] leading-none tabular-nums text-ink outline-none"
          >
            {text}
          </output>
          <span aria-hidden className="ml-[3px] h-[42px] w-[3px] bg-ink" />
        </div>
        <p
          aria-live="polite"
          className="m-0 flex h-[22px] items-center justify-center gap-2 whitespace-nowrap text-[15px] text-ink-2"
        >
          {mode === 'cue' && cue ? (
            <>
              <span
                className="font-mono text-[16px] font-semibold tabular-nums"
                style={{
                  color: departmentById.get(cue.departmentId)?.colour
                    ? deptChrome(departmentById.get(cue.departmentId)?.colour ?? '')
                    : undefined,
                }}
              >
                {code(cue)}
              </span>{' '}
              {cue.label && (
                <>
                  <span className="text-faint">·</span>{' '}
                  <span className="min-w-0 truncate">{cue.label}</span>{' '}
                </>
              )}
              <span className="text-faint">·</span>{' '}
              <span className="font-mono tabular-nums text-muted">
                p.{(cue.anchor?.pageIndex ?? 0) + 1}
              </span>
            </>
          ) : mode === 'page' && pageOk ? (
            <>
              <span className="font-mono text-[16px] font-semibold tabular-nums">Page {page}</span>{' '}
              <span className="text-faint">·</span>{' '}
              <span className="font-mono tabular-nums text-muted">of {pageCount}</span>
            </>
          ) : text === '' ? (
            <span className="text-muted">
              {mode === 'cue' ? 'Type a cue number' : 'Type a page number'}
            </span>
          ) : (
            <span className="text-muted">
              {mode === 'cue'
                ? `No cue ${text} on this script`
                : `No page ${text} (1 to ${pageCount})`}
            </span>
          )}
        </p>
        <div className="grid grid-cols-3 gap-2.5">
          {KEYS.map((key) => (
            <button
              key={key}
              type="button"
              className={KEY}
              aria-label={key === '.' ? 'Point' : undefined}
              disabled={key === '.' && mode === 'page'}
              onClick={() => press(key)}
            >
              {key}
            </button>
          ))}
          <button
            type="button"
            aria-label="Backspace"
            className={cn(KEY, 'bg-paper-2 text-ink-2')}
            onClick={() => setText(text.slice(0, -1))}
          >
            ⌫
          </button>
        </div>
        <div className="flex gap-2.5">
          <Button
            type="button"
            variant="ghost"
            className="h-14 w-28 flex-none rounded-[14px] text-[18px] font-bold md:h-14 md:rounded-[14px] md:text-[18px] md:after:inset-y-0"
            onClick={cancel}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="h-14 flex-1 rounded-[14px] text-[18px] font-bold md:h-14 md:rounded-[14px] md:text-[18px] md:after:inset-y-0"
            disabled={!target}
            onClick={() => go()}
          >
            Go
          </Button>
        </div>
        {recent.length > 0 && (
          <div>
            <div className="mb-1.5 text-[12px] font-semibold text-muted">Recent</div>
            <div className="flex flex-wrap gap-2.5">
              {recent.map((chip) => (
                <button
                  key={chip.label}
                  type="button"
                  className="inline-flex h-11 items-center rounded-full border-2 border-line-2 bg-paper-2 px-3.5 font-mono text-[15px] tabular-nums text-ink hover:border-ink-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red md:h-10"
                  onClick={() => go(chip.target)}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </dialog>
  )
}
