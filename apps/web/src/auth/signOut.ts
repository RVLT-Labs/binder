import { pushNotice } from '../components/noticeStore'
import { endLocalSession, quiesceLocalWork } from './localWork'

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
  stopExportRunner: () => Promise<void>
  clearCache: () => void
  toLogin: () => Promise<void>
  /** How many local changes are still queued for upload (`ps_crud`); signing out would discard them. */
  pendingUploads: () => Promise<number>
  /** Queued export files, scoped to the signed-in owner. */
  pendingExports: () => Promise<number>
  /** Asks the user a yes/no question (the browser's `confirm`). */
  confirm: (message: string) => boolean | Promise<boolean>
}

/**
 * Asks first when changes are still waiting to upload (clearing the local database would lose them).
 * Then ends the session on the server first. Only once that succeeds are local rows, queued uploads (sync writes and
 * pending exports) and cached queries thrown away; if it fails (offline, 5xx) the user stays signed in with everything
 * intact and is told why.
 */
async function signOutLocked(deps: SignOutDeps): Promise<void> {
  const count = async () => {
    const [changes, exports] = await Promise.all([deps.pendingUploads(), deps.pendingExports()])
    if (![changes, exports].every((n) => Number.isSafeInteger(n) && n >= 0))
      throw new Error('Invalid queue count')
    return { changes, exports }
  }
  let approved = { changes: 0, exports: 0 }
  try {
    let current = await count()
    // Repeat a warning if work appeared while the user was considering it. The writer lock
    // normally prevents increases; these checks also guard external writers and count races.
    for (let attempt = 0; ; attempt++) {
      if (attempt >= 3) throw new Error('Queues keep changing')
      if (current.changes > approved.changes || current.exports > approved.exports) {
        const n = current.changes
        const changes =
          n > 0 ? `${n === 1 ? '1 change hasn' : `${n} changes haven`}'t uploaded yet. ` : ''
        const files =
          current.exports > 0
            ? `${current.exports} pending export${current.exports === 1 ? '' : 's'}. `
            : ''
        if (
          !(await deps.confirm(
            `${changes}${files}Queued changes and pending exports will be removed from this device. Sign out anyway?`,
          ))
        )
          return
      }
      approved = current
      current = await count()
      if (current.changes <= approved.changes && current.exports <= approved.exports) break
    }
  } catch {
    pushNotice({
      kind: 'error',
      message:
        'Could not check waiting changes and exports. Nothing was removed. Try signing out again when local storage is available.',
    })
    return
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
  endLocalSession()
  await deps.stopExportRunner()
  await deps.stopOfflineRunner()
  try {
    const final = await count()
    if (final.changes > approved.changes || final.exports > approved.exports)
      throw new Error('New waiting work')
  } catch {
    endLocalSession()
    pushNotice({
      kind: 'error',
      message:
        'The server signed out, but waiting work changed or could not be checked. Local data was retained. Sign in to the same account to recover it.',
    })
    return
  }
  await deps.clearOutbox()
  await deps.clearOfflinePrefs()
  await deps.clearLocalData()
  endLocalSession()
  deps.clearCache()
  await deps.toLogin()
}

export async function signOutAndClear(deps: SignOutDeps): Promise<void> {
  let release: (() => void) | undefined
  try {
    release = await quiesceLocalWork()
    await signOutLocked(deps)
  } catch (error) {
    pushNotice({
      kind: 'error',
      message: `Could not finish signing out. Local data was retained where possible: ${error instanceof Error ? error.message : String(error)}`,
    })
  } finally {
    await release?.()
  }
}
