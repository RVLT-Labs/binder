import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { DialogFooter, DialogHeader, DialogShell } from '@/components/ui/dialog-shell'
import { closeModal, openModal } from '@/lib/modalDialog'
import type { ConfirmFn } from './types'

/**
 * An in-page yes/no question, in place of `window.confirm`. Render `dialog` somewhere in the tree
 * and `await confirm(message)`: it resolves true on the confirm button and false on the cancel
 * button or Escape. The states sheet's destructive confirm calls the cancel button "Keep": pass
 * `cancelLabel` where what the question puts at risk is something the person has (a member, an
 * upload), and leave "Cancel" where it only asks whether to go on.
 */
export function useConfirm(
  title: string,
  confirmLabel: string,
  cancelLabel = 'Cancel',
): { confirm: ConfirmFn; dialog: ReactNode } {
  const ref = useRef<HTMLDialogElement>(null)
  const resolver = useRef<((ok: boolean) => void) | null>(null)
  // What had focus when the question was asked: where focus goes back to once it is answered.
  const opener = useRef<HTMLElement | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const titleId = useId()

  const settle = useCallback((ok: boolean) => {
    // Close the dialog itself, then hand focus back: unmounting an open modal does neither.
    closeModal(ref.current, opener.current)
    resolver.current?.(ok)
    resolver.current = null
    setMessage(null)
  }, [])

  const confirm = useCallback<ConfirmFn>(
    (text) =>
      new Promise<boolean>((resolve) => {
        resolver.current?.(false)
        resolver.current = resolve
        const active = document.activeElement
        opener.current = active instanceof HTMLElement && active !== document.body ? active : null
        setMessage(text)
      }),
    [],
  )

  useEffect(() => {
    const el = ref.current
    if (message === null || !el || el.open) return
    openModal(el)
  }, [message])

  // Leaving with a question unanswered declines it.
  useEffect(() => () => resolver.current?.(false), [])

  const dialog =
    message === null ? null : (
      <DialogShell
        ref={ref}
        labelledBy={titleId}
        className="max-w-[min(26rem,calc(100vw-32px))] p-5"
        onCancel={(e) => {
          e.preventDefault()
          settle(false)
        }}
      >
        {/* The states sheet's `.ov-h` and body: 18 px title, a 13.5 px ink-2 line two lines under it. */}
        <DialogHeader id={titleId} className="mb-2 text-[18px] tracking-[-0.02em]">
          {title}
        </DialogHeader>
        <p className="m-0 text-[13.5px] leading-[1.5] text-ink-2">{message}</p>
        <DialogFooter className="mt-[18px]">
          <Button type="button" variant="line" onClick={() => settle(false)}>
            {cancelLabel}
          </Button>
          <Button type="button" onClick={() => settle(true)}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogShell>
    )

  return { confirm, dialog }
}
