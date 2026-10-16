import { Link } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import { useId } from 'react'
import { SectionHeading } from '@/components/SectionHeading'
import { buttonVariants } from '@/components/ui/button'
import { cn, focusRing } from '@/lib/utils'

export interface DuplicateNote {
  departmentId: string
  code: string
  /** Distinct numbers used more than once. */
  numbers: number
}

export interface NeedsYouProps {
  showId: string
  /** Cues and notes waiting for review after a revision, and the document to review them in. */
  review: { count: number; documentId: string } | null
  duplicates: readonly DuplicateNote[]
  /**
   * Uploads that could not be processed. The Scripts card lists only ready scripts, so a failure
   * is one of the things that need you, with the way to the Documents screen.
   */
  failed?: number
  /**
   * `aside` is the card of the right-hand column (desktop and tablet): an over-label inside it,
   * small buttons. `phone` is the phone's block (m-show): a section label above a padding-0 card
   * with 52 px rows. The overview renders one of each and shows the one that fits the width.
   */
  variant?: 'aside' | 'phone'
  className?: string
}

const mono = 'font-mono tabular-nums'
const ACTION = cn(buttonVariants({ variant: 'line', size: 'sm' }), 'shrink-0')

/**
 * What wants a decision on the show overview (DESIGN §8): the cues to review after a revision and
 * the departments with duplicate numbers, each with the one link that goes to it. It draws nothing
 * when there is nothing to do, so a quiet show has no empty box.
 */
export function NeedsYou({
  showId,
  review,
  duplicates,
  failed = 0,
  variant = 'aside',
  className,
}: NeedsYouProps) {
  const heading = useId()
  const reviewText = useId()
  if (!review && duplicates.length === 0 && failed === 0) return null
  const phone = variant === 'phone'
  const row = phone
    ? 'flex min-h-[52px] items-center justify-between gap-3 py-1 pr-2 pl-3.5 text-[14px] font-medium text-ink'
    : 'flex items-center justify-between gap-3 text-[13px] text-ink'
  const items = (
    <ul
      className={cn('m-0 list-none p-0', phone ? 'divide-y divide-line' : 'flex flex-col gap-1.5')}
    >
      {review && (
        <li className={row}>
          <span id={reviewText} className="min-w-0">
            <span className={mono}>{review.count}</span> {review.count === 1 ? 'cue' : 'cues'} to
            review after the revision
          </span>
          <Link
            to="/shows/$showId/docs/$docId"
            params={{ showId, docId: review.documentId }}
            search={{ review: true }}
            aria-describedby={reviewText}
            className={cn(ACTION, focusRing)}
          >
            Review
            <ChevronRight className="size-4 md:hidden" aria-hidden />
          </Link>
        </li>
      )}
      {duplicates.map((d) => (
        <DuplicateItem key={d.departmentId} showId={showId} note={d} className={row} />
      ))}
      {failed > 0 && <FailedItem showId={showId} count={failed} className={row} />}
    </ul>
  )
  if (phone) {
    return (
      <section aria-labelledby={heading} className={cn('flex flex-col gap-2.5', className)}>
        <SectionHeading id={heading}>Needs you</SectionHeading>
        <div className="overflow-hidden rounded-[var(--r)] border-2 border-line-2 bg-card shadow-card">
          {items}
        </div>
      </section>
    )
  }
  return (
    <section
      aria-labelledby={heading}
      className={cn(
        'rounded-[var(--r)] border-2 border-line-2 bg-card px-4 py-3.5 shadow-card',
        className,
      )}
    >
      <h2 id={heading} className="t-over mb-2">
        Needs you
      </h2>
      {items}
    </section>
  )
}

function DuplicateItem({
  showId,
  note,
  className,
}: {
  showId: string
  note: DuplicateNote
  className: string
}) {
  const text = useId()
  return (
    <li className={className}>
      <span id={text} className="min-w-0">
        {note.code} has <span className={mono}>{note.numbers}</span> duplicate{' '}
        {note.numbers === 1 ? 'number' : 'numbers'}
      </span>
      <Link
        to="/shows/$showId/cues"
        params={{ showId }}
        search={{ department: note.departmentId, duplicates: true }}
        aria-describedby={text}
        className={cn(ACTION, focusRing)}
      >
        Fix
        <ChevronRight className="size-4 md:hidden" aria-hidden />
      </Link>
    </li>
  )
}

function FailedItem({
  showId,
  count,
  className,
}: {
  showId: string
  count: number
  className: string
}) {
  const text = useId()
  return (
    <li className={className}>
      <span id={text} className="min-w-0">
        <span className={mono}>{count}</span> {count === 1 ? 'upload' : 'uploads'} couldn’t be
        processed
      </span>
      <Link
        to="/shows/$showId/docs"
        params={{ showId }}
        aria-describedby={text}
        className={cn(ACTION, focusRing)}
      >
        See
        <ChevronRight className="size-4 md:hidden" aria-hidden />
      </Link>
    </li>
  )
}
