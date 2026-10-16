import { createReadStream } from 'node:fs'
import { join } from 'node:path'
import { fromPopplerBbox } from '@binder/core'
import { documents, documentVersions, pages } from '@binder/db'
import { and, eq, exists, notExists, sql } from 'drizzle-orm'
import { pageThumbBlobKey, pageWordsBlobKey } from '../blob/keys'
import { extractBboxXhtml, renderThumbnail } from './poppler'
import { blobFile, withTempDir } from './tmp'
import type { ProcessingDeps } from './types'

/** Processing writes rows as the system and never logs changes (R43). */
export const SYSTEM = 'system'

/** What finishing a page did to its version. */
export type FinishResult = 'not-done' | 'ready' | 'needs-reanchor'

/**
 * Marks the version ready once it has pages and none of them is still queued (a failed page counts
 * as done). A version with no page rows is never ready: it is between a cancel and a retry's document
 * job, and a stale page job finishing then must not finish the version for it. One
 * conditional UPDATE, so when two page jobs finish together exactly one of them wins. A document's
 * first version (no current version yet) becomes current at once. A newer version leaves the current
 * one in place and queues the re-anchoring job after the transaction commits (`'needs-reanchor'`);
 * it becomes current when that job has moved the anchors (spec 5.4). A version older than the
 * current one changes nothing more. If the enqueue fails the sweep finds the version again.
 */
export async function finishVersionIfDone(
  deps: Pick<ProcessingDeps, 'db' | 'jobs'>,
  versionId: string,
): Promise<FinishResult> {
  const result = await deps.db.transaction(async (tx): Promise<FinishResult> => {
    const [ready] = await tx
      .update(documentVersions)
      .set({
        status: 'ready',
        pageCount: sql`(SELECT count(*)::int FROM ${pages} WHERE ${pages.documentVersionId} = ${versionId})`,
        updatedBy: SYSTEM,
      })
      .where(
        and(
          eq(documentVersions.id, versionId),
          eq(documentVersions.status, 'processing'),
          exists(
            tx.select({ one: sql`1` }).from(pages).where(eq(pages.documentVersionId, versionId)),
          ),
          notExists(
            tx
              .select({ one: sql`1` })
              .from(pages)
              .where(and(eq(pages.documentVersionId, versionId), eq(pages.status, 'queued'))),
          ),
        ),
      )
      .returning({
        documentId: documentVersions.documentId,
        number: documentVersions.versionNumber,
      })
    if (!ready) return 'not-done'

    // Serialises with the re-anchoring job, which reads the current version under the same lock.
    const [document] = await tx
      .select({ currentVersionId: documents.currentVersionId })
      .from(documents)
      .where(eq(documents.id, ready.documentId))
      .for('update')
    if (!document || document.currentVersionId === versionId) return 'ready'
    if (document.currentVersionId === null) {
      await tx
        .update(documents)
        .set({ currentVersionId: versionId, updatedBy: SYSTEM })
        .where(eq(documents.id, ready.documentId))
      return 'ready'
    }
    const [current] = await tx
      .select({ number: documentVersions.versionNumber })
      .from(documentVersions)
      .where(eq(documentVersions.id, document.currentVersionId))
    return current && current.number > ready.number ? 'ready' : 'needs-reanchor'
  })
  if (result === 'needs-reanchor') {
    try {
      await deps.jobs.enqueueReanchor(versionId)
    } catch (err) {
      // The version is ready and durable; the periodic sweep enqueues it again.
      console.error(`could not enqueue re-anchoring for version ${versionId}`, err)
    }
  }
  return result
}

/**
 * Page job: renders the thumbnail and extracts the word layer from the searchable PDF, then marks
 * the page ready (or failed, with the message). Safe to repeat: a page that is no longer queued, or
 * no longer exists because its document job was retried, is left alone.
 */
export async function processPage(deps: ProcessingDeps, pageId: string): Promise<void> {
  const { db, blobs } = deps
  const [row] = await db
    .select({ page: pages, version: documentVersions })
    .from(pages)
    .innerJoin(documentVersions, eq(documentVersions.id, pages.documentVersionId))
    .where(eq(pages.id, pageId))
  if (!row) return
  const { page, version } = row
  // Pages only run while their version does. A cancelled version is failed, so a page job queued
  // before the cancel does no work and cannot bring the version back.
  if (version.status !== 'processing') return

  if (page.status === 'queued') {
    const stillQueued = and(eq(pages.id, pageId), eq(pages.status, 'queued'))
    try {
      const { searchableKey } = version
      const { width, height, rotation } = page
      if (!searchableKey || width === null || height === null || rotation === null) {
        throw new Error('page has no searchable PDF or dimensions yet')
      }
      const keys = {
        thumbKey: pageThumbBlobKey(version.showId, version.documentId, version.id, page.index),
        wordsKey: pageWordsBlobKey(version.showId, version.documentId, version.id, page.index),
      }
      await withTempDir('binder-page-', async (dir) => {
        const pdf = await blobFile(blobs, searchableKey, dir, 'searchable.pdf')
        const thumb = await renderThumbnail(pdf, page.index, join(dir, 'thumb'), rotation)
        const layer = fromPopplerBbox(await extractBboxXhtml(pdf, page.index), { width, height })
        await blobs.put(keys.thumbKey, createReadStream(thumb), 'image/png')
        await blobs.put(keys.wordsKey, Buffer.from(JSON.stringify(layer)), 'application/json')
      })
      const done = await db
        .update(pages)
        .set({ status: 'ready', error: null, ...keys, updatedBy: SYSTEM })
        .where(stillQueued)
        .returning({ id: pages.id })
      // No row: the page was deleted (cancel, retry) while this job rendered. Not this job's version.
      if (done.length === 0) return
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const failed = await db
        .update(pages)
        .set({ status: 'failed', error: message, updatedBy: SYSTEM })
        .where(stillQueued)
        .returning({ id: pages.id })
      if (failed.length === 0) return
    }
  }
  await finishVersionIfDone(deps, version.id)
}

/**
 * The page job's dead-letter action (R45): pg-boss gave up after retries or expiry. Fails the page
 * if it is still queued, then runs the same ready check as a finished page job.
 */
export async function markPageFailed(
  deps: Pick<ProcessingDeps, 'db' | 'jobs'>,
  pageId: string,
  error: string,
): Promise<void> {
  const [failed] = await deps.db
    .update(pages)
    .set({ status: 'failed', error, updatedBy: SYSTEM })
    .where(and(eq(pages.id, pageId), eq(pages.status, 'queued')))
    .returning({ versionId: pages.documentVersionId })
  if (failed) await finishVersionIfDone(deps, failed.versionId)
}
