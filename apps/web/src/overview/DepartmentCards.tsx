import { deptChrome } from '@binder/shared'
import { Link } from '@tanstack/react-router'
import { SectionHeading } from '@/components/SectionHeading'
import { cn, focusRing } from '@/lib/utils'

export interface DepartmentCardData {
  id: string
  code: string
  /** The department's stored colour (data, so the one place a hex is allowed). */
  colour: string | null
  /** Cues in the department. */
  count: number
  /** Distinct numbers used more than once. */
  duplicateNumbers: number
}

export interface DepartmentCardsProps {
  showId: string
  departments: readonly DepartmentCardData[]
  /** Whether to offer a card for adding a department (show owners). */
  canAdd: boolean
}

const CARD =
  'flex min-h-[88px] flex-col justify-between gap-2 rounded-[var(--r)] border-2 p-4 transition-[transform,box-shadow]'

/**
 * The show's cue lists by department (DESIGN §8): one card each with the code, the count in mono
 * and "N duplicates" or "clean". The cards are the links into the cue list; the list is a
 * navigation named "Cue lists".
 */
export function DepartmentCards({ showId, departments, canAdd }: DepartmentCardsProps) {
  return (
    <nav aria-label="Cue lists" className="flex flex-col gap-3">
      <SectionHeading>Cue lists by department</SectionHeading>
      <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-3 p-0">
        {departments.map((d) => {
          const dupes =
            d.duplicateNumbers === 0
              ? 'clean'
              : `${d.duplicateNumbers} ${d.duplicateNumbers === 1 ? 'duplicate' : 'duplicates'}`
          return (
            <li key={d.id} className="flex">
              <Link
                to="/shows/$showId/cues"
                params={{ showId }}
                search={{ department: d.id }}
                aria-label={`${d.code} cue list, ${d.count} ${d.count === 1 ? 'cue' : 'cues'}, ${dupes}`}
                className={cn(
                  CARD,
                  'w-full border-line-2 bg-card shadow-card hover:-translate-y-0.5 hover:shadow-hover',
                  focusRing,
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2 font-display text-[17px] font-extrabold text-ink">
                    <span
                      aria-hidden
                      className="size-2.5 shrink-0 rounded-[3px] bg-faint"
                      style={d.colour ? { background: deptChrome(d.colour) } : undefined}
                    />
                    <span className="truncate">{d.code}</span>
                  </span>
                  <span className="font-mono text-[22px] font-bold tabular-nums text-ink">
                    {d.count}
                  </span>
                </span>
                <span
                  className={cn(
                    'text-[13px]',
                    d.duplicateNumbers === 0 ? 'text-muted' : 'text-warn',
                  )}
                >
                  {dupes}
                </span>
              </Link>
            </li>
          )
        })}
        {canAdd && (
          <li className="flex">
            <Link
              to="/shows/$showId/settings"
              params={{ showId }}
              className={cn(
                CARD,
                'w-full items-center justify-center border-dashed border-line-2 text-[14px] font-semibold text-muted hover:text-ink',
                focusRing,
              )}
            >
              <span aria-hidden>+</span> Add department
            </Link>
          </li>
        )}
      </ul>
    </nav>
  )
}
