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
        'm-auto w-full max-w-[min(32rem,calc(100vw-32px))] rounded-[20px] border-2 border-line-2 bg-card p-6 text-ink shadow-stk backdrop:bg-scrim',
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

/** Right-aligned actions, 8px gap; stacked full-width on phones. */
function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'mt-6 flex flex-col gap-2 md:flex-row md:justify-end [&>*]:w-full md:[&>*]:w-auto',
        className,
      )}
      {...props}
    />
  )
}

export { DialogFooter, DialogHeader, DialogShell }
