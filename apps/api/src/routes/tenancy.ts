import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../app'
import { requireUser } from '../auth/middleware'
import { invalid } from '../errors'
import {
  addShowMember,
  createOrganisation,
  createShow,
  listOrganisations,
  listShows,
  updateShow,
} from '../services'

const status = z.enum(['prep', 'rehearsal', 'running', 'archived'])
const role = z.enum(['owner', 'editor', 'viewer'])

const orgBody = z.object({ name: z.string().trim().min(1).max(200) })
const showBody = z.object({ title: z.string().trim().min(1).max(200) })
const patchBody = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  status: status.optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
})
const memberBody = z.object({
  email: z.string().email(),
  role,
  departments: z.array(z.string().min(1)).min(1).optional(),
})

async function parse<T extends z.ZodType>(
  req: { json(): Promise<unknown> },
  schema: T,
): Promise<z.infer<T>> {
  const body = await req.json().catch(() => {
    throw invalid('Request body must be JSON')
  })
  const result = schema.safeParse(body)
  if (!result.success) {
    throw invalid(
      result.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '),
    )
  }
  return result.data
}

export const tenancy = new Hono<AppEnv>()

// biome-ignore lint/style/noNonNullAssertion: requireUser always sets actor
const actorOf = (c: { var: AppEnv['Variables'] }) => c.var.actor!

tenancy.get('/me/orgs', requireUser, async (c) =>
  c.json({ organisations: await listOrganisations(c.var.deps.db, actorOf(c)) }),
)

tenancy.post('/orgs', requireUser, async (c) => {
  const body = await parse(c.req, orgBody)
  return c.json({ organisation: await createOrganisation(c.var.deps.db, actorOf(c), body) }, 201)
})

tenancy.get('/me/shows', requireUser, async (c) =>
  c.json(await listShows(c.var.deps.db, actorOf(c))),
)

tenancy.post('/orgs/:orgId/shows', requireUser, async (c) => {
  const body = await parse(c.req, showBody)
  const show = await createShow(c.var.deps.db, actorOf(c), {
    organisationId: c.req.param('orgId'),
    title: body.title,
  })
  return c.json({ show }, 201)
})

tenancy.patch('/shows/:showId', requireUser, async (c) => {
  const patch = await parse(c.req, patchBody)
  const show = await updateShow(c.var.deps.db, actorOf(c), {
    showId: c.req.param('showId'),
    patch,
  })
  return c.json({ show })
})

tenancy.post('/shows/:showId/members', requireUser, async (c) => {
  const body = await parse(c.req, memberBody)
  const membership = await addShowMember(c.var.deps.db, actorOf(c), {
    showId: c.req.param('showId'),
    ...body,
  })
  return c.json({ membership }, 201)
})
