import { useMutation } from '@tanstack/react-query'
import { ApiError, api } from '../api/client'
import { pushNotice } from '../components/noticeStore'
import { useOnline } from '../offline/useOnline'

/** What a failed request says to the person: the server's own sentence, or a stock one with no connection. */
function message(action: string, err: unknown): string {
  if (err instanceof ApiError) return err.message
  return `Could not ${action} this upload. Check your connection and try again.`
}

/**
 * Cancel, try again and remove for one document version (the API's cancel, retry and delete routes).
 * These are server actions, not synced writes, so they work only online: `online` is false offline
 * and the buttons say "Needs a connection". Success needs no cache work: the sync stream flips the
 * row within about two seconds, and `busy` holds the buttons until it does. A refusal (a job that
 * had just finished, a newer version) is a notice with the server's sentence.
 */
export function useVersionActions(showId: string, versionId: string | null) {
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
  return {
    online,
    cancel: () => cancel.mutate(),
    retry: () => retry.mutate(),
    remove: () => remove.mutate(),
    cancelling: cancel.isPending,
    retrying: retry.isPending,
    removing: remove.isPending,
    /** A request is in flight or has succeeded and the row has not flipped yet: hold the buttons. */
    busy: all.some((m) => m.isPending || m.isSuccess),
  }
}
