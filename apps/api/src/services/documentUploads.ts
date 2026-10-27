import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { PassThrough, type Readable, Transform, type TransformCallback } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { changeLog, documents, documentUploads, documentVersions } from '@binder/db'
import { type Actor, type DocumentKind, newId, type OcrMode } from '@binder/shared'
import { and, count, eq, gt, inArray, lt, lte, ne, sql } from 'drizzle-orm'
import type { BlobStore } from '../blob/BlobStore'
import { uploadStagingBlobKey } from '../blob/keys'
import { AppError, conflict, invalid, notFound, payloadTooLarge } from '../errors'
import type { JobQueue } from '../processing/types'
import { byteLimit, MAX_UPLOAD_BYTES, pdfMagicCheck } from '../upload/multipart'
import {
  addDocumentVersion,
  assertShowAcceptsUploads,
  createDocument,
  type Document,
  type DocumentVersion,
} from './documents'
import type { Executor } from './executor'
import { requireShowRole } from './tenancy'

/**
 * Negotiated uploads (docs/superpowers/records/2026-10-27-mcp-private-pdf-upload.md): an agent with
 * a local PDF begins an upload over MCP, PUTs the bytes to the API with a one-time secret, and
 * completes it over MCP, which hands the staged file to `createDocument` or `addDocumentVersion`.
 */

type Row = typeof documentUploads.$inferSelect
/** An upload without its secret hash: the only shape that leaves this module. */
export type DocumentUpload = Omit<Row, 'secretHash'>
export type UploadMode = Row['mode']

/** How long an upload waits for its bytes, and then for its completion. */
export const UPLOAD_TTL_MS = 30 * 60 * 1000
/** How long a PUT may take (200 MB over a slow link) before the sweep may take its upload. */
const RECEIVING_TTL_MS = 2 * 60 * 60 * 1000
/** How long a completing upload holds its claim before the sweep may take it. */
const COMPLETING_TTL_MS = 60 * 60 * 1000
/** How long a completed upload is kept, so a retried completion finds its result. */
export const COMPLETED_RETENTION_MS = 24 * 60 * 60 * 1000
/** Unfinished uploads one user may hold at once. */
export const MAX_OPEN_UPLOADS = 5
/** PUTs one upload accepts, failed ones included. */
export const MAX_PUT_ATTEMPTS = 5
export const UPLOAD_SECRET_PREFIX = 'bndu_'

const SHA256_HEX = /^[0-9a-f]{64}$/
const hashSecret = (plain: string) => createHash('sha256').update(plain).digest()

function toUpload({ secretHash: _hash, ...rest }: Row): DocumentUpload {
  return rest
}

export interface UploadIntent {
  showId: string
  mode: UploadMode
  documentId?: string
  kind?: DocumentKind
  title?: string
  ocrMode?: OcrMode
  label?: string
  sizeBytes: number
  sha256: string
}

/**
 * Internal (not in the services barrel): the checks of an intent that need no database. The tool
 * runs them before its confirmation gate, so a bad call is told so before it is asked to confirm.
 */
export function validateUploadIntent(input: UploadIntent): void {
  if (input.mode === 'new_document') {
    if (input.documentId !== undefined || input.label !== undefined) {
      throw invalid('documentId and label apply only to mode new_version')
    }
    if (!input.kind) throw invalid('kind is required for a new document')
    if (!input.title) throw invalid('title is required for a new document')
  } else {
    if (input.kind !== undefined || input.title !== undefined || input.ocrMode !== undefined) {
      throw invalid('kind, title and ocrMode apply only to mode new_document; use update_document')
    }
    if (!input.documentId) throw invalid('documentId is required for a new version')
    if (!input.label) throw invalid('label is required for a new version')
  }
  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes < 1) {
    throw invalid('sizeBytes must be a positive whole number of bytes')
  }
  if (input.sizeBytes > MAX_UPLOAD_BYTES) throw payloadTooLarge('Upload exceeds 200 MB')
  if (!SHA256_HEX.test(input.sha256.toLowerCase())) {
    throw invalid('sha256 must be 64 hexadecimal characters')
  }
}

/** Internal: editor or above on an open show, and for a new version a document of that show. */
export async function assertUploadTarget(
  db: Executor,
  actor: Actor,
  input: Pick<UploadIntent, 'showId' | 'mode' | 'documentId'>,
): Promise<Document | null> {
  await assertShowAcceptsUploads(db, actor, input.showId)
  if (input.mode !== 'new_version' || input.documentId === undefined) return null
  const [document] = await db.select().from(documents).where(eq(documents.id, input.documentId))
  if (!document || document.showId !== input.showId) throw notFound('Document not found')
  return document
}

/**
 * Editor or above on an open show (token scope included). Records an upload of `sizeBytes` bytes
 * whose SHA-256 is `sha256`, and returns it with the one-time secret for its PUT (only its hash is
 * stored). `new_document` makes a document; `new_version` adds the next version of `documentId`,
 * which re-anchors once ready, so the MCP tool gates it behind `confirm`.
 */
export async function beginDocumentUpload(
  db: Executor,
  blobs: BlobStore,
  actor: Actor,
  input: UploadIntent,
  now: Date = new Date(),
): Promise<{ upload: DocumentUpload; secret: string }> {
  validateUploadIntent(input)
  await assertUploadTarget(db, actor, input)
  await sweepExpiredDocumentUploads(db, blobs, now).catch((err) =>
    console.error('document upload sweep failed', (err as Error).message),
  )

  const id = newId()
  const secret = UPLOAD_SECRET_PREFIX + randomBytes(32).toString('base64url')
  const row = await db.transaction(async (tx) => {
    // One user's begins queue here, so two at once cannot both take the last free slot.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`document-upload:${actor.userId}`}))`,
    )
    const [{ open }] = await tx
      .select({ open: count() })
      .from(documentUploads)
      .where(
        and(
          eq(documentUploads.userId, actor.userId),
          ne(documentUploads.status, 'completed'),
          gt(documentUploads.expiresAt, now),
        ),
      )
    if (open >= MAX_OPEN_UPLOADS) {
      throw conflict(
        `You already have ${MAX_OPEN_UPLOADS} unfinished uploads; complete or cancel one first`,
      )
    }
    const [inserted] = await tx
      .insert(documentUploads)
      .values({
        id,
        showId: input.showId,
        userId: actor.userId,
        mode: input.mode,
        documentId: input.documentId ?? null,
        kind: input.kind ?? null,
        title: input.title ?? null,
        ocrMode: input.ocrMode ?? null,
        label: input.label ?? null,
        sizeBytes: input.sizeBytes,
        sha256: input.sha256.toLowerCase(),
        secretHash: hashSecret(secret).toString('hex'),
        stagingKey: uploadStagingBlobKey(input.showId, id),
        expiresAt: new Date(now.getTime() + UPLOAD_TTL_MS),
      })
      .returning()
    return inserted
  })
  return { upload: toUpload(row), secret }
}

const uploadNotFound = () => notFound('Upload not found')

/** Constant-time comparison of a presented secret with the stored hash. */
function secretMatches(row: Row, secret: string): boolean {
  const stored = Buffer.from(row.secretHash, 'hex')
  const presented = hashSecret(secret)
  return stored.length === presented.length && timingSafeEqual(stored, presented)
}

/** Passes bytes through while hashing them. */
function hashing(hash: ReturnType<typeof createHash>): Transform {
  return new Transform({
    transform(chunk: Buffer, _enc, cb: TransformCallback) {
      hash.update(chunk)
      cb(null, chunk)
    },
  })
}

function refuseReceive(row: Row): never {
  switch (row.status) {
    case 'receiving':
      throw conflict('Another PUT for this upload is in progress')
    case 'pending':
      throw conflict(
        `This upload has had ${MAX_PUT_ATTEMPTS} attempts; cancel it and begin a new one`,
      )
    default:
      throw conflict('The file was already received; call complete_document_upload')
  }
}

/**
 * The PUT of a negotiated upload, authenticated by its one-time secret alone (an unknown upload, a
 * wrong secret and an expired upload are all `not_found`). Streams `body` into the staging blob
 * through the 200 MB cap, the `%PDF-` check and a SHA-256, and accepts it only when the size and
 * hash are the declared ones; otherwise the staged bytes are deleted and the upload may be PUT
 * again (up to `MAX_PUT_ATTEMPTS`). Writes no document rows.
 */
export async function receiveDocumentUpload(
  db: Executor,
  blobs: BlobStore,
  input: { uploadId: string; secret: string; body: Readable; contentLength?: number },
  now: Date = new Date(),
): Promise<{ uploadId: string; status: 'received'; sizeBytes: number; sha256: string }> {
  const [row] = await db
    .select()
    .from(documentUploads)
    .where(eq(documentUploads.id, input.uploadId))
  if (!row || !secretMatches(row, input.secret) || row.expiresAt <= now) throw uploadNotFound()
  if (row.status !== 'pending' || row.attempts >= MAX_PUT_ATTEMPTS) refuseReceive(row)
  if (input.contentLength !== undefined && input.contentLength > row.sizeBytes) {
    throw payloadTooLarge(`The body is larger than the declared ${row.sizeBytes} bytes`)
  }

  const claimed = await db
    .update(documentUploads)
    .set({
      status: 'receiving',
      attempts: sql`${documentUploads.attempts} + 1`,
      expiresAt: new Date(now.getTime() + RECEIVING_TTL_MS),
    })
    .where(
      and(
        eq(documentUploads.id, row.id),
        eq(documentUploads.status, 'pending'),
        lt(documentUploads.attempts, MAX_PUT_ATTEMPTS),
        gt(documentUploads.expiresAt, now),
      ),
    )
    .returning({ id: documentUploads.id })
  if (claimed.length === 0) {
    const [again] = await db.select().from(documentUploads).where(eq(documentUploads.id, row.id))
    if (!again || again.expiresAt <= now) throw uploadNotFound()
    refuseReceive(again)
  }

  const hash = createHash('sha256')
  // Set when the store itself failed: a server fault, reported as such rather than as a bad upload.
  let storeError: unknown = null
  try {
    const out = new PassThrough()
    const check = pdfMagicCheck(
      () => {},
      () => {},
    )
    const [streamed, stored] = await Promise.allSettled([
      pipeline(input.body, byteLimit(row.sizeBytes), check, hashing(hash), out),
      blobs.put(row.stagingKey, out, 'application/pdf').catch((err: unknown) => {
        // A store that gives up without draining `out` would leave the pipeline stalled on
        // back-pressure forever: fail it too, which also destroys the request body.
        storeError = err
        out.destroy(err instanceof Error ? err : new Error('blob store failed'))
        throw err
      }),
    ])
    // The stream's own failure (too large, not a PDF) explains more than the store's premature close.
    if (streamed.status === 'rejected' && streamed.reason instanceof AppError) {
      throw streamed.reason
    }
    if (stored.status === 'rejected') throw stored.reason
    if (streamed.status === 'rejected') throw streamed.reason
    if (stored.value.size !== row.sizeBytes) {
      throw invalid(`Received ${stored.value.size} bytes; ${row.sizeBytes} were declared`)
    }
    if (hash.digest('hex') !== row.sha256) {
      throw invalid('The SHA-256 of the received bytes does not match the declared sha256')
    }
  } catch (err) {
    input.body.destroy()
    await blobs.delete(row.stagingKey).catch(() => {})
    await db
      .update(documentUploads)
      .set({ status: 'pending' })
      .where(and(eq(documentUploads.id, row.id), eq(documentUploads.status, 'receiving')))
    if (err instanceof AppError && err.code === 'payload_too_large') {
      throw payloadTooLarge(`The body is larger than the declared ${row.sizeBytes} bytes`)
    }
    if (err instanceof AppError) throw err
    if (storeError !== null && err === storeError) throw err
    throw invalid('The upload was interrupted')
  }

  const received = await db
    .update(documentUploads)
    // The completion window starts when the bytes are in, however long they took.
    .set({ status: 'received', expiresAt: later(now, UPLOAD_TTL_MS) })
    .where(and(eq(documentUploads.id, row.id), eq(documentUploads.status, 'receiving')))
    .returning({ id: documentUploads.id })
  if (received.length === 0) {
    // Cancelled or swept while the bytes were arriving: nothing owns them now.
    await blobs.delete(row.stagingKey).catch(() => {})
    throw uploadNotFound()
  }
  return { uploadId: row.id, status: 'received', sizeBytes: row.sizeBytes, sha256: row.sha256 }
}

/** The caller's own upload in a show their token reaches; anything else is `not_found`. */
async function ownUpload(db: Executor, actor: Actor, uploadId: string): Promise<Row> {
  const [row] = await db.select().from(documentUploads).where(eq(documentUploads.id, uploadId))
  if (!row || row.userId !== actor.userId) throw uploadNotFound()
  await requireShowRole(db, actor, row.showId, 'viewer')
  return row
}

async function completedResult(
  db: Executor,
  row: Row,
): Promise<{ document: Document; version: DocumentVersion }> {
  const [document] = await db
    .select()
    .from(documents)
    .where(eq(documents.id, row.resultDocumentId ?? ''))
  const [version] = await db
    .select()
    .from(documentVersions)
    .where(eq(documentVersions.id, row.resultVersionId ?? ''))
  if (!document || !version) throw notFound('The document this upload made no longer exists')
  return { document, version }
}

function refuseComplete(row: Row): never {
  if (row.status === 'completing') {
    throw conflict('This upload is already being completed; call again in a moment')
  }
  throw conflict('The file has not been received yet: PUT it to the upload URL first')
}

/**
 * The upload's own user (live token, scope included), editor or above on an open show. Hands the
 * staged file to `createDocument` or `addDocumentVersion`, which store it, log the change as this
 * actor and queue processing; then deletes the staged copy. Idempotent: once completed it returns
 * the same document and version. A failure leaves the upload received, so it can be completed again.
 */
export async function completeDocumentUpload(
  db: Executor,
  blobs: BlobStore,
  jobs: JobQueue,
  actor: Actor,
  input: { uploadId: string },
  now: Date = new Date(),
): Promise<{ document: Document; version: DocumentVersion }> {
  const row = await ownUpload(db, actor, input.uploadId)
  if (row.status === 'completed') return completedResult(db, row)
  if (row.status === 'completing') {
    const recovered = await recoverCompletion(db, blobs, row, now)
    if (recovered) return recovered
  }
  if (row.expiresAt <= now) throw uploadNotFound()
  if (row.status !== 'received') refuseComplete(row)
  // Refuse a lost role, a narrowed scope or a show archived since begin before claiming the upload.
  await assertUploadTarget(db, actor, {
    showId: row.showId,
    mode: row.mode,
    documentId: row.documentId ?? undefined,
  })

  const claimed = await db
    .update(documentUploads)
    .set({ status: 'completing', expiresAt: later(now, COMPLETING_TTL_MS) })
    .where(and(eq(documentUploads.id, row.id), eq(documentUploads.status, 'received')))
    .returning({ id: documentUploads.id })
  if (claimed.length === 0) {
    const again = await ownUpload(db, actor, input.uploadId)
    if (again.status === 'completed') return completedResult(db, again)
    refuseComplete(again)
  }

  // The upload's id is the change-log batch of what it writes, which is how a completion that
  // committed but was never recorded is found again (`recoverCompletion`).
  let version: DocumentVersion
  try {
    const staged = await blobs.get(row.stagingKey)
    if (!staged) throw conflict('The staged file is missing; cancel this upload and begin again')
    try {
      version =
        row.mode === 'new_version'
          ? await addDocumentVersion(db, blobs, jobs, actor, {
              documentId: row.documentId ?? '',
              showId: row.showId,
              label: row.label ?? 'Untitled',
              file: staged.stream,
              declaredSize: row.sizeBytes,
              batchId: row.id,
            })
          : (
              await createDocument(db, blobs, jobs, actor, {
                showId: row.showId,
                kind: row.kind ?? 'other',
                title: row.title ?? 'Untitled',
                ocrMode: row.ocrMode ?? undefined,
                file: staged.stream,
                declaredSize: row.sizeBytes,
                batchId: row.id,
              })
            ).version
    } finally {
      staged.stream.destroy()
    }
  } catch (err) {
    // The document service can throw after its commit (queueing failed, and so did marking the
    // version failed). Only a completion known to have stored nothing may go back to received; a
    // committed one is recorded so a retry returns it, and an unknown one stays completing, where a
    // retry recovers it or the sweep ends it. Either way the file is never stored twice.
    const committed = await recoverCompletion(db, blobs, row, now).catch(() => undefined)
    if (committed === null) {
      await db
        .update(documentUploads)
        .set({ status: 'received', expiresAt: later(now, UPLOAD_TTL_MS) })
        .where(and(eq(documentUploads.id, row.id), eq(documentUploads.status, 'completing')))
    }
    throw err
  }
  // Record before anything else can fail: from here on a retry must return this version.
  return recordCompletion(db, blobs, row, version, now)
}

/** `ms` after `from` or after the present, whichever is later (a slow step must not shorten a window). */
const later = (from: Date, ms: number) => new Date(Math.max(from.getTime(), Date.now()) + ms)

async function recordCompletion(
  db: Executor,
  blobs: BlobStore,
  row: Row,
  version: DocumentVersion,
  now: Date,
): Promise<{ document: Document; version: DocumentVersion }> {
  const completed = {
    status: 'completed' as const,
    resultDocumentId: version.documentId,
    resultVersionId: version.id,
    expiresAt: later(now, COMPLETED_RETENTION_MS),
  }
  await db.update(documentUploads).set(completed).where(eq(documentUploads.id, row.id))
  await blobs.delete(row.stagingKey).catch(() => {})
  return completedResult(db, { ...row, ...completed })
}

/**
 * A `completing` upload whose document service already committed (the process died, or recording
 * the result failed): its version insert is in the change log under the upload's batch. Records and
 * returns it, or null when nothing was stored (the completion is still running or failed).
 */
async function recoverCompletion(
  db: Executor,
  blobs: BlobStore,
  row: Row,
  now: Date,
): Promise<{ document: Document; version: DocumentVersion } | null> {
  const [entry] = await db
    .select({ rowId: changeLog.rowId })
    .from(changeLog)
    .where(
      and(
        eq(changeLog.showId, row.showId),
        eq(changeLog.batchId, row.id),
        eq(changeLog.tableName, 'document_versions'),
        eq(changeLog.op, 'insert'),
      ),
    )
  if (!entry) return null
  const [version] = await db
    .select()
    .from(documentVersions)
    .where(eq(documentVersions.id, entry.rowId))
  return version ? recordCompletion(db, blobs, row, version, now) : null
}

/**
 * The upload's own user. Discards an upload that has not completed, with its staged bytes; a PUT
 * still arriving then fails. A completed (or completing) upload is a conflict: remove_version
 * removes what it made.
 */
export async function cancelDocumentUpload(
  db: Executor,
  blobs: BlobStore,
  actor: Actor,
  input: { uploadId: string },
): Promise<{ cancelled: string }> {
  const row = await ownUpload(db, actor, input.uploadId)
  if (row.status === 'completed' || row.status === 'completing') {
    throw conflict('This upload has completed; remove_version removes the version it made')
  }
  const deleted = await db
    .delete(documentUploads)
    .where(
      and(
        eq(documentUploads.id, row.id),
        inArray(documentUploads.status, ['pending', 'receiving', 'received']),
      ),
    )
    .returning({ id: documentUploads.id })
  if (deleted.length === 0) {
    throw conflict('This upload has completed; remove_version removes the version it made')
  }
  await blobs.delete(row.stagingKey).catch(() => {})
  return { cancelled: row.id }
}

/**
 * Internal (not in the services barrel, so not an MCP operation): deletes up to `limit` expired
 * uploads and their staged bytes. Runs when an upload begins and on the API's timer. Returns how
 * many it removed.
 */
export async function sweepExpiredDocumentUploads(
  db: Executor,
  blobs: BlobStore,
  now: Date = new Date(),
  limit = 100,
): Promise<number> {
  const expired = await db
    .select({ id: documentUploads.id })
    .from(documentUploads)
    .where(lte(documentUploads.expiresAt, now))
    .limit(limit)
  let removed = 0
  for (const { id } of expired) {
    const [gone] = await db
      .delete(documentUploads)
      .where(and(eq(documentUploads.id, id), lte(documentUploads.expiresAt, now)))
      .returning({ stagingKey: documentUploads.stagingKey })
    if (!gone) continue
    removed++
    await blobs.delete(gone.stagingKey).catch(() => {})
  }
  return removed
}
