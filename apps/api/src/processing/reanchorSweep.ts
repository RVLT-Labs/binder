import { changeLog, documents, documentVersions, shows } from '@binder/db'
import { and, eq, gt, isNull, ne, notExists, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { reanchorBatchId } from './reanchorJob'
import type { ProcessingDeps } from './types'

/** The prefix of every run's batch id, `reanchor:`, for the SQL below. */
const BATCH_PREFIX = reanchorBatchId('')

/**
 * Enqueues (and returns) every version whose re-anchoring is still owed: ready, in an open show, not
 * its document's current version, numbered above it, and never re-anchored. Never re-anchored means
 * no change-log row with batch id `reanchor:<versionId>`, so a run a user reverted is not run again.
 * It covers a process that died between the ready commit and the enqueue, and a failed enqueue;
 * `server.ts` runs it at start and every five minutes. Enqueues coalesce per version, so a version
 * already queued is not queued twice.
 */
export async function sweepPendingReanchors(
  deps: Pick<ProcessingDeps, 'db' | 'jobs'>,
): Promise<string[]> {
  const current = alias(documentVersions, 'current_version')
  const owed = await deps.db
    .select({ id: documentVersions.id })
    .from(documentVersions)
    .innerJoin(documents, eq(documents.id, documentVersions.documentId))
    .innerJoin(shows, eq(shows.id, documentVersions.showId))
    .leftJoin(current, eq(current.id, documents.currentVersionId))
    .where(
      and(
        eq(documentVersions.status, 'ready'),
        ne(shows.status, 'archived'),
        sql`${documentVersions.id} IS DISTINCT FROM ${documents.currentVersionId}`,
        or(isNull(current.id), gt(documentVersions.versionNumber, current.versionNumber)),
        notExists(
          deps.db
            .select({ one: sql`1` })
            .from(changeLog)
            .where(
              and(
                eq(changeLog.showId, documentVersions.showId),
                eq(changeLog.batchId, sql`${BATCH_PREFIX}::text || ${documentVersions.id}`),
              ),
            ),
        ),
      ),
    )
    .orderBy(documentVersions.documentId, documentVersions.versionNumber)
  const ids = owed.map((r) => r.id)
  for (const id of ids) await deps.jobs.enqueueReanchor(id)
  return ids
}
