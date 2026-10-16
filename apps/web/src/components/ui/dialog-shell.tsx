import * as React from 'react'

import { cn } from '@/lib/utils'

export interface DialogShellProps
  extends Omit<React.DialogHTMLAttributes<HTMLDialogElement>, 'aria-labelledby'> {
  /** id of the element (usually DialogHeader) that names the dialog. */
  labelledBy: string
}

/**
 * Shared look for Binder's native <dialog>s. Callers keep the ref and call `showModal()`.
 * Native dialogs are display:none until open, so the layout classes only apply when `open`.
 */
const DialogShell = React.forwardRef<HTMLDialogElement, DialogShellProps>(
  ({ labelledBy, className, children, ...props }, ref) => (
    <dialog
      ref={ref}
      aria-labelledby={labelledBy}
      className={cn(
        'm-auto w-full max-w-[min(32rem,calc(100vw-32px))] rounded-[20px] border-2 border-line-2 bg-card p-6 text-ink shadow-dialog backdrop:bg-scrim',
        className,
      )}
      {...props}
    >
      {children}
    </dialog>
  ),
)
DialogShell.displayName = 'DialogShell'

/** Title slot: `id` is what the dialog's `aria-labelledby` points at. */
function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      className={cn(
        'mb-4 font-display text-[20px] font-extrabold leading-tight text-ink',
        className,
      )}
      {...props}
    />
  )
}

/**
 * Right-aligned actions, stacked full-width on phones. `divided` draws the rule above them that
 * the print sheet's footer has (`.dx-sh-foot`); the confirm and upload dialogs have none in the
 * mockups. For the wizard's full-bleed footer bar (a `paper-2` bar with a top rule) use `DialogFooterBar`.
 */
function DialogFooter({
  className,
  divided = false,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { divided?: boolean }) {
  return (
    <div
      className={cn(
        'mt-6 flex flex-col gap-2 md:flex-row md:justify-end [&>*]:w-full md:[&>*]:w-auto',
        divided && 'border-t border-line pt-3.5',
        className,
      )}
      {...props}
    />
  )
}

/**
 * The new-show wizard's footer (`.ac-mfoot`): a full-width `paper-2` bar with a top rule, padding
 * 16 30, the actions in a row. Put the dialog's own padding at zero and the body above it.
 */
function DialogFooterBar({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex items-center gap-3.5 border-t border-line bg-paper-2 px-5 py-4 md:px-[30px]',
        className,
      )}
      {...props}
    />
  )
}

export { DialogFooter, DialogFooterBar, DialogHeader, DialogShell }
