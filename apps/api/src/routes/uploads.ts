import { Readable } from 'node:stream'
import { Hono } from 'hono'
import type { AppEnv } from '../app'
import { unauthenticated, unsupportedMediaType } from '../errors'
import { receiveDocumentUpload } from '../services'

export const uploads = new Hono<AppEnv>()

const PDF_TYPES = new Set(['application/pdf', 'application/octet-stream'])

/**
 * The byte half of a negotiated upload (begin_document_upload, then this, then
 * complete_document_upload). No session or personal access token: the upload's one-time secret in
 * `Authorization: Bearer bndu_...` is the only credential, and the body is the raw PDF. The route is
 * exempt from the 2 MB JSON limit; the service caps the body at the declared size.
 */
uploads.put('/uploads/:uploadId', async (c) => {
  const match = /^Bearer\s+(\S+)$/i.exec(c.req.header('authorization') ?? '')
  if (!match) throw unauthenticated()
  const type = c.req.header('content-type')?.split(';')[0]?.trim().toLowerCase()
  if (type && !PDF_TYPES.has(type)) {
    throw unsupportedMediaType('Content-Type must be application/pdf')
  }
  const declared = c.req.header('content-length')
  const length = declared === undefined ? Number.NaN : Number(declared)
  const raw = c.req.raw.body
  const body = raw
    ? Readable.fromWeb(raw as import('node:stream/web').ReadableStream)
    : Readable.from([])
  const received = await receiveDocumentUpload(c.var.deps.db, c.var.deps.blobs, {
    uploadId: c.req.param('uploadId'),
    secret: match[1],
    body,
    contentLength: Number.isFinite(length) ? length : undefined,
  })
  return c.json(received)
})
