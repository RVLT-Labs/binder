import { useMutation } from '@tanstack/react-query'
import { useEffect } from 'react'
import { ApiError, api } from '../api/client'
import { pushNotice } from '../components/noticeStore'
import { useOnline } from '../offline/useOnline'

/** What a failed request says to the person: the server's own sentence, or a stock one with no connection. */
function message(action: string, err: unknown): string {
  if (err instanceof ApiError) return err.message
  return `Could not ${action} this upload. Check your connection and try again.`
}

/** How long a succeeded request holds the buttons for the sync stream to flip the row (about 2 s). */
export const SETTLE_MS = 5000

/**
 * Cancel, try again and remove for one document version (the API's cancel, retry and delete routes).
 * These are server actions, not synced writes, so they work only online: `online` is false offline
 * and the buttons say "Needs a connection". Success needs no cache work: the sync stream flips the
 * row within about two seconds, and `busy` holds the buttons until it does. `busy` lets go when
 * `state` (what the row shows: its status and failure code) changes, and after `SETTLE_MS` in any
 * case, so a row that comes back in the same shape (retry, then the enqueue fails again) is not left
 * dead. A refusal (a job that had just finished, a newer version) is a notice with the server's
 * sentence.
 */
export function useVersionActions(showId: string, versionId: string | null, state = '') {
  const online = useOnline()
  const base = `/shows/${encodeURIComponent(showId)}/versions/${encodeURIComponent(versionId ?? '')}`
  const options = (action: string, call: () => Promise<unknown>) => ({
    mutationFn: call,
    onError: (err: unknown) => pushNotice({ kind: 'error', message: message(action, err) }),
  })
  const cancel = useMutation(options('cancel', () => api.post(`${base}/cancel`)))
  const retry = useMutation(options('retry', () => api.post(`${base}/retry`)))
  const remove = useMutation(options('remove', () => api.del(base)))
  const all = [cancel, retry, remove]
  const succeeded = all.some((m) => m.isSuccess)
  const { reset: resetCancel } = cancel
  const { reset: resetRetry } = retry
  const { reset: resetRemove } = remove
  // biome-ignore lint/correctness/useExhaustiveDependencies: `state` is the trigger, not a value read
  useEffect(() => {
    resetCancel()
    resetRetry()
    resetRemove()
  }, [state, resetCancel, resetRetry, resetRemove])
  useEffect(() => {
    if (!succeeded) return
    const timer = setTimeout(() => {
      resetCancel()
      resetRetry()
      resetRemove()
    }, SETTLE_MS)
    return () => clearTimeout(timer)
  }, [succeeded, resetCancel, resetRetry, resetRemove])
  return {
    online,
    cancel: () => cancel.mutate(),
    retry: () => retry.mutate(),
    remove: () => remove.mutate(),
    cancelling: cancel.isPending,
    retrying: retry.isPending,
    removing: remove.isPending,
    removed: remove.isSuccess,
    /** A request is in flight or has succeeded and the row has not flipped yet: hold the buttons. */
    busy: all.some((m) => m.isPending || m.isSuccess),
  }
}
