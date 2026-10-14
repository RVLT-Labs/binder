import { createReadStream } from 'node:fs'
import { join } from 'node:path'
import { fromPopplerBbox } from '@binder/core'
import { documents, documentVersions, pages } from '@binder/db'
import { and, eq, gt, isNull, notExists, notInArray, or, sql } from 'drizzle-orm'
import { pageThumbBlobKey, pageWordsBlobKey } from '../blob/keys'
import { extractBboxXhtml, renderThumbnail } from './poppler'
import { blobFile, withTempDir } from './tmp'
import type { ProcessingDeps } from './types'

/** Processing writes rows as the system and never logs changes (R43). */
export const SYSTEM = 'system'

type Executor = ProcessingDeps['db']

/**
 * Marks the version ready once none of its pages is still queued (a failed page counts as done),
 * then makes it the document's current version unless a later ready version already is (R42). One
 * conditional UPDATE, so when two page jobs finish together exactly one of them wins.
 */
export async function finishVersionIfDone(db: Executor, versionId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
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
    if (!ready) return false

    const laterReady = tx
      .select({ id: documentVersions.id })
      .from(documentVersions)
      .where(
        and(
          eq(documentVersions.documentId, ready.documentId),
          eq(documentVersions.status, 'ready'),
          gt(documentVersions.versionNumber, ready.number),
        ),
      )
    await tx
      .update(documents)
      .set({ currentVersionId: versionId, updatedBy: SYSTEM })
      .where(
        and(
          eq(documents.id, ready.documentId),
          sql`${documents.currentVersionId} IS DISTINCT FROM ${versionId}`,
          or(
            isNull(documents.currentVersionId),
            notInArray(documents.currentVersionId, laterReady),
          ),
        ),
      )
    return true
  })
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
      await db
        .update(pages)
        .set({ status: 'ready', error: null, ...keys, updatedBy: SYSTEM })
        .where(stillQueued)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await db
        .update(pages)
        .set({ status: 'failed', error: message, updatedBy: SYSTEM })
        .where(stillQueued)
    }
  }
  await finishVersionIfDone(db, version.id)
}
