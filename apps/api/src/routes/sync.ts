import type { SyncUploadRequest } from '@binder/shared'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../app'
import { requireSession } from '../auth/middleware'
import { applyCrudBatch } from '../sync/apply'
import { mintPowerSyncToken } from '../sync/token'
import { readJson } from './json'

export const sync = new Hono<AppEnv>()

/** The grammar of a client batch id (spec 4.12: one batch per sync upload). */
export const CLIENT_BATCH_ID = /^[A-Za-z0-9_-]{1,100}$/

// Session cookie only: a personal access token may be scoped to a few shows, but a PowerSync token
// syncs every show the user belongs to, so a bearer token must never be able to mint one.
sync.get('/sync/token', requireSession, async (c) => {
  const { config } = c.var.deps
  // biome-ignore lint/style/noNonNullAssertion: requireSession always sets user
  const { token, expiresAt } = await mintPowerSyncToken(c.var.user!.id, config.POWERSYNC_JWT_SECRET)
  return c.json({ token, expiresAt: expiresAt.toISOString(), endpoint: config.POWERSYNC_URL })
})

// Typed against the shared wire format so the web connector and this route cannot drift apart.
const uploadBody: z.ZodType<SyncUploadRequest> = z.object({
  // A client batch id is device-scoped (`${deviceId}-${transactionId}`); it never contains ':', so the
  // logged `${userId}:${batchId}` cannot be forged to look like another user's or the server's batch.
  batchId: z.string().regex(CLIENT_BATCH_ID, 'must match /^[A-Za-z0-9_-]{1,100}$/'),
  entries: z
    .array(
      z.object({
        table: z.string().min(1).max(100),
        id: z.string().min(1).max(200),
        op: z.enum(['PUT', 'PATCH', 'DELETE']),
        data: z.record(z.string(), z.unknown()).nullish(),
        // Checked per entry so one bad timestamp rejects that entry instead of the batch.
        clientTs: z.string().optional(),
      }),
    )
    .max(500),
})

// Validation and permission failures are 200 with a `rejected` list: a 4xx would block the
// client's upload queue forever. Only a malformed body (never sent by a well-behaved client) is 400,
// and only a transient failure is 5xx, so PowerSync retries the batch.
sync.post('/sync/upload', requireSession, async (c) => {
  const body = await readJson(c.req, uploadBody)
  // biome-ignore lint/style/noNonNullAssertion: requireSession always sets actor
  const actor = { ...c.var.actor!, via: 'sync' as const }
  try {
    // Logged per user, so two users (or devices) reusing a client id never share a batch.
    const batchId = `${actor.userId}:${body.batchId}`
    return c.json(await applyCrudBatch(c.var.deps.db, actor, { ...body, batchId }))
  } catch (err) {
    console.error('sync upload failed; batch rolled back for retry', err)
    return c.json({ error: 'unavailable', message: 'Upload failed, retry later' }, 503)
  }
})
