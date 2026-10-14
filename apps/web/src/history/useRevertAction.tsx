import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from 'react'
import { type RevertTarget, useRevert } from './api'

interface Asking {
  question: string
  resolve: (yes: boolean) => void
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
    (question: string) => new Promise<boolean>((resolve) => setAsking({ question, resolve })),
    [],
  )
  const mutation = useRevert(showId, ask)
  const answer = (yes: boolean) => {
    asking?.resolve(yes)
    setAsking(null)
  }
  return {
    revert: (target) => mutation.mutate(target),
    pending: mutation.isPending,
    dialog: asking ? <ConfirmDialog question={asking.question} onAnswer={answer} /> : null,
  }
}

function ConfirmDialog({
  question,
  onAnswer,
}: {
  question: string
  onAnswer: (yes: boolean) => void
}) {
  const headingId = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    dialog.current?.showModal()
  }, [])
  return (
    <dialog
      ref={dialog}
      className="confirm-dialog"
      aria-labelledby={headingId}
      // The document's markup keys (Delete, Escape, digits) must not act on the selection behind it.
      onKeyDown={(e) => e.stopPropagation()}
      // Escape closes a modal dialog: that is a no.
      onCancel={(e) => {
        e.preventDefault()
        onAnswer(false)
      }}
    >
      <h2 id={headingId}>{question}</h2>
      <div className="dialog-actions">
        <button type="button" onClick={() => onAnswer(false)}>
          Cancel
        </button>
        <button type="button" className="danger" onClick={() => onAnswer(true)}>
          Revert anyway
        </button>
      </div>
    </dialog>
  )
}
