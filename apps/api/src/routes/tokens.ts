import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../app'
import { requireSession } from '../auth/middleware'
import { createToken, listTokens, revokeToken } from '../services'
import { readJson } from './json'

const createBody = z.object({
  name: z.string().trim().min(1).max(100),
  showScope: z.union([z.literal('*'), z.array(z.string().min(1)).min(1)]),
  expiresAt: z.iso
    .datetime()
    .transform((s) => new Date(s))
    .refine((d) => d.getTime() > Date.now(), 'must be in the future')
    .optional(),
})

export const tokens = new Hono<AppEnv>()

// Token management needs a real session: a bearer token must never mint or revoke tokens.
// biome-ignore lint/style/noNonNullAssertion: requireSession always sets actor
const actorOf = (c: { var: AppEnv['Variables'] }) => c.var.actor!

tokens.get('/me/tokens', requireSession, async (c) =>
  c.json({ tokens: await listTokens(c.var.deps.db, actorOf(c)) }),
)

tokens.post('/me/tokens', requireSession, async (c) => {
  const parsed = await readJson(c.req, createBody)
  const result = await createToken(c.var.deps.db, actorOf(c), parsed)
  return c.json(result, 201)
})

tokens.delete('/me/tokens/:id', requireSession, async (c) => {
  const record = await revokeToken(c.var.deps.db, actorOf(c), { tokenId: c.req.param('id') })
  return c.json({ record })
})
