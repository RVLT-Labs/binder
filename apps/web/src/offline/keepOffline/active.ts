import type { KeepOfflineRunner } from './runner'

let active: KeepOfflineRunner | null = null

/** Registers the running runner (the root mount) so sign-out can stop it; null when it unmounts. */
export function setActiveRunner(runner: KeepOfflineRunner | null): void {
  active = runner
}

/**
 * Stops the running runner, if any: aborts its fetches, discards any late response, and resolves
 * once nothing can still write to the blob cache. Sign-out calls this before clearing the cache so
 * a download in flight cannot repopulate it for the next user.
 */
export async function stopKeepOffline(): Promise<void> {
  const runner = active
  active = null
  await runner?.stop()
}
