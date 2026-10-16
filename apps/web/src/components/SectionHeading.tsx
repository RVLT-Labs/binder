import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** A section label with a rule running off to the right (the mockups' section divider). */
export function SectionHeading({
  children,
  id,
  className,
}: {
  children: ReactNode
  id?: string
  className?: string
}) {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <h2 id={id} className="text-[11px] font-semibold text-muted">
        {children}
      </h2>
      <span aria-hidden className="h-px flex-1 bg-line" />
    </div>
  )
}
