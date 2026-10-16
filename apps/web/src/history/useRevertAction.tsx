import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { DialogFooter, DialogHeader, DialogShell } from '@/components/ui/dialog-shell'
import { closeModal, openModal } from '@/lib/modalDialog'
import { type RevertTarget, useRevert } from './api'

interface Asking {
  question: string
  resolve: (yes: boolean) => void
  /** What had focus when it was asked: the Revert button, which gets focus back. */
  opener: HTMLElement | null
}

/**
 * The revert mutation with its confirmation. `dialog` must be rendered by the caller; it is empty
 * until the server says the row has changed since, and then asks the question in a modal dialog.
 */
export function useRevertAction(showId: string): {
  revert: (target: RevertTarget) => void
  pending: boolean
  dialog: ReactNode
} {
  const [asking, setAsking] = useState<Asking | null>(null)
  const ask = useCallback(
    (question: string) =>
      new Promise<boolean>((resolve) => {
        const active = document.activeElement
        setAsking({
          question,
          resolve,
          opener: active instanceof HTMLElement && active !== document.body ? active : null,
        })
      }),
    [],
  )
  const mutation = useRevert(showId, ask)
  return {
    revert: (target) => mutation.mutate(target),
    pending: mutation.isPending,
    dialog: asking ? (
      <ConfirmDialog
        question={asking.question}
        opener={asking.opener}
        onAnswer={(yes) => {
          asking.resolve(yes)
          setAsking(null)
        }}
      />
    ) : null,
  }
}

function ConfirmDialog({
  question,
  opener,
  onAnswer,
}: {
  question: string
  opener: HTMLElement | null
  onAnswer: (yes: boolean) => void
}) {
  const headingId = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (dialog.current) openModal(dialog.current)
  }, [])
  // Close it itself, then hand focus back to the Revert that asked: unmounting an open modal does neither.
  const answer = (yes: boolean) => {
    closeModal(dialog.current, opener)
    onAnswer(yes)
  }
  return (
    <DialogShell
      ref={dialog}
      labelledBy={headingId}
      className="max-w-[min(26rem,calc(100vw-32px))]"
      // The document's markup keys (Delete, Escape, digits) must not act on the selection behind it.
      onKeyDown={(e) => e.stopPropagation()}
      // Escape closes a modal dialog: that is a no.
      onCancel={(e) => {
        e.preventDefault()
        answer(false)
      }}
    >
      <DialogHeader id={headingId} className="mb-0">
        {question}
      </DialogHeader>
      <DialogFooter>
        <Button type="button" variant="line" onClick={() => answer(false)}>
          Cancel
        </Button>
        <Button type="button" onClick={() => answer(true)}>
          Revert anyway
        </Button>
      </DialogFooter>
    </DialogShell>
  )
}
