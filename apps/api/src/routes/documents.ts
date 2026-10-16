import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../app'
import { requireUser } from '../auth/middleware'
import { invalid } from '../errors'
import {
  addDocumentVersion,
  assertShowAcceptsUploads,
  cancelVersionProcessing,
  createDocument,
  listDocuments,
  removeVersion,
  retryVersion,
} from '../services'
import { MAX_UPLOAD_BYTES, readUpload as readMultipart } from '../upload/multipart'

const title = z.string().trim().min(1).max(200)
const createFields = z.object({
  kind: z.enum(['libretto', 'score', 'blocking', 'other']),
  title,
  ocrMode: z.enum(['auto', 'never']).optional(),
})
const versionFields = z.object({ label: title })

export const documents = new Hono<AppEnv>()

// biome-ignore lint/style/noNonNullAssertion: requireUser always sets actor
const actorOf = (c: { var: AppEnv['Variables'] }) => c.var.actor!

/** Authorise, read the multipart body, and validate its text fields; nothing is stored on any failure. */
async function readUpload<T extends z.ZodType>(
  c: Parameters<typeof readMultipart>[0],
  schema: T,
): Promise<{ fields: z.infer<T>; file: Awaited<ReturnType<typeof readMultipart>>['file'] }> {
  const upload = await readMultipart(c, MAX_UPLOAD_BYTES, { magic: '%PDF-' })
  const parsed = schema.safeParse(upload.fields)
  if (!parsed.success) {
    upload.file.stream.destroy()
    throw invalid(
      parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '),
    )
  }
  return { fields: parsed.data, file: upload.file }
}

documents.get('/shows/:showId/documents', requireUser, async (c) =>
  c.json({
    documents: await listDocuments(c.var.deps.db, actorOf(c), { showId: c.req.param('showId') }),
  }),
)

documents.post('/shows/:showId/documents', requireUser, async (c) => {
  const { db, blobs, jobs } = c.var.deps
  const showId = c.req.param('showId')
  await assertShowAcceptsUploads(db, actorOf(c), showId)
  const { fields, file } = await readUpload(c, createFields)
  const created = await createDocument(db, blobs, jobs, actorOf(c), {
    showId,
    ...fields,
    file: file.stream,
  })
  return c.json(created, 201)
})

documents.post('/shows/:showId/documents/:docId/versions', requireUser, async (c) => {
  const { db, blobs, jobs } = c.var.deps
  const showId = c.req.param('showId')
  await assertShowAcceptsUploads(db, actorOf(c), showId)
  const { fields, file } = await readUpload(c, versionFields)
  const version = await addDocumentVersion(db, blobs, jobs, actorOf(c), {
    documentId: c.req.param('docId'),
    showId,
    label: fields.label,
    file: file.stream,
  })
  return c.json({ version }, 201)
})

// Processing controls (spec Feature 3). Editors and owners; document_versions is not writable
// through sync, so the web calls these.
documents.post('/shows/:showId/versions/:versionId/cancel', requireUser, async (c) => {
  const version = await cancelVersionProcessing(c.var.deps.db, actorOf(c), {
    versionId: c.req.param('versionId'),
    showId: c.req.param('showId'),
  })
  return c.json({ version })
})

documents.post('/shows/:showId/versions/:versionId/retry', requireUser, async (c) => {
  const { db, blobs, jobs } = c.var.deps
  const version = await retryVersion(db, blobs, jobs, actorOf(c), {
    versionId: c.req.param('versionId'),
    showId: c.req.param('showId'),
  })
  return c.json({ version })
})

documents.delete('/shows/:showId/versions/:versionId', requireUser, async (c) => {
  const { db, blobs } = c.var.deps
  const removed = await removeVersion(db, blobs, actorOf(c), {
    versionId: c.req.param('versionId'),
    showId: c.req.param('showId'),
  })
  return c.json({ removed })
})
