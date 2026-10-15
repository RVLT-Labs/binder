import { pushNotice } from '../components/noticeStore'

export interface SignOutDeps {
  /** Better Auth's signOut: resolves with `error` on a server failure, throws when it cannot send. */
  signOut: () => Promise<{ error: { message?: string } | null }>
  clearLocalData: () => Promise<void>
  /** Deletes the signed-in user's exports still waiting to upload. */
  clearOutbox: () => Promise<void>
  clearCache: () => void
  toLogin: () => Promise<void>
}

/**
 * Ends the session on the server first. Only once that succeeds are local rows, queued uploads (sync writes and
 * pending exports) and cached queries thrown away; if it fails (offline, 5xx) the user stays signed in with everything
 * intact and is told why.
 */
export async function signOutAndClear(deps: SignOutDeps): Promise<void> {
  let failure: string | undefined
  try {
    const { error } = await deps.signOut()
    if (error) failure = error.message || 'the server refused the request'
  } catch (err) {
    failure = err instanceof Error ? err.message : String(err)
  }
  if (failure !== undefined) {
    pushNotice({
      kind: 'error',
      message: `Could not sign out: ${failure}. You are still signed in.`,
    })
    return
  }
  // The files are the user's own and leave with them; a storage error must not strand the sign-out.
  await deps.clearOutbox().catch((err) => console.error('could not clear the export outbox', err))
  await deps.clearLocalData()
  deps.clearCache()
  await deps.toLogin()
}
