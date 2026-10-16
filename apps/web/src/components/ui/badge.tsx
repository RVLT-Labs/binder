import { cva, type VariantProps } from 'class-variance-authority'
import type * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * RVLT Flow status badge — labelled soft-fill pill. Status is encoded by colour
 * AND a text label, never colour-only (DESIGN.md §3.3). Always render the label.
 */
const badgeVariants = cva(
  // The mockups' `.pill`: 20 px high, 8 px side padding, 5 px gap, 11 px / 600.
  'inline-flex items-center gap-[5px] rounded-full font-sans font-semibold text-[11px] leading-none',
  {
    variants: {
      size: {
        default: 'h-5 px-2',
        // the inline flag ("4 to review") is 18 px
        sm: 'h-[18px] px-2',
      },
      status: {
        ok: 'text-ok bg-ok-soft', // available / ready / pass
        warn: 'text-warn bg-warn-soft', // check / due / warning
        overbooked: 'text-t-out bg-out-soft', // overbooked / short / error
        repair: 'text-rep bg-rep-soft', // in repair / neutral
        // the mockups' `rep` pill: warm grey on a 14 % grey fill (Archived, Processing)
        neutral: 'text-rep bg-rep-soft',
        // #989 — mirrors status-colors.ts's `info`/`primary` ColorIntent pills
        // (`intentStyles.info.pill` / `.primary.pill`) so a quote's SENT/ACCEPTED
        // state renders in the SAME solid-red-is-live vocabulary DESIGN.md defines,
        // instead of borrowing the unrelated ok/warn/overbooked set.
        info: 'text-blue bg-blue-soft', // sent / in-progress-but-not-live
        primary: 'text-white bg-red', // live/active/in-use — DESIGN.md's solid red
      },
    },
    defaultVariants: { status: 'neutral', size: 'default' },
  },
)

function Badge({
  className,
  status,
  size,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ status, size, className }))} {...props} />
}

export { Badge, badgeVariants }
