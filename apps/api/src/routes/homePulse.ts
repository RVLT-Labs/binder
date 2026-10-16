import { Hono } from 'hono'
import type { AppEnv } from '../app'
import { requireUser } from '../auth/middleware'
import { latestChangePerShow, presenceSummary } from '../services'

/**
 * Show-card data for the home page, under `/me` so it cannot collide with `/shows/:showId`. Each
 * route covers every show the caller is a member of in one request.
 */
export const homePulse = new Hono<AppEnv>()

homePulse.get('/me/shows/last-changes', requireUser, async (c) => {
  // biome-ignore lint/style/noNonNullAssertion: requireUser always sets actor
  const shows = await latestChangePerShow(c.var.deps.db, c.var.actor!)
  return c.json({ shows })
})

homePulse.get('/me/shows/presence', requireUser, async (c) => {
  // biome-ignore lint/style/noNonNullAssertion: requireUser always sets actor
  const summary = await presenceSummary(c.var.deps.db, c.var.deps.presence, c.var.actor!)
  return c.json(summary)
})
