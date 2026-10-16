import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type { IconComponent } from './icons'

/**
 * An empty list (the mockups' `.empty` on the states sheet): a card with an optional icon tile or
 * label, a plain heading, one line of what to do, an optional Kalam line (the only place Kalam
 * appears in a list, in `--ink-2` so it never reads as an alert) and an optional action.
 */
export function EmptyState({
  icon: Icon,
  label,
  heading,
  children,
  hand,
  action,
  className,
}: {
  /** An icon tile above the heading, for a list with no label of its own. */
  icon?: IconComponent
  /** Anything that names the list above the heading, such as a department's swatch and count. */
  label?: ReactNode
  heading: ReactNode
  /** The one line under the heading. */
  children?: ReactNode
  /** The Kalam line: personality, never instructions. */
  hand?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'empty-state flex flex-col items-start gap-2 rounded-[var(--r)] border-2 border-line-2 bg-card p-[18px] shadow-[var(--sh-card)]',
        className,
      )}
    >
      {Icon && (
        <span
          aria-hidden
          className="grid size-9 place-items-center rounded-[10px] border-2 border-line-2 bg-elev text-muted"
        >
          <Icon className="size-[18px]" />
        </span>
      )}
      {label}
      <p className="m-0 text-[15px] font-semibold text-ink">{heading}</p>
      {children && <p className="m-0 text-[13.5px] leading-[1.5] text-ink-2">{children}</p>}
      {hand && <p className="m-0 font-hand text-[18px] leading-[1.3] text-ink-2">{hand}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}
