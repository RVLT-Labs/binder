import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'

import { cn } from '@/lib/utils'

/** The actual button reserves a nonoverlapping 44px target in layout. Its pointer-inert
 * ::before draws Binder's compact rectangular face (26/30/40px on desktop). No enlarged
 * hit region extends into neighbours. The same contract applies to slotted links. */
const buttonVariants = cva(
  // states (§9.1): focus-visible ring on every variant; tactile press; disabled = greyed,
  // not-allowed cursor, no lift/shadow (clicks blocked by the `disabled` attr).
  // Every variant has a 2px border (transparent where it is not drawn) so heights never shift.
  "relative isolate inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 whitespace-nowrap border-2 font-sans font-semibold transition-[transform,box-shadow,background-color,border-color,color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red focus-visible:ring-offset-2 focus-visible:ring-offset-paper disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none disabled:translate-x-0 disabled:translate-y-0 disabled:hover:translate-y-0 [&_svg]:size-4 [&_svg]:shrink-0 border-transparent before:pointer-events-none before:absolute before:-inset-x-[2px] before:top-1/2 before:-z-10 before:-translate-y-1/2 before:rounded-[inherit] before:border-2 before:content-[''] disabled:before:shadow-none aria-disabled:before:shadow-none",
  {
    variants: {
      variant: {
        // primary action: red, 2px red border, the sticker shadow (hard drop plus top highlight)
        primary:
          'before:border-primary before:bg-primary text-primary-foreground before:shadow-sticker hover:-translate-y-px active:translate-x-[2px] active:translate-y-[2px] active:before:shadow-lit',
        // hero CTA only: primary + sanctioned red bloom (§8); bloom is the --sh-halo token
        halo: 'before:border-primary before:bg-primary text-primary-foreground before:shadow-[var(--sh-halo)] hover:-translate-y-px active:translate-y-[2px] active:before:shadow-[0_1px_0_var(--red-700)]',
        // the default button: card fill, 2px outline (--line-2 dark / --ink light, §9)
        line: 'before:border-border before:bg-card text-ink hover:before:border-ink-2 hover:before:bg-elev active:translate-y-px',
        // text only: ink-2, transparent border
        ghost:
          'before:border-transparent before:bg-transparent text-ink-2 hover:text-ink active:opacity-80',
        // cream: for use on the full-red CTA block (fixed cream tokens, §3.6)
        cream:
          'before:border-transparent before:bg-[var(--cream)] text-[var(--cream-ink)] before:shadow-[var(--sh-cream)] hover:-translate-y-px active:translate-y-[2px] active:before:shadow-[var(--sh-cream-press)]',
      },
      size: {
        // The target stays 44 px; ::before draws the compact face at 768 px and up.
        sm: 'h-11 before:h-11 rounded-[12px] px-4 text-[14px] md:before:h-[26px] md:rounded-[8px] md:px-[9px] md:text-[12px]',
        default:
          'h-11 before:h-11 rounded-[12px] px-4 text-[14px] md:before:h-[30px] md:rounded-[10px] md:px-3 md:text-[13px]',
        lg: 'h-12 before:h-12 rounded-[12px] px-7 text-[16px] md:before:h-10 md:rounded-[10px] md:px-5 md:text-[14px]',
        icon: 'size-11 before:h-11 rounded-[12px]',
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
    // Slot merges child handlers first. Replace activation handlers on the child itself while
    // blocked; a guard only on Slot would run after a child's action had already happened.
    if (asChild) {
      const child = React.Children.only(children) as React.ReactElement<
        React.HTMLAttributes<HTMLElement> & { disabled?: boolean }
      >
      const blocked = disabled || loading || child.props.disabled
      const stop = (event: React.SyntheticEvent) => {
        event.preventDefault()
        event.stopPropagation()
      }
      const guards = blocked
        ? {
            onClick: stop,
            onClickCapture: stop,
            onAuxClick: stop,
            onAuxClickCapture: stop,
            onTouchStart: stop,
            onTouchStartCapture: stop,
            onTouchEnd: stop,
            onTouchEndCapture: stop,
            onKeyPress: stop,
            onKeyPressCapture: stop,
            onDoubleClick: stop,
            onDoubleClickCapture: stop,
            onPointerDown: stop,
            onPointerDownCapture: stop,
            onPointerUp: stop,
            onPointerUpCapture: stop,
            onMouseDown: stop,
            onMouseDownCapture: stop,
            onMouseUp: stop,
            onMouseUpCapture: stop,
            onKeyDown: stop,
            onKeyDownCapture: stop,
            onKeyUp: stop,
            onKeyUpCapture: stop,
          }
        : {}
      return (
        <Slot
          className={cn(classes, blocked && 'cursor-not-allowed opacity-45 shadow-none')}
          ref={ref}
          {...props}
          {...guards}
        >
          {React.cloneElement(child, {
            ...guards,
            'aria-disabled': blocked || child.props['aria-disabled'],
            'aria-busy': loading || child.props['aria-busy'] || props['aria-busy'] || undefined,
            ...(blocked ? { tabIndex: -1 } : {}),
            ...(child.type === 'button' ? { disabled: blocked } : {}),
          })}
        </Slot>
      )
    }
    return (
      <button
        className={classes}
        ref={ref}
        {...props}
        disabled={disabled || loading}
        aria-busy={loading || props['aria-busy'] || undefined}
      >
        {/* loading: spinner replaces the label but the label keeps its width (no layout shift, §9.1) */}
        {loading && (
          <span aria-hidden className="absolute inset-0 grid place-items-center">
            <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          </span>
        )}
        <span className={cn('inline-flex items-center gap-1.5', loading && 'opacity-0')}>
          {children}
        </span>
      </button>
    )
  },
)
Button.displayName = 'Button'

export { Button, buttonVariants }
