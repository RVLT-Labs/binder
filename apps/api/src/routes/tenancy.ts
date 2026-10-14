import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../app'
import { requireUser } from '../auth/middleware'
import {
  addShowMember,
  createOrganisation,
  createShow,
  listOrganisations,
  listShows,
  updateShow,
} from '../services'
import { email, jsonRecord, memberDepartments, title } from '../validation'
import { readJson } from './json'

const status = z.enum(['prep', 'rehearsal', 'running', 'archived'])
const role = z.enum(['owner', 'editor', 'viewer'])

const orgBody = z.object({ name: title })
const showBody = z.object({ title })
const patchBody = z.object({
  title: title.optional(),
  status: status.optional(),
  settings: jsonRecord.optional(),
})
const memberBody = z.object({
  email,
  role,
  departments: memberDepartments.optional(),
})

export const tenancy = new Hono<AppEnv>()

// biome-ignore lint/style/noNonNullAssertion: requireUser always sets actor
const actorOf = (c: { var: AppEnv['Variables'] }) => c.var.actor!

tenancy.get('/me/orgs', requireUser, async (c) =>
  c.json({ organisations: await listOrganisations(c.var.deps.db, actorOf(c)) }),
)

tenancy.post('/orgs', requireUser, async (c) => {
  const body = await readJson(c.req, orgBody)
  return c.json({ organisation: await createOrganisation(c.var.deps.db, actorOf(c), body) }, 201)
})

tenancy.get('/me/shows', requireUser, async (c) =>
  c.json(await listShows(c.var.deps.db, actorOf(c))),
)

tenancy.post('/orgs/:orgId/shows', requireUser, async (c) => {
  const body = await readJson(c.req, showBody)
  const show = await createShow(c.var.deps.db, actorOf(c), {
    organisationId: c.req.param('orgId'),
    title: body.title,
  })
  return c.json({ show }, 201)
})

tenancy.patch('/shows/:showId', requireUser, async (c) => {
  const patch = await readJson(c.req, patchBody)
  const show = await updateShow(c.var.deps.db, actorOf(c), {
    showId: c.req.param('showId'),
    patch,
  })
  return c.json({ show })
})

tenancy.post('/shows/:showId/members', requireUser, async (c) => {
  const body = await readJson(c.req, memberBody)
  const membership = await addShowMember(c.var.deps.db, actorOf(c), {
    showId: c.req.param('showId'),
    ...body,
  })
  return c.json({ membership }, 201)
})
