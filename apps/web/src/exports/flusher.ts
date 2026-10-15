import { ApiError, api } from '../api/client'
import { type FlushResult, flushOutbox } from './outbox'

/** How long a failed or partial flush waits before it tries again on its own. */
const RETRY_MS = 30_000

/**
 * Flushes the outbox of whoever the server says is signed in. Asking the server (rather than
 * trusting the remembered user) means a file is only ever sent under the session it belongs to: if
 * another user signed in on this device, their outbox is the one that flushes, never the previous
 * user's. Resolves to `null` when nothing could be asked (offline) or nobody is signed in, and
 * `'retry'` when the server could not be asked right now.
 */
export async function flushForSession(): Promise<FlushResult | 'retry' | null> {
  if (!navigator.onLine) return null
  let userId: string
  try {
    userId = (await api.get<{ user: { id: string } }>('/me')).user.id
  } catch (err) {
    return err instanceof ApiError && err.status === 401 ? null : 'retry'
  }
  return flushOutbox(userId)
}

/**
 * Flushes the outbox now and whenever the browser comes back online, and retries later while
 * entries remain. Returns a function that stops it.
 */
export function startOutboxFlusher(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const run = () => {
    clearTimeout(timer)
    void flushForSession().then((result) => {
      if (result === 'retry' || (result !== null && result.kept > 0)) {
        timer = setTimeout(run, RETRY_MS)
      }
    })
  }
  run()
  window.addEventListener('online', run)
  return () => {
    clearTimeout(timer)
    window.removeEventListener('online', run)
  }
}
