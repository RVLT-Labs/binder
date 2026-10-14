import type { Readable } from 'node:stream'
import { documents, documentVersions, pages, shows } from '@binder/db'
import { type Actor, type DocumentKind, newId, type OcrMode } from '@binder/shared'
import { asc, eq, type InferSelectModel, sql } from 'drizzle-orm'
import type { BlobStore } from '../blob/BlobStore'
import { originalBlobKey } from '../blob/keys'
import { notFound, payloadTooLarge } from '../errors'
import type { JobQueue } from '../processing/types'
import { MAX_UPLOAD_BYTES } from '../upload/multipart'
import { logChange } from './changeLog'
import type { Executor } from './executor'
import { assertShowWritable, requireShowRole } from './tenancy'

export type Document = InferSelectModel<typeof documents>
export type DocumentVersion = InferSelectModel<typeof documentVersions>
export type Page = InferSelectModel<typeof pages>

export interface DocumentPatch {
  title?: string
  kind?: DocumentKind
  ocrMode?: OcrMode
  snapToText?: boolean | null
  sortOrder?: number
}

const PATCHABLE = ['title', 'kind', 'ocrMode', 'snapToText', 'sortOrder'] as const

/** Editor or above on the document's show; archived shows are read-only. Logs only changed columns. */
export async function updateDocument(
  db: Executor,
  actor: Actor,
  input: { documentId: string; patch: DocumentPatch; batchId?: string; clientTs?: Date },
): Promise<Document> {
  const batchId = input.batchId ?? newId()
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(documents).where(eq(documents.id, input.documentId))
    if (!current) throw notFound('Document not found')
    await requireShowRole(tx, actor, current.showId, 'editor')
    const [show] = await tx
      .select({ status: shows.status })
      .from(shows)
      .where(eq(shows.id, current.showId))
    if (!show) throw notFound('Show not found')
    assertShowWritable(show)

    const before: Record<string, unknown> = {}
    const after: Record<string, unknown> = {}
    for (const key of PATCHABLE) {
      const next = input.patch[key]
      if (next === undefined || next === current[key]) continue
      before[key] = current[key]
      after[key] = next
    }
    if (Object.keys(after).length === 0) return current

    const [updated] = await tx
      .update(documents)
      .set({ ...after, updatedBy: actor.userId })
      .where(eq(documents.id, input.documentId))
      .returning()
    await logChange(tx, {
      showId: current.showId,
      actor,
      batchId,
      table: 'documents',
      rowId: input.documentId,
      op: 'update',
      before,
      after,
      clientTs: input.clientTs,
    })
    return updated
  })
}

/** Spec 4.3: snapping is on for text-bearing kinds and off for scores and blocking. */
const defaultSnapToText = (kind: DocumentKind): boolean => kind === 'libretto' || kind === 'other'

/** Editor or above on an unarchived show. Call before reading an upload body so refusals cost nothing. */
export async function assertShowAcceptsUploads(
  db: Executor,
  actor: Actor,
  showId: string,
): Promise<void> {
  await requireShowRole(db, actor, showId, 'editor')
  const [show] = await db.select({ status: shows.status }).from(shows).where(eq(shows.id, showId))
  if (!show) throw notFound('Show not found')
  assertShowWritable(show)
}

function assertDeclaredSize(declaredSize: number | undefined): void {
  if (declaredSize !== undefined && declaredSize > MAX_UPLOAD_BYTES) throw payloadTooLarge()
}

/** Store the PDF, run `writeRows` in a transaction, and remove the blob again if that fails. */
async function storeThenWrite<T>(
  db: Executor,
  blobs: BlobStore,
  key: string,
  file: Readable,
  writeRows: (tx: Executor) => Promise<T>,
): Promise<T> {
  await blobs.put(key, file, 'application/pdf')
  try {
    return await db.transaction(writeRows)
  } catch (err) {
    await blobs.delete(key).catch(() => {})
    throw err
  }
}

/** The version row exists and is durable; a failed enqueue marks it failed so a retry can find it. */
async function enqueueProcessing(
  db: Executor,
  jobs: JobQueue,
  version: DocumentVersion,
): Promise<DocumentVersion> {
  try {
    await jobs.enqueueDocumentProcess(version.id)
    return version
  } catch (err) {
    console.error(`could not enqueue processing for version ${version.id}`, err)
    const [failed] = await db
      .update(documentVersions)
      .set({ status: 'failed', error: 'Could not queue processing' })
      .where(eq(documentVersions.id, version.id))
      .returning()
    return failed
  }
}

/**
 * Editor or above. Creates a document and its first version (which becomes current). The PDF must
 * already have passed the magic-byte check; the blob is written before any row, and removed if the rows fail.
 */
export async function createDocument(
  db: Executor,
  blobs: BlobStore,
  jobs: JobQueue,
  actor: Actor,
  input: {
    showId: string
    kind: DocumentKind
    title: string
    ocrMode?: OcrMode
    snapToText?: boolean | null
    file: Readable
    declaredSize?: number
    batchId?: string
  },
): Promise<{ document: Document; version: DocumentVersion }> {
  assertDeclaredSize(input.declaredSize)
  await assertShowAcceptsUploads(db, actor, input.showId)
  const batchId = input.batchId ?? newId()
  const documentId = newId()
  const versionId = newId()
  const key = originalBlobKey(input.showId, documentId, versionId)

  const created = await storeThenWrite(db, blobs, key, input.file, async (tx) => {
    await assertShowAcceptsUploads(tx, actor, input.showId)
    const [document] = await tx
      .insert(documents)
      .values({
        id: documentId,
        showId: input.showId,
        kind: input.kind,
        title: input.title,
        ocrMode: input.ocrMode ?? 'auto',
        snapToText:
          input.snapToText === undefined ? defaultSnapToText(input.kind) : input.snapToText,
        currentVersionId: versionId,
        updatedBy: actor.userId,
      })
      .returning()
    const [version] = await tx
      .insert(documentVersions)
      .values({
        id: versionId,
        showId: input.showId,
        documentId,
        versionNumber: 1,
        originalKey: key,
        uploadedBy: actor.userId,
        updatedBy: actor.userId,
      })
      .returning()
    await logChange(tx, {
      showId: input.showId,
      actor,
      batchId,
      table: 'documents',
      rowId: documentId,
      op: 'insert',
      before: null,
      after: {
        kind: document.kind,
        title: document.title,
        ocrMode: document.ocrMode,
        snapToText: document.snapToText,
        currentVersionId: versionId,
      },
    })
    await logChange(tx, versionInsertEntry(input.showId, actor, batchId, version))
    return { document, version }
  })
  return { document: created.document, version: await enqueueProcessing(db, jobs, created.version) }
}

function versionInsertEntry(
  showId: string,
  actor: Actor,
  batchId: string,
  version: DocumentVersion,
) {
  return {
    showId,
    actor,
    batchId,
    table: 'document_versions',
    rowId: version.id,
    op: 'insert' as const,
    before: null,
    after: {
      documentId: version.documentId,
      versionNumber: version.versionNumber,
      label: version.label,
      originalKey: version.originalKey,
      status: version.status,
    },
  }
}

/**
 * Editor or above. Adds the next version to a document; the current version is unchanged because
 * switching happens after re-anchoring. When `showId` is given the document must belong to that show.
 */
export async function addDocumentVersion(
  db: Executor,
  blobs: BlobStore,
  jobs: JobQueue,
  actor: Actor,
  input: {
    documentId: string
    showId?: string
    label: string
    file: Readable
    declaredSize?: number
    batchId?: string
  },
): Promise<DocumentVersion> {
  assertDeclaredSize(input.declaredSize)
  const [document] = await db.select().from(documents).where(eq(documents.id, input.documentId))
  if (!document || (input.showId !== undefined && document.showId !== input.showId)) {
    throw notFound('Document not found')
  }
  await assertShowAcceptsUploads(db, actor, document.showId)
  const batchId = input.batchId ?? newId()
  const versionId = newId()
  const key = originalBlobKey(document.showId, document.id, versionId)

  const version = await storeThenWrite(db, blobs, key, input.file, async (tx) => {
    await assertShowAcceptsUploads(tx, actor, document.showId)
    // Serialise concurrent uploads to this document so max + 1 cannot collide.
    const locked = await tx
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.id, document.id))
      .for('update')
    if (locked.length === 0) throw notFound('Document not found')
    const [{ next }] = await tx
      .select({ next: sql<number>`coalesce(max(${documentVersions.versionNumber}), 0) + 1` })
      .from(documentVersions)
      .where(eq(documentVersions.documentId, document.id))
    const [row] = await tx
      .insert(documentVersions)
      .values({
        id: versionId,
        showId: document.showId,
        documentId: document.id,
        versionNumber: Number(next),
        label: input.label,
        originalKey: key,
        uploadedBy: actor.userId,
        updatedBy: actor.userId,
      })
      .returning()
    await logChange(tx, versionInsertEntry(document.showId, actor, batchId, row))
    return row
  })
  return enqueueProcessing(db, jobs, version)
}

/** Any member. Documents in display order, each with its versions oldest first. */
export async function listDocuments(
  db: Executor,
  actor: Actor,
  input: { showId: string },
): Promise<Array<Document & { versions: DocumentVersion[] }>> {
  await requireShowRole(db, actor, input.showId, 'viewer')
  const docs = await db
    .select()
    .from(documents)
    .where(eq(documents.showId, input.showId))
    .orderBy(asc(documents.sortOrder), asc(documents.createdAt), asc(documents.id))
  const versions = await db
    .select()
    .from(documentVersions)
    .where(eq(documentVersions.showId, input.showId))
    .orderBy(asc(documentVersions.versionNumber))
  return docs.map((d) => ({ ...d, versions: versions.filter((v) => v.documentId === d.id) }))
}

/** Any member. A version with its pages in index order. */
export async function getDocumentVersion(
  db: Executor,
  actor: Actor,
  input: { versionId: string },
): Promise<DocumentVersion & { pages: Page[] }> {
  const [version] = await db
    .select()
    .from(documentVersions)
    .where(eq(documentVersions.id, input.versionId))
  if (!version) throw notFound('Version not found')
  await requireShowRole(db, actor, version.showId, 'viewer')
  const versionPages = await db
    .select()
    .from(pages)
    .where(eq(pages.documentVersionId, version.id))
    .orderBy(asc(pages.index))
  return { ...version, pages: versionPages }
}
