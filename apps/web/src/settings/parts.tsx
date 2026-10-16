import type { ReactNode, SelectHTMLAttributes } from 'react'
import { ChevronDownIcon } from '@/components/icons'
import { cn } from '@/lib/utils'

/** The mockups' `.card`: radius 14, a 2px outline, the card shadow. */
export const CARD = 'rounded-[var(--r)] border-2 border-line-2 bg-card shadow-card'

/** The dashed "add" row (`.ac-addrow`). */
export const ADD_ROW =
  'rounded-[var(--r)] border-2 border-dashed border-line-2 px-3 py-2.5 max-md:p-3.5'

/** A field's label (`.field label`): 11 px, 600, muted in the add rows. */
export const FIELD_LABEL = 'text-[11px] font-semibold text-muted'

/** A labelled control (`.field`). */
export function Field({
  label,
  className,
  children,
}: {
  label: string
  className?: string
  children: ReactNode
}) {
  return (
    <div className={cn('grid gap-[3px]', className)}>
      <span className={FIELD_LABEL}>{label}</span>
      {children}
    </div>
  )
}

/**
 * A native select drawn as the mockups' select field (`.in.ac-sel`): the paper ground, a 2px outline,
 * a chevron on the right. Native, so the phone gets its own picker.
 */
export function SelectBox({
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <div className={cn('relative', className)}>
      <select
        {...props}
        className={cn(
          'h-12 w-full appearance-none rounded-[12px] border-2 border-input bg-paper pr-8 pl-3 text-[16px] font-semibold text-ink-2',
          'md:h-7 md:rounded-[9px] md:pr-7 md:pl-[9px] md:text-[13px]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red focus-visible:ring-offset-2 focus-visible:ring-offset-paper',
          'disabled:cursor-not-allowed disabled:opacity-45',
        )}
      >
        {children}
      </select>
      <ChevronDownIcon
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-muted"
      />
    </div>
  )
}
