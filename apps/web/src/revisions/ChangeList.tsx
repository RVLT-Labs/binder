import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Change, Hunk } from './compareModel'

/** What the change list can be showing: it is working, it has a message to give instead, or the changes. */
export type ChangeListState =
  | { kind: 'comparing' }
  | { kind: 'message'; role: 'status' | 'alert'; text: string }
  | { kind: 'diff'; removed: number; added: number; hunks: Hunk[] }

export interface ChangeListProps {
  docTitle: string
  /** The two versions as the heading writes them: "v1", "v2". */
  fromName: string
  toName: string
  state: ChangeListState
  /** The diff position of the line in view, or null. */
  active: number | null
  /** A line or a card was chosen: both sides go to it. */
  onChoose: (change: Change) => void
}

/**
 * The compare screen's change list (the mockup's panel body): "Libretto v1 → v2 / Changes · 3", a
 * card for each change that sits together in the text ("p.9–10 — 16 lines cut"), and under each
 * card its lines, so a single line can be chosen too. The chosen one is the card with the red bar.
 */
export function ChangeList({
  docTitle,
  fromName,
  toName,
  state,
  active,
  onChoose,
}: ChangeListProps) {
  return (
    <nav aria-label="Changes" className="compare-changes flex flex-col gap-2">
      <div className="px-1 pt-1 pb-1.5">
        <div className="t-over m-0">
          {docTitle} {fromName} → {toName}
        </div>
        <h2 className="t-title m-0 text-[18px]">
          Changes ·{' '}
          <span className="font-mono tabular-nums">
            {state.kind === 'diff' ? state.hunks.length : '–'}
          </span>
        </h2>
        {state.kind === 'diff' && (
          <p role="status" className="compare-summary m-0 mt-0.5 text-[12px] text-muted">
            {state.removed} removed, {state.added} added
          </p>
        )}
      </div>
      {state.kind === 'comparing' && (
        <p role="status" className="m-0 px-1 text-[13px] text-muted">
          Comparing…
        </p>
      )}
      {state.kind === 'message' && (
        <p role={state.role} className="m-0 px-1 text-[13px] text-muted">
          {state.text}
        </p>
      )}
      {state.kind === 'diff' &&
        (state.hunks.length === 0 ? (
          <p className="m-0 px-1 text-[13px] text-muted">No differences in the text.</p>
        ) : (
          <ol className="m-0 flex list-none flex-col gap-2 p-0">
            {state.hunks.map((hunk) => {
              const on = hunk.changes.some((c) => c.index === active)
              return (
                <li
                  key={hunk.firstIndex}
                  data-active={on || undefined}
                  className={cn(
                    'rounded-[10px] border-2 border-line py-2.5 pr-3 pl-3.5',
                    on && 'border-line-2 bg-card shadow-[inset_3px_0_0_var(--red),var(--sh-card)]',
                  )}
                >
                  <button
                    type="button"
                    className="grid w-full gap-0.5 rounded-[6px] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red max-md:min-h-11"
                    onClick={() => onChoose(hunk.changes[0])}
                  >
                    <span className="text-[13px] font-semibold text-ink">{hunk.title}</span>
                    <span className="text-[12px] text-muted">{hunk.meta}</span>
                  </button>
                  <ol className="m-0 mt-1.5 flex list-none flex-col gap-px p-0">
                    {hunk.changes.map((c) => (
                      <li key={c.index}>
                        <button
                          type="button"
                          className="compare-change flex min-h-7 w-full items-baseline gap-2 rounded-[6px] px-1.5 py-1 text-left text-[12px] text-ink-2 hover:bg-elev focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red aria-[current=true]:bg-elev aria-[current=true]:text-ink max-md:min-h-11 max-md:items-center"
                          data-op={c.op}
                          aria-current={active === c.index ? 'true' : undefined}
                          onClick={() => onChoose(c)}
                        >
                          <span
                            className={cn(
                              'compare-op font-mono font-bold',
                              c.op === 'removed' ? 'text-t-out' : 'text-ok',
                            )}
                            aria-hidden="true"
                          >
                            {c.op === 'removed' ? '−' : '+'}
                          </span>
                          <span className="sr-only">
                            {c.op === 'removed' ? 'Removed: ' : 'Added: '}
                          </span>
                          <span className="min-w-0 truncate">{c.text}</span>
                        </button>
                      </li>
                    ))}
                  </ol>
                </li>
              )
            })}
          </ol>
        ))}
    </nav>
  )
}

/**
 * "‹ Previous change" and "Next change ›" (the panel's foot): step through the changes by card.
 * `position` is the chosen card's place, or null when none is; `onStep` gets -1 or 1.
 */
export function ChangeSteps({
  count,
  position,
  onStep,
}: {
  count: number
  position: number | null
  onStep: (delta: -1 | 1) => void
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <Button
        type="button"
        variant="line"
        size="sm"
        disabled={count === 0 || position === 0}
        onClick={() => onStep(-1)}
      >
        <span aria-hidden>‹</span> Previous change
      </Button>
      <Button
        type="button"
        variant="line"
        size="sm"
        disabled={count === 0 || position === count - 1}
        onClick={() => onStep(1)}
      >
        Next change <span aria-hidden>›</span>
      </Button>
    </div>
  )
}
