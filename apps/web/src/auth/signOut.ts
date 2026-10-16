import { pushNotice } from '../components/noticeStore'

export interface SignOutDeps {
  /** Better Auth's signOut: resolves with `error` on a server failure, throws when it cannot send. */
  signOut: () => Promise<{ error: { message?: string } | null }>
  clearLocalData: () => Promise<void>
  /** Deletes the signed-in user's exports still waiting to upload. */
  clearOutbox: () => Promise<void>
  /** Deletes the signed-in user's keep-offline preferences: the next sign-in starts with every show Off. */
  clearOfflinePrefs: () => Promise<void>
  /**
   * Stops the keep-offline runner: aborts its fetches, discards late responses and resolves once
   * nothing can write to the cache. Runs before `clearLocalData` (which empties the blob cache).
   */
  stopOfflineRunner: () => Promise<void>
  clearCache: () => void
  toLogin: () => Promise<void>
  /** How many local changes are still queued for upload (`ps_crud`); signing out would discard them. */
  pendingUploads: () => Promise<number>
  /** Asks the user a yes/no question (the browser's `confirm`). */
  confirm: (message: string) => boolean | Promise<boolean>
}

/**
 * Asks first when changes are still waiting to upload (clearing the local database would lose them).
 * Then ends the session on the server first. Only once that succeeds are local rows, queued uploads (sync writes and
 * pending exports) and cached queries thrown away; if it fails (offline, 5xx) the user stays signed in with everything
 * intact and is told why.
 */
export async function signOutAndClear(deps: SignOutDeps): Promise<void> {
  // A queue that cannot be counted must not strand the sign-out.
  const pending = await deps.pendingUploads().catch((err) => {
    console.error('could not count pending uploads', err)
    return 0
  })
  if (pending > 0) {
    const what = pending === 1 ? '1 change hasn' : `${pending} changes haven`
    if (!(await deps.confirm(`${what}'t uploaded yet. Sign out anyway?`))) return
  }
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
  // First, so a download in flight cannot repopulate the cache that `clearLocalData` empties.
  await deps.stopOfflineRunner().catch((err) => console.error('could not stop keep-offline', err))
  // The files are the user's own and leave with them; a storage error must not strand the sign-out.
  await deps.clearOutbox().catch((err) => console.error('could not clear the export outbox', err))
  await deps.clearOfflinePrefs().catch((err) => console.error('could not clear keep-offline', err))
  await deps.clearLocalData()
  deps.clearCache()
  await deps.toLogin()
}
