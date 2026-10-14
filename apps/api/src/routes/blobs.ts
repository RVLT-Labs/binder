import { Readable } from 'node:stream'
import { Hono } from 'hono'
import type { AppEnv } from '../app'
import { requireUser } from '../auth/middleware'
import { showIdFromKey, validateBlobKey } from '../blob/keys'
import { invalid, notFound } from '../errors'
import { requireShowRole } from '../services'

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

blobs.get('/blobs/*', requireUser, async (c) => {
  const key = keyFromPath(c.req.path)
  const showId = showIdFromKey(key)
  if (!showId) throw invalid('Invalid blob key')
  await requireShowRole(c.var.deps.db, actorOf(c), showId, 'viewer')
  const blob = await c.var.deps.blobs.get(key)
  if (!blob) throw notFound('Blob not found')
  const filename = key.split('/').at(-1)
  return c.body(Readable.toWeb(blob.stream) as ReadableStream, 200, {
    'Content-Type': blob.contentType,
    'Content-Length': String(blob.size),
    // Keys embed the version id, so the bytes behind a key never change.
    'Cache-Control': 'private, max-age=31536000, immutable',
    'Content-Disposition': `inline; filename="${filename}"`,
    'X-Content-Type-Options': 'nosniff',
  })
})
