import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { DialogFooter, DialogHeader, DialogShell } from '@/components/ui/dialog-shell'
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
  const [message, setMessage] = useState<string | null>(null)
  const titleId = useId()

  const settle = useCallback((ok: boolean) => {
    resolver.current?.(ok)
    resolver.current = null
    setMessage(null)
  }, [])

  const confirm = useCallback<ConfirmFn>(
    (text) =>
      new Promise<boolean>((resolve) => {
        resolver.current?.(false)
        resolver.current = resolve
        setMessage(text)
      }),
    [],
  )

  useEffect(() => {
    const el = ref.current
    if (message === null || !el || el.open) return
    // jsdom has no showModal; the dialog is then just open.
    if (typeof el.showModal === 'function') el.showModal()
    else el.setAttribute('open', '')
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
