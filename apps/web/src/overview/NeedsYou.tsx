import { Link } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import { useId } from 'react'
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
}

const mono = 'font-mono tabular-nums'
const ACTION = cn(buttonVariants({ variant: 'line', size: 'sm' }), 'shrink-0')

/**
 * What wants a decision on the show overview (DESIGN §8): the cues to review after a revision and
 * the departments with duplicate numbers, each with the one link that goes to it. It draws nothing
 * when there is nothing to do, so a quiet show has no empty box.
 */
export function NeedsYou({ showId, review, duplicates }: NeedsYouProps) {
  const heading = useId()
  const reviewText = useId()
  if (!review && duplicates.length === 0) return null
  return (
    <section
      aria-labelledby={heading}
      className="rounded-[20px] border-2 border-line-2 bg-card p-4 shadow-card"
    >
      <h2 id={heading} className="mb-1 text-[12px] font-bold text-muted">
        Needs you
      </h2>
      <ul className="m-0 list-none divide-y divide-line p-0">
        {review && (
          <li className="flex items-center justify-between gap-3 py-2.5 text-[14px] text-ink">
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
          <DuplicateItem key={d.departmentId} showId={showId} note={d} />
        ))}
      </ul>
    </section>
  )
}

function DuplicateItem({ showId, note }: { showId: string; note: DuplicateNote }) {
  const text = useId()
  return (
    <li className="flex items-center justify-between gap-3 py-2.5 text-[14px] text-ink">
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
