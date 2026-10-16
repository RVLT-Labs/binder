import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * The mockups' button (docs/superpowers/design/binder-ui-2026-10/_head.html `.btn`): a rounded
 * rectangle, never a pill. At 768 px and up it is 30 px high (26 for `sm`, 40 for `lg`) with radius
 * 10 (8, 10); below that it is the phone's 44 px (48 for `lg`) with radius 12. On a tablet the
 * visible button is the mockup's size and an invisible `after:` layer keeps a 44 px hit area.
 * Red is the primary, and a primary carries the sticker shadow; the outlined button is the
 * card-filled 2px outline. See DESIGN.md §0 (the mockups are the binding standard).
 */
const buttonVariants = cva(
  // states (§9.1): focus-visible ring on every variant; tactile press; disabled = greyed,
  // not-allowed cursor, no lift/shadow (clicks blocked by the `disabled` attr).
  // Every variant has a 2px border (transparent where it is not drawn) so heights never shift.
  "relative inline-flex items-center justify-center gap-1.5 whitespace-nowrap border-2 font-sans font-semibold transition-[transform,box-shadow,background-color,border-color,color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red focus-visible:ring-offset-2 focus-visible:ring-offset-paper disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none disabled:translate-x-0 disabled:translate-y-0 disabled:hover:translate-y-0 [&_svg]:size-4 [&_svg]:shrink-0 md:after:absolute md:after:inset-x-0 md:after:content-['']",
  {
    variants: {
      variant: {
        // primary action: red, 2px red border, the sticker shadow (hard drop plus top highlight)
        primary:
          'border-red bg-red text-primary-foreground shadow-sticker hover:-translate-y-px active:translate-x-[2px] active:translate-y-[2px] active:shadow-lit',
        // hero CTA only: primary + sanctioned red bloom (§8); bloom is the --sh-halo token
        halo: 'border-red bg-red text-primary-foreground shadow-[var(--sh-halo)] hover:-translate-y-px active:translate-y-[2px] active:shadow-[0_1px_0_var(--red-700)]',
        // the default button: card fill, 2px outline (--line-2 dark / --ink light, §9)
        line: 'border-border bg-card text-ink hover:border-ink-2 hover:bg-elev active:translate-y-px',
        // text only: ink-2, transparent border
        ghost: 'border-transparent bg-transparent text-ink-2 hover:text-ink active:opacity-80',
        // cream: for use on the full-red CTA block (fixed cream tokens, §3.6)
        cream:
          'border-transparent bg-[var(--cream)] text-[var(--cream-ink)] shadow-[var(--sh-cream)] hover:-translate-y-px active:translate-y-[2px] active:shadow-[var(--sh-cream-press)]',
      },
      size: {
        // Phone: 44 px. 768 and up: the mockup's heights, with a 44 px hit area from `after:`.
        sm: 'h-11 rounded-[12px] px-4 text-[14px] md:h-[26px] md:rounded-[8px] md:px-[9px] md:text-[12px] md:after:-inset-y-[9px]',
        default:
          'h-11 rounded-[12px] px-4 text-[14px] md:h-[30px] md:rounded-[10px] md:px-3 md:text-[13px] md:after:-inset-y-[7px]',
        lg: 'h-12 rounded-[12px] px-7 text-[16px] md:h-10 md:rounded-[10px] md:px-5 md:text-[14px] md:after:-inset-y-[2px]',
        icon: 'size-11 rounded-[12px]',
      },
    },
    compoundVariants: [
      // `.btn.ghost` has 10px of side padding
      { variant: 'ghost', size: ['sm', 'default', 'lg'], className: 'px-[10px] md:px-[10px]' },
    ],
    defaultVariants: { variant: 'primary', size: 'default' },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  /** Loading state (§9.1) — shows a spinner, keeps width, disables. */
  loading?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant, size, asChild = false, loading = false, disabled, children, ...props },
    ref,
  ) => {
    const classes = cn(buttonVariants({ variant, size, className }))
    // asChild defers rendering to a single child (Slot) — no spinner injection there.
    if (asChild) {
      return (
        <Slot className={classes} ref={ref} {...props}>
          {children}
        </Slot>
      )
    }
    return (
      <button
        className={classes}
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {/* loading: spinner replaces the label but the label keeps its width (no layout shift, §9.1) */}
        {loading && (
          <span aria-hidden className="absolute inset-0 grid place-items-center">
            <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          </span>
        )}
        <span className={cn('inline-flex items-center gap-1.5', loading && 'invisible')}>
          {children}
        </span>
      </button>
    )
  },
)
Button.displayName = 'Button'

export { Button, buttonVariants }
