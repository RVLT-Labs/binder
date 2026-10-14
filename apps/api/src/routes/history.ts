import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../app'
import { requireUser } from '../auth/middleware'
import { activityFeed, listHistory, revertBatch, revertChange } from '../services'
import { parseOrInvalid } from '../validation'
import { readJson } from './json'

const count = z
  .string()
  .regex(/^\d+$/, 'must be a whole number')
  .transform((s) => Number(s))
const date = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), 'must be an ISO date')
  .transform((s) => new Date(s))
const kind = z.enum(['human', 'agent', 'all'])

const feedQuery = z.object({
  layer: z.string().optional(),
  kind: kind.optional(),
  from: date.optional(),
  to: date.optional(),
  before: count.optional(),
  limit: count.optional(),
})
const historyQuery = feedQuery.extend({
  rowId: z.string().optional(),
  table: z.string().optional(),
  userId: z.string().optional(),
})

const revertBody = z.union([
  z.strictObject({ seq: z.number().int().min(1), force: z.boolean().optional() }),
  z.strictObject({
    batchId: z.string().min(1),
    userId: z.string().min(1),
    force: z.boolean().optional(),
  }),
])

export const history = new Hono<AppEnv>()

// biome-ignore lint/style/noNonNullAssertion: requireUser always sets actor
const actorOf = (c: { var: AppEnv['Variables'] }) => c.var.actor!

history.get('/shows/:showId/history', requireUser, async (c) => {
  const query = parseOrInvalid(historyQuery, c.req.query())
  return c.json(
    await listHistory(c.var.deps.db, actorOf(c), { showId: c.req.param('showId'), ...query }),
  )
})

history.get('/shows/:showId/activity', requireUser, async (c) => {
  const query = parseOrInvalid(feedQuery, c.req.query())
  return c.json(
    await activityFeed(c.var.deps.db, actorOf(c), { showId: c.req.param('showId'), ...query }),
  )
})

history.post('/shows/:showId/revert', requireUser, async (c) => {
  const body = await readJson(c.req, revertBody)
  const showId = c.req.param('showId')
  if ('seq' in body) {
    return c.json(await revertChange(c.var.deps.db, actorOf(c), { ...body, showId }))
  }
  const {
    rows: _rows,
    deletes: _deletes,
    ...result
  } = await revertBatch(c.var.deps.db, actorOf(c), { ...body, showId })
  return c.json(result)
})
