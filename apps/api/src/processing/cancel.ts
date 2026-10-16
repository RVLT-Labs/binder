import { documentVersions } from '@binder/db'
import { eq } from 'drizzle-orm'
import type { ProcessingDeps } from './types'

/** How often the document job checks whether its version was cancelled. */
export const CANCEL_POLL_MS = 2000

/** The version stopped being `processing` (it was cancelled) while the document job worked on it. */
export class ProcessingCancelled extends Error {
  constructor(readonly versionId: string) {
    super(`processing of version ${versionId} was cancelled`)
    this.name = 'ProcessingCancelled'
  }
}

/**
 * Aborts `controller` once the version's row is gone or its status is no longer `processing`, polled
 * every `intervalMs`. Stopping work is driven by the database, not by pg-boss: pg-boss 12.37 does
 * not interrupt an active handler, so this works however the worker is deployed. A failed poll
 * (a database blip) is skipped and tried again. Returns the function that stops the watch; call it
 * once the watched work is over.
 */
export function watchForCancel(
  db: ProcessingDeps['db'],
  versionId: string,
  controller: AbortController,
  intervalMs = CANCEL_POLL_MS,
): () => void {
  let polling = false
  const timer = setInterval(async () => {
    if (polling) return
    polling = true
    try {
      const [row] = await db
        .select({ status: documentVersions.status })
        .from(documentVersions)
        .where(eq(documentVersions.id, versionId))
      if (row?.status !== 'processing') {
        clearInterval(timer)
        controller.abort()
      }
    } catch {
      // Try again on the next tick.
    } finally {
      polling = false
    }
  }, intervalMs)
  return () => clearInterval(timer)
}
