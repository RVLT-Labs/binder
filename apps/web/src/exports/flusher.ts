import { ApiError, api } from '../api/client'
import { captureLocalAccountWork } from '../auth/localWork'
import { type FlushResult, flushOutbox } from './outbox'

/** How long a failed or partial flush waits before it tries again on its own. */
export const RETRY_MS = 30_000

/**
 * Flushes the outbox of whoever the server says is signed in. Asking the server (rather than
 * trusting the remembered user) and checking the original local claim keeps a delayed /me reply
 * from selecting another account's queue. The upload also carries an expected server account.
 * Never rejects. Resolves to `null` when nothing could be asked (offline) or nobody is signed in, and `'retry'` when the server could not be asked right now or the run itself failed
 * (storage trouble), so the caller should try again later.
 */
export async function flushForSession(): Promise<FlushResult | 'retry' | null> {
  if (!navigator.onLine) return null
  let userId: string
  try {
    const claim = captureLocalAccountWork()
    userId = (await api.get<{ user: { id: string } }>('/me')).user.id
    claim.checkClaim()
    if (userId !== claim.userId)
      throw new Error('The server account changed during the export flush.')
  } catch (err) {
    return err instanceof ApiError && err.status === 401 ? null : 'retry'
  }
  try {
    return await flushOutbox(userId)
  } catch (err) {
    console.error('could not flush the export outbox', err)
    return 'retry'
  }
}

/** The running flusher's trigger, so other code can ask for a flush that keeps the retry timer. */
let kick: (() => void) | null = null

/**
 * Asks for a flush now: after an export is queued, after signing in. Goes through the started
 * flusher when there is one, so a failed attempt gets the same retry as the others.
 */
export function flushSoon(): void {
  if (kick) kick()
  else void flushForSession()
}

/**
 * Flushes the outbox now and whenever the browser comes back online, and retries later while
 * entries remain. Returns a function that stops it (timer and listener).
 */
export function startOutboxFlusher(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  const retry = () => {
    clearTimeout(timer)
    if (!stopped) timer = setTimeout(run, RETRY_MS)
  }
  const run = () => {
    clearTimeout(timer)
    flushForSession().then(
      (result) => {
        if (result === 'retry' || (result !== null && result.kept > 0)) retry()
      },
      (err) => {
        console.error('export outbox flush failed', err)
        retry()
      },
    )
  }
  kick = run
  run()
  window.addEventListener('online', run)
  return () => {
    stopped = true
    clearTimeout(timer)
    window.removeEventListener('online', run)
    if (kick === run) kick = null
  }
}
