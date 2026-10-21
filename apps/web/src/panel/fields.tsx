import type { ReactNode, SelectHTMLAttributes } from 'react'
import { ChevronDownIcon } from '@/components/icons'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

/** The mockups' `.field`: a 11 px / 600 label over its control, 3 px apart. */
export function Field({
  label,
  htmlFor,
  className,
  children,
}: {
  label: string
  htmlFor?: string
  className?: string
  children: ReactNode
}) {
  return (
    <div className={cn('grid gap-[3px]', className)}>
      <Label htmlFor={htmlFor} className="leading-[1.45]">
        {label}
      </Label>
      {children}
    </div>
  )
}

/** The shared look of a native select drawn as the mockup's `.field .in`: 2 px outline on the paper ground. */
export function SelectField({
  className,
  children,
  swatch,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & {
  /** A department's colour: drawn at the left of the value, as the mockup's Layer field does. */
  swatch?: string
}) {
  return (
    <div className="relative">
      {swatch && (
        <Swatch
          colour={swatch}
          className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 md:left-[9px]"
        />
      )}
      <select
        {...props}
        className={cn(
          'h-12 min-h-11 min-w-11 w-full appearance-none rounded-[12px] border-2 border-input bg-paper pr-8 pl-3.5 text-[16px] text-ink',
          'md:h-[30px] md:rounded-[9px] md:pr-7 md:pl-[9px] md:text-[13px] md:max-[1024px]:h-10 md:max-[1024px]:text-[14px]',
          swatch && 'pl-9 font-semibold md:pl-7',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red focus-visible:ring-offset-2 focus-visible:ring-offset-paper',
          'disabled:cursor-not-allowed disabled:opacity-45',
          className,
        )}
      >
        {children}
      </select>
      <ChevronDownIcon
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-muted"
      />
    </div>
  )
}

/** A line of explanation under or between fields: 12 px muted. */
export function Note({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('m-0 text-[12.5px] leading-snug text-muted', className)} {...props} />
}

/** A field's error line, in the red-on-soft the form errors use elsewhere. */
export function FieldError({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      role="alert"
      className={cn('m-0 text-[12.5px] leading-snug text-t-out', className)}
      {...props}
    />
  )
}

/** The mockups' `.section-label`: 11 px / 600 muted with a rule after it. */
export const SECTION_LABEL =
  'm-0 flex items-center gap-3 font-sans text-[11px] font-semibold text-muted after:h-px after:flex-1 after:bg-line after:content-[""]'

export function SectionLabel({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn(SECTION_LABEL, className)} {...props}>
      {children}
    </div>
  )
}

/** A department or layer swatch: 10 px, radius 3, the colour from data. */
export function Swatch({ colour, className }: { colour: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('inline-block size-2.5 shrink-0 rounded-[3px]', className)}
      style={{ background: colour }}
    />
  )
}

const STATUS = {
  ok: { status: 'ok', text: 'ok' },
  approximate: { status: 'neutral', text: 'approximate' },
  unresolved: { status: 'overbooked', text: 'unresolved' },
} as const

/** A cue's anchor state as the mockup's pill: ok with its dot, approximate in grey, unresolved in red. */
export function StatusPill({
  status,
  dot = false,
  className,
}: {
  status: string | null | undefined
  dot?: boolean
  className?: string
}) {
  const s = STATUS[status === 'approximate' || status === 'unresolved' ? status : 'ok']
  return (
    <Badge status={s.status} className={className} data-status={status ?? 'ok'}>
      {dot && <span aria-hidden className="size-1.5 rounded-full bg-current" />}
      {s.text}
    </Badge>
  )
}
