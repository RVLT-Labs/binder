import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** The next cue the strip announces, on the active department. */
export interface StripNext {
  /** The department's code: `LX`. */
  department: string
  /** The department's stored colour, from data; null when it has none. */
  colour: string | null
  /** The formatted number: `12`, `2.20`. */
  number: string
  label: string
}

export interface CallingStripProps {
  /** One-based page in view, and the page count. */
  page: number
  pages: number
  /** The next cue on the active department, or null when there is none left (or no department). */
  next: StripNext | null
  /** The active department's code, for the line that says there is nothing left. */
  departmentCode?: string
  onPrev: () => void
  onNext: () => void
  onGoTo: () => void
  onExit: () => void
  goToRef?: React.Ref<HTMLButtonElement>
  className?: string
}

/** ‹ and ›: the mockup's ghost button with a 44 px hit area on every size. */
const TURN = 'min-w-11 px-2.5 text-[20px] leading-none md:px-[10px] md:text-[16px]'

/**
 * The floating strip at the foot of Calling mode (DESIGN §8): page ‹ n / N ›, the next cue on the
 * active department (swatch, code, mono number, label), Go to… and Exit. One row on a tablet; on a
 * phone two (the page turn and Go to… above, the next cue and Exit below), every target 44 px.
 */
export function CallingStrip({
  page,
  pages,
  next,
  departmentCode,
  onPrev,
  onNext,
  onGoTo,
  onExit,
  goToRef,
  className,
}: CallingStripProps) {
  const turn = (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label="Previous page"
        className={TURN}
        disabled={page <= 1}
        onClick={onPrev}
      >
        ‹
      </Button>
      <span className="font-mono text-[15px] tabular-nums text-ink md:text-[14px]">
        p.{page} <span className="text-muted">/ {pages}</span>
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label="Next page"
        className={TURN}
        disabled={page >= pages}
        onClick={onNext}
      >
        ›
      </Button>
    </>
  )
  const nextCueLine = next ? (
    <>
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-semibold text-ink">
        <span
          aria-hidden
          className="size-2.5 shrink-0 rounded-[3px]"
          style={{ background: next.colour ?? undefined }}
        />
        Next from page top {next.department}
      </span>{' '}
      <span className="font-mono text-[14px] font-semibold tabular-nums text-ink">
        {next.number}
      </span>{' '}
      {next.label && (
        <span className="min-w-0 max-w-[26ch] truncate text-[12px] text-muted">{next.label}</span>
      )}
    </>
  ) : (
    <span className="whitespace-nowrap text-[12px] text-muted">
      {departmentCode ? `No more ${departmentCode} cues` : 'No cues to call'}
    </span>
  )
  return (
    <section
      aria-label="Calling"
      className={cn(
        'pointer-events-auto flex flex-wrap items-center border-2 border-line-2 bg-card/92 shadow-card backdrop-blur-[8px]',
        'gap-x-2 gap-y-2 rounded-[16px] px-3 py-2.5 md:flex-nowrap md:gap-2.5 md:px-2.5 md:py-2',
        className,
      )}
    >
      <div className="flex items-center gap-2 max-md:order-1">{turn}</div>
      <span aria-hidden className="hidden h-[18px] w-px bg-line md:block" />
      <div className="flex min-w-0 items-center gap-1.5 max-md:order-4 max-md:flex-1">
        {nextCueLine}
      </div>
      <span aria-hidden className="hidden h-[18px] w-px bg-line md:block" />
      <Button
        ref={goToRef}
        type="button"
        variant="line"
        size="sm"
        className="max-md:order-2 max-md:ml-auto max-md:before:bg-elev max-md:px-[18px]"
        onClick={onGoTo}
      >
        Go to…
      </Button>
      <Button type="button" variant="ghost" size="sm" className="max-md:order-5" onClick={onExit}>
        Exit
      </Button>
      <span aria-hidden className="h-0 basis-full max-md:order-3 md:hidden" />
    </section>
  )
}
