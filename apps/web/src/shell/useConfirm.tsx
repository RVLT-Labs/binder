import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { DialogFooter, DialogHeader, DialogShell } from '@/components/ui/dialog-shell'
import { closeModal, openModal } from '@/lib/modalDialog'
import type { ConfirmFn } from './types'

/**
 * An in-page yes/no question, in place of `window.confirm`. Render `dialog` somewhere in the tree
 * and `await confirm(message)`: it resolves true on the confirm button and false on Cancel or Escape.
 */
export function useConfirm(
  title: string,
  confirmLabel: string,
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
        className="max-w-[min(26rem,calc(100vw-32px))]"
        onCancel={(e) => {
          e.preventDefault()
          settle(false)
        }}
      >
        <DialogHeader id={titleId}>{title}</DialogHeader>
        <p className="text-[14px] text-ink-2">{message}</p>
        <DialogFooter>
          <Button type="button" variant="line" onClick={() => settle(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={() => settle(true)}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogShell>
    )

  return { confirm, dialog }
}
