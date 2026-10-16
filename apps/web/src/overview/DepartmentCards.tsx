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
  /** Codes of the default departments the show does not have: the add card lists them ("+ SM, VID"). */
  missing?: readonly string[]
}

// Mockup `.card` with padding 12 14 (phone: 10 14, at least 62 px tall).
const CARD =
  'flex flex-col justify-between rounded-[var(--r)] border-2 px-3.5 py-3 transition-[transform,box-shadow] max-md:min-h-[62px] max-md:py-2.5'

/**
 * The show's cue lists by department (DESIGN §8): one card each with the code, the count in mono
 * and "N duplicates" or "clean". The cards are the links into the cue list; the list is a
 * navigation named "Cue lists".
 */
export function DepartmentCards({
  showId,
  departments,
  canAdd,
  missing = [],
}: DepartmentCardsProps) {
  return (
    <nav aria-label="Cue lists" className="flex flex-col gap-2.5">
      <SectionHeading>Cue lists by department</SectionHeading>
      <ul className="m-0 grid list-none grid-cols-2 gap-2.5 p-0 md:grid-cols-4">
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
                  <span className="flex min-w-0 items-center gap-1.5 font-sans text-[13.5px] font-semibold text-ink">
                    <span
                      aria-hidden
                      className="size-2.5 shrink-0 rounded-[3px] bg-faint"
                      style={d.colour ? { background: deptChrome(d.colour) } : undefined}
                    />
                    <span className="truncate">{d.code}</span>
                  </span>
                  <span className="font-mono text-[18px] font-semibold tabular-nums text-ink md:text-[12px] md:font-normal md:text-muted">
                    {d.count}
                  </span>
                </span>
                <span className="text-[12px] text-muted md:mt-1.5">{dupes}</span>
              </Link>
            </li>
          )
        })}
        {canAdd && (
          <li className="flex">
            <Link
              to="/shows/$showId/settings"
              params={{ showId }}
              aria-label="Add department"
              className={cn(
                CARD,
                // `.ghost-card`: dashed, centred; 12.5 px at 768+, 14 px / 600 on the phone
                'w-full items-center justify-center border-dashed border-line-2 text-[14px] font-semibold text-muted hover:text-ink md:text-[12.5px] md:font-normal',
                focusRing,
              )}
            >
              <span aria-hidden className="md:hidden">
                + add
              </span>
              <span aria-hidden className="max-md:hidden">
                {missing.length > 0 ? `+ ${missing.join(', ')}` : '+ Add department'}
              </span>
            </Link>
          </li>
        )}
      </ul>
    </nav>
  )
}
