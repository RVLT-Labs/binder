import { Readable } from 'node:stream'
import { Hono } from 'hono'
import type { AppEnv } from '../app'
import { requireUser } from '../auth/middleware'
import { isUploadStagingKey, parseExportKey, showIdFromKey, validateBlobKey } from '../blob/keys'
import { invalid, notFound } from '../errors'
import { requireShowRole } from '../services'
import { readableExport } from '../services/exports'

export const blobs = new Hono<AppEnv>()

// biome-ignore lint/style/noNonNullAssertion: requireUser always sets actor
const actorOf = (c: { var: AppEnv['Variables'] }) => c.var.actor!

function keyFromPath(path: string): string {
  try {
    return validateBlobKey(decodeURIComponent(path.slice('/blobs/'.length)))
  } catch (err) {
    if (err instanceof URIError) throw invalid('Invalid blob key')
    throw err
  }
}

/** `inline; filename="..."`, with an RFC 5987 `filename*` when the name is not plain ASCII (export names carry show titles). */
function contentDisposition(filename: string): string {
  if (/^[\x20-\x7e]*$/.test(filename) && !/["\\]/.test(filename)) {
    return `inline; filename="${filename}"`
  }
  const fallback = filename.replace(/[^\x20-\x7e]|["\\%]/g, '_')
  return `inline; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}

blobs.get('/blobs/*', requireUser, async (c) => {
  const key = keyFromPath(c.req.path)
  const showId = showIdFromKey(key)
  if (!showId) throw invalid('Invalid blob key')
  // Staged upload bytes have not been completed (or even checked) yet: no member may read them.
  if (isUploadStagingKey(key)) throw notFound('Blob not found')
  const { db } = c.var.deps
  await requireShowRole(db, actorOf(c), showId, 'viewer')
  // Exports are the one place a show member may not read a blob: a private export is its owner's alone.
  // The record decides, so a key without a row (or not the row's file) is as absent as a missing blob.
  let filename = key.split('/').at(-1)
  if (key.startsWith(`shows/${showId}/exports/`)) {
    const parsed = parseExportKey(key)
    if (!parsed) throw notFound('Blob not found')
    const record = await readableExport(db, actorOf(c), {
      exportId: parsed.exportId,
      showId,
      fileKey: key,
    })
    filename = record.filename
  }
  const blob = await c.var.deps.blobs.get(key)
  if (!blob) throw notFound('Blob not found')
  return c.body(Readable.toWeb(blob.stream) as ReadableStream, 200, {
    'Content-Type': blob.contentType,
    'Content-Length': String(blob.size),
    // Keys embed the version id or a per-upload nonce, so the bytes behind a key never change.
    'Cache-Control': 'private, max-age=31536000, immutable',
    'Content-Disposition': contentDisposition(filename ?? 'blob'),
    'X-Content-Type-Options': 'nosniff',
  })
})
