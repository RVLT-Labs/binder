import { flushSoon } from '../exports/flusher'

/**
 * What happens once sign-in succeeds: the session is re-read, exports this user left waiting (kept
 * because the session had expired) go up now rather than at the next reload or `online` event, and
 * the user lands on the home screen.
 */
export async function afterSignIn(deps: {
  refreshSession: () => Promise<unknown>
  toHome: () => Promise<unknown>
}): Promise<void> {
  await deps.refreshSession()
  flushSoon()
  await deps.toHome()
}
