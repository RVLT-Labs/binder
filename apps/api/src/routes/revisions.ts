import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../app'
import { requireUser } from '../auth/middleware'
import {
  compareDocumentVersions,
  listReanchorReview,
  listVersionAnchors,
  resolveReanchorItem,
} from '../services'
import { parseOrInvalid } from '../validation'
import { readJson } from './json'

const resolveBody = z.strictObject({
  table: z.enum(['cues', 'annotations']),
  rowId: z.string().min(1),
  action: z.enum(['accept', 'revert', 'reanchor']),
})

const compareQuery = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  limit: z
    .string()
    .regex(/^\d+$/, 'must be a whole number')
    .transform((s) => Number(s))
    .optional(),
})

export const revisions = new Hono<AppEnv>()

// biome-ignore lint/style/noNonNullAssertion: requireUser always sets actor
const actorOf = (c: { var: AppEnv['Variables'] }) => c.var.actor!

revisions.get('/documents/:documentId/review', requireUser, async (c) =>
  c.json(
    await listReanchorReview(c.var.deps.db, actorOf(c), { documentId: c.req.param('documentId') }),
  ),
)

revisions.post('/documents/:documentId/review', requireUser, async (c) => {
  const body = await readJson(c.req, resolveBody)
  const anchor = await resolveReanchorItem(c.var.deps.db, c.var.deps.blobs, actorOf(c), {
    ...body,
    documentId: c.req.param('documentId'),
  })
  return c.json({ anchor })
})

revisions.get('/versions/:versionId/anchors', requireUser, async (c) =>
  c.json({
    anchors: await listVersionAnchors(c.var.deps.db, actorOf(c), {
      versionId: c.req.param('versionId'),
    }),
  }),
)

revisions.get('/documents/:documentId/compare', requireUser, async (c) => {
  const { from, to, limit } = parseOrInvalid(compareQuery, c.req.query())
  return c.json(
    await compareDocumentVersions(c.var.deps.db, c.var.deps.blobs, actorOf(c), {
      fromVersionId: from,
      toVersionId: to,
      limit,
      documentId: c.req.param('documentId'),
    }),
  )
})
