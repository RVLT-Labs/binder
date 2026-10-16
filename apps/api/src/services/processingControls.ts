import { annotations, cues, documents, documentVersions, pages, shows } from '@binder/db'
import { type Actor, newId } from '@binder/shared'
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { BlobStore } from '../blob/BlobStore'
import { searchableBlobKey } from '../blob/keys'
import { conflict, notFound } from '../errors'
import type { JobQueue } from '../processing/types'
import { logChange } from './changeLog'
import { type DocumentVersion, enqueueProcessing } from './documents'
import type { Executor } from './executor'
import { assertShowWritable, requireShowRole } from './tenancy'

interface VersionInput {
  versionId: string
  /** When given, the version must belong to this show (the REST routes pass the URL's show). */
  showId?: string
  batchId?: string
}

/**
 * Finds the version, checks the caller may change documents in its show (editor or above, show not
 * archived), then re-reads the row `FOR UPDATE` so the status checks that follow cannot race a
 * finishing job or another control. Authorisation comes first so a stranger never waits on a lock.
 */
async function lockVersionForControl(
  tx: Executor,
  actor: Actor,
  input: VersionInput,
): Promise<DocumentVersion> {
  const [found] = await tx
    .select()
    .from(documentVersions)
    .where(eq(documentVersions.id, input.versionId))
  if (!found || (input.showId !== undefined && found.showId !== input.showId)) {
    throw notFound('Version not found')
  }
  await requireShowRole(tx, actor, found.showId, 'editor')
  const [show] = await tx
    .select({ status: shows.status })
    .from(shows)
    .where(eq(shows.id, found.showId))
  if (!show) throw notFound('Show not found')
  assertShowWritable(show)
  const [version] = await tx
    .select()
    .from(documentVersions)
    .where(eq(documentVersions.id, input.versionId))
    .for('update')
  if (!version) throw notFound('Version not found')
  return version
}

/**
 * Editor or above on an unarchived show. Stops a version that is still queued or processing: it
 * becomes `failed` with code `cancelled`, its page rows go, and the change is logged. The running
 * job notices by itself (the document job polls the status and kills OCR), so nothing is told to
 * pg-boss. Cancelling a version that was already cancelled returns it unchanged; a version that
 * finished (`ready`) or failed for another reason is `conflict`, because the work is over.
 */
export async function cancelVersionProcessing(
  db: Executor,
  actor: Actor,
  input: VersionInput,
): Promise<DocumentVersion> {
  const batchId = input.batchId ?? newId()
  return db.transaction(async (tx) => {
    const version = await lockVersionForControl(tx, actor, input)
    if (version.status === 'failed' && version.failureCode === 'cancelled') return version
    if (version.status === 'ready') throw conflict('This upload has already finished')
    if (version.status === 'failed') throw conflict('This upload is not processing')

    const [cancelled] = await tx
      .update(documentVersions)
      .set({
        status: 'failed',
        error: 'Cancelled',
        failureCode: 'cancelled',
        failureDpi: null,
        updatedBy: actor.userId,
      })
      .where(
        and(
          eq(documentVersions.id, version.id),
          inArray(documentVersions.status, ['queued', 'processing']),
        ),
      )
      .returning()
    await tx.delete(pages).where(eq(pages.documentVersionId, version.id))
    await logChange(tx, {
      showId: version.showId,
      actor,
      batchId,
      table: 'document_versions',
      rowId: version.id,
      op: 'update',
      before: { status: version.status, failureCode: null },
      after: { status: 'failed', failureCode: 'cancelled' },
    })
    return cancelled
  })
}

/**
 * Editor or above on an unarchived show. Runs a failed version again from the same stored file: the
 * version goes back to `queued` (error and failure columns cleared, stale page rows deleted), the
 * change is logged, and after the commit the document job is queued, which marks it `enqueue_failed`
 * if the queue refuses. Only the document's newest version can be retried (an older failed one is
 * hidden behind it), and only while the original is still stored. Every failure code is allowed;
 * the web decides whether re-running the same file could ever help.
 */
export async function retryVersion(
  db: Executor,
  blobs: BlobStore,
  jobs: JobQueue,
  actor: Actor,
  input: VersionInput,
): Promise<DocumentVersion> {
  const batchId = input.batchId ?? newId()
  const queued = await db.transaction(async (tx) => {
    const version = await lockVersionForControl(tx, actor, input)
    if (version.status !== 'failed') {
      throw conflict(
        version.status === 'ready'
          ? 'This upload has already finished'
          : 'This upload is still being processed',
      )
    }
    const [{ newest }] = await tx
      .select({ newest: sql<number>`max(${documentVersions.versionNumber})` })
      .from(documentVersions)
      .where(eq(documentVersions.documentId, version.documentId))
    if (Number(newest) !== version.versionNumber) {
      throw conflict('A newer version exists; upload again or remove this one')
    }
    if (!(await blobs.exists(version.originalKey))) {
      throw conflict('The uploaded file is no longer stored; upload it again')
    }

    const [row] = await tx
      .update(documentVersions)
      .set({
        status: 'queued',
        error: null,
        failureCode: null,
        failureDpi: null,
        searchableKey: null,
        updatedBy: actor.userId,
      })
      .where(eq(documentVersions.id, version.id))
      .returning()
    await tx.delete(pages).where(eq(pages.documentVersionId, version.id))
    await logChange(tx, {
      showId: version.showId,
      actor,
      batchId,
      table: 'document_versions',
      rowId: version.id,
      op: 'update',
      before: { status: 'failed', failureCode: version.failureCode },
      after: { status: 'queued', failureCode: null },
    })
    return row
  })
  return enqueueProcessing(db, jobs, queued)
}

/** The blob keys a version can own: its original, the searchable PDF (by row and by its fixed key), page renders. */
function versionBlobKeys(
  version: DocumentVersion,
  versionPages: Array<{ thumbKey: string | null; wordsKey: string | null }>,
): string[] {
  const keys = new Set<string>([
    version.originalKey,
    // The deterministic key, not only the row's: a run that was cancelled, retried and failed again
    // can leave a searchable PDF the row never recorded.
    searchableBlobKey(version.showId, version.documentId, version.id),
  ])
  if (version.searchableKey) keys.add(version.searchableKey)
  for (const p of versionPages) {
    if (p.thumbKey) keys.add(p.thumbKey)
    if (p.wordsKey) keys.add(p.wordsKey)
  }
  return [...keys]
}

export interface RemovedVersion {
  versionId: string
  documentId: string
  /** True when it was the document's only version, so the document went with it. */
  documentRemoved: boolean
}

/**
 * Editor or above on an unarchived show. Permanently removes a failed version: its row, its pages
 * (by cascade) and, once the transaction commits, its stored files (best effort). When it was the
 * document's only version the document goes too; when it was the current version of a document that
 * has others, `current_version_id` moves to the highest ready version, or to none. A version still
 * queued or processing (cancel it first) or ready is `conflict`, as is one a cue or annotation
 * anchors to (processing cannot produce that, so this is only a guard). Both deletes are logged with
 * their before-images, in one batch; neither can be reverted, like every document lifecycle event.
 */
export async function removeVersion(
  db: Executor,
  blobs: BlobStore,
  actor: Actor,
  input: VersionInput,
): Promise<RemovedVersion> {
  const batchId = input.batchId ?? newId()
  const { version, documentRemoved, keys } = await db.transaction(async (tx) => {
    const version = await lockVersionForControl(tx, actor, input)
    if (version.status !== 'failed') {
      throw conflict(
        version.status === 'ready'
          ? 'Only a failed upload can be removed'
          : 'This upload is still being processed; cancel it first',
      )
    }
    const anchored = sql`${cues.anchor}->>'documentVersionId' = ${version.id}`
    const [cue] = await tx
      .select({ id: cues.id })
      .from(cues)
      .where(and(eq(cues.showId, version.showId), anchored))
      .limit(1)
    const [note] = cue
      ? []
      : await tx
          .select({ id: annotations.id })
          .from(annotations)
          .where(
            and(
              eq(annotations.showId, version.showId),
              sql`${annotations.anchor}->>'documentVersionId' = ${version.id}`,
            ),
          )
          .limit(1)
    if (cue || note) throw conflict('Cues or annotations are anchored to this version')

    // Serialise with uploads and other removals on this document, as addDocumentVersion does.
    const [document] = await tx
      .select()
      .from(documents)
      .where(eq(documents.id, version.documentId))
      .for('update')
    const versionPages = await tx
      .select({ thumbKey: pages.thumbKey, wordsKey: pages.wordsKey })
      .from(pages)
      .where(eq(pages.documentVersionId, version.id))
    const siblings = await tx
      .select({
        id: documentVersions.id,
        versionNumber: documentVersions.versionNumber,
        status: documentVersions.status,
      })
      .from(documentVersions)
      .where(eq(documentVersions.documentId, version.documentId))
    const others = siblings.filter((v) => v.id !== version.id)

    await tx.delete(documentVersions).where(eq(documentVersions.id, version.id))
    await logChange(tx, {
      showId: version.showId,
      actor,
      batchId,
      table: 'document_versions',
      rowId: version.id,
      op: 'delete',
      before: {
        documentId: version.documentId,
        versionNumber: version.versionNumber,
        label: version.label,
        originalKey: version.originalKey,
        status: version.status,
        failureCode: version.failureCode,
      },
      after: null,
    })

    let documentRemoved = false
    if (document && others.length === 0) {
      await tx.delete(documents).where(eq(documents.id, document.id))
      await logChange(tx, {
        showId: version.showId,
        actor,
        batchId,
        table: 'documents',
        rowId: document.id,
        op: 'delete',
        before: {
          kind: document.kind,
          title: document.title,
          ocrMode: document.ocrMode,
          snapToText: document.snapToText,
          currentVersionId: document.currentVersionId,
        },
        after: null,
      })
      documentRemoved = true
    } else if (document && document.currentVersionId === version.id) {
      const next =
        others
          .filter((v) => v.status === 'ready')
          .sort((a, b) => b.versionNumber - a.versionNumber)[0]?.id ?? null
      await tx
        .update(documents)
        .set({ currentVersionId: next, updatedBy: actor.userId })
        .where(eq(documents.id, document.id))
      await logChange(tx, {
        showId: version.showId,
        actor,
        batchId,
        table: 'documents',
        rowId: document.id,
        op: 'update',
        before: { currentVersionId: version.id },
        after: { currentVersionId: next },
      })
    }
    return { version, documentRemoved, keys: versionBlobKeys(version, versionPages) }
  })

  // Best effort: a file that cannot be deleted is an orphan, not a reason to fail a removal that
  // already committed.
  await Promise.all(keys.map((key) => blobs.delete(key).catch(() => {})))
  return { versionId: version.id, documentId: version.documentId, documentRemoved }
}
