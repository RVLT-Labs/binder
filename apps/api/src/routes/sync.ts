import { Hono } from 'hono'
import type { AppEnv } from '../app'
import { requireSession } from '../auth/middleware'
import { mintPowerSyncToken } from '../sync/token'

export const sync = new Hono<AppEnv>()

// Session cookie only: a personal access token may be scoped to a few shows, but a PowerSync token
// syncs every show the user belongs to, so a bearer token must never be able to mint one.
sync.get('/sync/token', requireSession, async (c) => {
  const { config } = c.var.deps
  // biome-ignore lint/style/noNonNullAssertion: requireSession always sets user
  const { token, expiresAt } = await mintPowerSyncToken(c.var.user!.id, config.POWERSYNC_JWT_SECRET)
  return c.json({ token, expiresAt: expiresAt.toISOString(), endpoint: config.POWERSYNC_URL })
})
